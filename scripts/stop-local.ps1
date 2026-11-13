$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$apiDll = Join-Path $projectRoot 'backend\CrosswordCreator.Api\bin\Debug\net10.0\CrosswordCreator.Api.dll'
$viteScript = Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js'
$runtimeDirectory = Join-Path $projectRoot '.crosswordcreator-runtime'

if (-not (Test-Path $runtimeDirectory)) {
    Write-Host 'No CrosswordCreator processes started by start-local.bat were found.'
    exit 0
}

$targets = @(
    @{ File = 'backend.pid'; Expected = $apiDll; Label = 'backend' },
    @{ File = 'frontend.pid'; Expected = $viteScript; Label = 'frontend' }
)

foreach ($target in $targets) {
    $pidPath = Join-Path $runtimeDirectory $target.File
    if (-not (Test-Path -LiteralPath $pidPath)) {
        continue
    }

    $rawId = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    $processId = 0
    if ([int]::TryParse($rawId, [ref]$processId)) {
        $processes = @(Get-CimInstance -ClassName Win32_Process)
        $process = $processes | Where-Object { $_.ProcessId -eq $processId } | Select-Object -First 1
        if ($process -and $process.CommandLine -and
            $process.CommandLine.IndexOf($target.Expected, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $descendants = [System.Collections.Generic.List[int]]::new()
            $pending = [System.Collections.Generic.Queue[int]]::new()
            $pending.Enqueue($processId)

            while ($pending.Count -gt 0) {
                $parentId = $pending.Dequeue()
                foreach ($child in $processes | Where-Object { $_.ParentProcessId -eq $parentId }) {
                    $descendants.Add([int]$child.ProcessId)
                    $pending.Enqueue([int]$child.ProcessId)
                }
            }

            for ($index = $descendants.Count - 1; $index -ge 0; $index--) {
                Stop-Process -Id $descendants[$index] -Force -ErrorAction SilentlyContinue
            }
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped CrosswordCreator $($target.Label)."
        }
        else {
            Write-Host "No matching CrosswordCreator $($target.Label) process was found; leaving other processes alone."
        }
    }
    else {
        Write-Host "The saved $($target.Label) process ID is invalid."
    }

    Remove-Item -LiteralPath $pidPath -Force
}

if ((Get-ChildItem -LiteralPath $runtimeDirectory -Force | Measure-Object).Count -eq 0) {
    Remove-Item -LiteralPath $runtimeDirectory -Force
}
