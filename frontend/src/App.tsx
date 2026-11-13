import { memo, useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

const MAX_DIMENSION = 100

interface ApiHealth {
  status: string
  service: string
}

interface SavedPuzzle {
  id: string
  title: string
}

interface GridCellProps {
  row: number
  column: number
  value: string
  onChange: (row: number, column: number, value: string) => void
  onKeyDown: (row: number, column: number, value: string, event: KeyboardEvent<HTMLInputElement>) => void
}

function createBlankGrid(width: number, height: number) {
  return Array.from({ length: height }, () => '.'.repeat(width))
}

const GridCell = memo(function GridCell({
  row,
  column,
  value,
  onChange,
  onKeyDown,
}: GridCellProps) {
  return (
    <input
      id={`cell-${row}-${column}`}
      className="grid-cell"
      type="text"
      inputMode="text"
      autoComplete="off"
      maxLength={1}
      aria-label={`Row ${row + 1}, column ${column + 1}`}
      value={value === '.' ? '' : value}
      onChange={(event) => onChange(row, column, event.currentTarget.value)}
      onKeyDown={(event) => onKeyDown(row, column, value, event)}
    />
  )
})

function App() {
  const [width, setWidth] = useState(10)
  const [height, setHeight] = useState(10)
  const [pendingWidth, setPendingWidth] = useState('10')
  const [pendingHeight, setPendingHeight] = useState('10')
  const [title, setTitle] = useState('Untitled crossword')
  const [cells, setCells] = useState(() => createBlankGrid(MAX_DIMENSION, MAX_DIMENSION))
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedPuzzle, setSavedPuzzle] = useState<SavedPuzzle | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`API request failed (${response.status})`)
        }

        setApiHealth(await response.json() as ApiHealth)
        setApiError(null)
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }

        setApiError(requestError instanceof Error ? requestError.message : 'Unable to reach the API')
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [])

  const focusCell = useCallback((row: number, column: number) => {
    requestAnimationFrame(() => document.getElementById(`cell-${row}-${column}`)?.focus())
  }, [])

  const handleCellChange = useCallback((row: number, column: number, rawValue: string) => {
    const value = rawValue.toUpperCase()
    if (value !== '' && !/^[A-Z]$/.test(value)) {
      setError('Enter one letter from A to Z per square.')
      return
    }

    setCells((current) => current.map((currentRow, rowIndex) => {
      if (rowIndex !== row) {
        return currentRow
      }

      const letter = value || '.'
      return `${currentRow.slice(0, column)}${letter}${currentRow.slice(column + 1)}`
    }))
    setSavedPuzzle(null)
    setError(null)

    if (value) {
      const nextIndex = row * width + column + 1
      if (nextIndex < width * height) {
        focusCell(Math.floor(nextIndex / width), nextIndex % width)
      }
    }
  }, [focusCell, height, width])

  const handleCellKeyDown = useCallback((
    row: number,
    column: number,
    value: string,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    }
    const direction = movement[event.key]

    if (direction) {
      const nextRow = row + direction[0]
      const nextColumn = column + direction[1]
      if (nextRow >= 0 && nextRow < height && nextColumn >= 0 && nextColumn < width) {
        event.preventDefault()
        focusCell(nextRow, nextColumn)
      }
    } else if (event.key === 'Backspace' && value === '.' && column > 0) {
      event.preventDefault()
      focusCell(row, column - 1)
    }
  }, [focusCell, height, width])

  function handleWidthChange(value: string) {
    setPendingWidth(value)
    if (value === '') {
      setError(null)
      return
    }

    const nextWidth = Number(value)
    if (!Number.isInteger(nextWidth) || nextWidth < 1 || nextWidth > MAX_DIMENSION) {
      setError(`Grid width must be between 1 and ${MAX_DIMENSION}.`)
      return
    }

    resizeGrid(nextWidth, height)
  }

  function handleHeightChange(value: string) {
    setPendingHeight(value)
    if (value === '') {
      setError(null)
      return
    }

    const nextHeight = Number(value)
    if (!Number.isInteger(nextHeight) || nextHeight < 1 || nextHeight > MAX_DIMENSION) {
      setError(`Grid height must be between 1 and ${MAX_DIMENSION}.`)
      return
    }

    resizeGrid(width, nextHeight)
  }

  function resizeGrid(nextWidth: number, nextHeight: number) {
    const removesLetters = cells.some((row, rowIndex) => (
      Array.from(row).some((cell, columnIndex) => (
        cell !== '.' && (rowIndex >= nextHeight || columnIndex >= nextWidth)
      ))
    ))
    if (
      removesLetters
      && !window.confirm('Resizing will remove letters outside the new grid and may cut words. Continue?')
    ) {
      setPendingWidth(String(width))
      setPendingHeight(String(height))
      setError(null)
      return
    }

    if (removesLetters) {
      setCells((current) => current.map((row, rowIndex) => (
        rowIndex >= nextHeight
          ? '.'.repeat(MAX_DIMENSION)
          : `${row.slice(0, nextWidth)}${'.'.repeat(MAX_DIMENSION - nextWidth)}`
      )))
    }

    setWidth(nextWidth)
    setHeight(nextHeight)
    setSavedPuzzle(null)
    setError(null)
  }

  async function saveCrossword() {
    const requestedWidth = Number(pendingWidth)
    const requestedHeight = Number(pendingHeight)
    if (
      !Number.isInteger(requestedWidth)
      || !Number.isInteger(requestedHeight)
      || requestedWidth < 1
      || requestedWidth > MAX_DIMENSION
      || requestedHeight < 1
      || requestedHeight > MAX_DIMENSION
    ) {
      setError(`Grid width and height must each be between 1 and ${MAX_DIMENSION}.`)
      return
    }

    if (requestedWidth !== width || requestedHeight !== height) {
      setError('Finish editing the grid size before saving.')
      return
    }

    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setError('Enter a title before saving.')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/puzzles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: normalizedTitle,
          width,
          height,
          cells: cells.slice(0, height).map((row) => row.slice(0, width)),
        }),
      })
      const result = await response.json() as {
        id?: string
        title?: string
        errors?: Record<string, string[]>
        detail?: string
      }

      if (!response.ok) {
        const validationMessage = Object.values(result.errors ?? {}).flat()[0]
        throw new Error(validationMessage ?? result.detail ?? `Save failed (${response.status})`)
      }

      if (!result.id || !result.title) {
        throw new Error('The server returned an invalid save confirmation.')
      }

      setSavedPuzzle({ id: result.id, title: result.title })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the crossword.')
      setSavedPuzzle(null)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="page">
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">CC</div>
            <div>
              <p className="eyebrow">Crossword workshop</p>
              <h1>CrosswordCreator</h1>
            </div>
          </div>
          <div className={`api-status${apiError ? ' api-status--error' : ''}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {apiError
              ? 'API unavailable'
              : apiHealth
                ? 'Ready to save'
                : 'Connecting to the API…'}
          </div>
        </header>

        <section className="editor-card" aria-labelledby="editor-title">
          <div className="editor-heading">
            <div>
              <p className="eyebrow">New puzzle</p>
              <h2 id="editor-title">Build your grid</h2>
            </div>
            <p className="editor-hint">
              Start with a blank grid, then fill in letters. Resizing warns before removing letters.
            </p>
          </div>

          <div className="editor-controls">
            <label className="title-field" htmlFor="puzzle-title">
              <span>Crossword title</span>
              <input
                id="puzzle-title"
                type="text"
                maxLength={200}
                value={title}
                onChange={(event) => {
                  setTitle(event.currentTarget.value)
                  setSavedPuzzle(null)
                  setError(null)
                }}
              />
            </label>

            <div className="size-controls" aria-label="Grid size">
              <label htmlFor="grid-width">
                <span>Width</span>
                <input
                  id="grid-width"
                  type="number"
                  min={1}
                  max={MAX_DIMENSION}
                  step={1}
                  value={pendingWidth}
                  onChange={(event) => handleWidthChange(event.currentTarget.value)}
                />
              </label>
              <span className="size-times" aria-hidden="true">×</span>
              <label htmlFor="grid-height">
                <span>Height</span>
                <input
                  id="grid-height"
                  type="number"
                  min={1}
                  max={MAX_DIMENSION}
                  step={1}
                  value={pendingHeight}
                  onChange={(event) => handleHeightChange(event.currentTarget.value)}
                />
              </label>
            </div>
          </div>

          <div className="grid-heading">
            <span>{width} × {height} squares</span>
            <span>Type A–Z · arrows move between squares</span>
          </div>

          <div className="grid-viewport" aria-label="Crossword grid">
            <div
              className="letter-grid"
              style={{ gridTemplateColumns: `repeat(${width}, 34px)` }}
            >
              {cells.slice(0, height).flatMap((row, rowIndex) => (
                Array.from(row.slice(0, width), (value, columnIndex) => (
                <GridCell
                  key={`${rowIndex}-${columnIndex}`}
                  row={rowIndex}
                  column={columnIndex}
                  value={value}
                  onChange={handleCellChange}
                  onKeyDown={handleCellKeyDown}
                />
                ))
              ))}
            </div>
          </div>

          <div className="editor-footer">
            <div className="feedback-area" aria-live="polite">
              {error && <p className="feedback feedback--error" role="alert">{error}</p>}
              {savedPuzzle && (
                <p className="feedback feedback--success" role="status">
                  “{savedPuzzle.title}” saved to your local database.
                </p>
              )}
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={isSaving}
              onClick={() => void saveCrossword()}
            >
              {isSaving ? 'Saving…' : 'Save crossword'}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
