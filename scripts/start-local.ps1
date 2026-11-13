$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$apiDirectory = Join-Path $projectRoot 'backend\CrosswordCreator.Api'
$apiProject = Join-Path $apiDirectory 'CrosswordCreator.Api.csproj'
$apiDll = Join-Path $apiDirectory 'bin\Debug\net10.0\CrosswordCreator.Api.dll'
$frontendDirectory = Join-Path $projectRoot 'frontend'
$viteScript = Join-Path $frontendDirectory 'node_modules\vite\bin\vite.js'
$runtimeDirectory = Join-Path $projectRoot '.crosswordcreator-runtime'

if (-not (Get-Command dotnet.exe -ErrorAction SilentlyContinue)) {
    throw '.NET 10 SDK was not found. Install it and try again.'
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js was not found. Install it and try again.'
}

$hasBackendPid = Test-Path (Join-Path $runtimeDirectory 'backend.pid')
$hasFrontendPid = Test-Path (Join-Path $runtimeDirectory 'frontend.pid')
if ($hasBackendPid -or $hasFrontendPid) {
    throw 'CrosswordCreator may already be running. Use stop-local.bat before starting it again.'
}

$busyPorts = Get-NetTCPConnection -State Listen -LocalPort 5074, 5173 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty LocalPort -Unique
if ($busyPorts) {
    throw "Port(s) $($busyPorts -join ', ') are already in use. Close the application using them, then try again."
}

if (-not (Test-Path $viteScript)) {
    Write-Host 'Installing frontend dependencies...'
    Push-Location $frontendDirectory
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) {
            throw 'Frontend dependency installation failed.'
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host 'Building the API...'
& dotnet.exe build $apiProject
if ($LASTEXITCODE -ne 0) {
    throw 'API build failed.'
}

if (-not (Test-Path $apiDll)) {
    throw "The API build did not produce '$apiDll'."
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$apiProcess = $null
$frontendProcess = $null
try {
    $apiArguments = '"' + $apiDll + '" --urls http://localhost:5074'
    $apiProcess = Start-Process `
        -FilePath 'dotnet.exe' `
        -ArgumentList $apiArguments `
        -WorkingDirectory $apiDirectory `
        -PassThru `
        -WindowStyle Normal
    [System.IO.File]::WriteAllText(
        (Join-Path $runtimeDirectory 'backend.pid'),
        [string]$apiProcess.Id)

    $frontendArguments = '"' + $viteScript + '" --host 127.0.0.1'
    $frontendProcess = Start-Process `
        -FilePath 'node.exe' `
        -ArgumentList $frontendArguments `
        -WorkingDirectory $frontendDirectory `
        -PassThru `
        -WindowStyle Normal
    [System.IO.File]::WriteAllText(
        (Join-Path $runtimeDirectory 'frontend.pid'),
        [string]$frontendProcess.Id)
}
catch {
    if ($frontendProcess) {
        Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($apiProcess) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath (Join-Path $runtimeDirectory 'frontend.pid') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $runtimeDirectory 'backend.pid') -Force -ErrorAction SilentlyContinue
    throw
}

$ready = $false
for ($attempt = 0; $attempt -lt 40 -and -not $ready; $attempt++) {
    $readyPorts = Get-NetTCPConnection -State Listen -LocalPort 5074, 5173 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty LocalPort -Unique
    $ready = ($readyPorts -contains 5074) -and ($readyPorts -contains 5173)
    if (-not $ready) {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $ready) {
    & (Join-Path $PSScriptRoot 'stop-local.ps1')
    throw 'The application did not start in time.'
}

Write-Host 'CrosswordCreator is running at http://127.0.0.1:5173/'
Start-Process 'http://127.0.0.1:5173/'
