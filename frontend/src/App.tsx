import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import HintEditor from './HintEditor'

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
  tabIndex: number
  hintToolActive: boolean
  onChange: (row: number, column: number, value: string) => void
  onKeyDown: (row: number, column: number, value: string, event: KeyboardEvent<HTMLInputElement>) => void
  onHintClick: (row: number, column: number, value: string) => void
}

interface ActiveHint {
  row: number
  column: number
  direction: 'across' | 'down'
}

interface HintTile extends ActiveHint {
  imageId: string | null
}

interface HintTileCellProps {
  row: number
  column: number
  tile: HintTile
  enabled: boolean
  onClick: () => void
}

function createBlankGrid(width: number, height: number) {
  return Array.from({ length: height }, () => '.'.repeat(width))
}

function createDefaultHintTiles(width: number, height: number) {
  const tiles: Record<string, HintTile> = {}

  for (let row = 0; row < height; row += 1) {
    tiles[hintPositionKey(row, 0)] = {
      row,
      column: 0,
      direction: 'across',
      imageId: null,
    }
  }

  for (let column = 1; column < width; column += 1) {
    tiles[hintPositionKey(0, column)] = {
      row: 0,
      column,
      direction: 'down',
      imageId: null,
    }
  }

  return tiles
}

function hintPositionKey(row: number, column: number) {
  return `${row}:${column}`
}

function getGridTraversalOrder(
  width: number,
  height: number,
  hintTiles: Record<string, HintTile>,
  direction: 'right' | 'down',
) {
  const cells: Array<{ row: number; column: number }> = []
  if (direction === 'down') {
    for (let column = 0; column < width; column += 1) {
      for (let row = 0; row < height; row += 1) {
        if (!hintTiles[hintPositionKey(row, column)]) {
          cells.push({ row, column })
        }
      }
    }
  } else {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        if (!hintTiles[hintPositionKey(row, column)]) {
          cells.push({ row, column })
        }
      }
    }
  }

  return cells
}

const GridCell = memo(function GridCell({
  row,
  column,
  value,
  tabIndex,
  hintToolActive,
  onChange,
  onKeyDown,
  onHintClick,
}: GridCellProps) {
  return (
    <input
      id={`cell-${row}-${column}`}
      className={`grid-cell${hintToolActive ? ' grid-cell--hint-ready' : ''}`}
      type="text"
      inputMode="text"
      autoComplete="off"
      maxLength={1}
      tabIndex={tabIndex}
      aria-label={`Row ${row + 1}, column ${column + 1}`}
      value={value === '.' ? '' : value}
      onClick={(event) => {
        if (hintToolActive) {
          onHintClick(row, column, value)
          return
        }

        const end = event.currentTarget.value.length
        event.currentTarget.setSelectionRange(end, end)
      }}
      onChange={(event) => onChange(row, column, event.currentTarget.value)}
      onKeyDown={(event) => onKeyDown(row, column, value, event)}
    />
  )
})

const HintTileCell = memo(function HintTileCell({
  row,
  column,
  tile,
  enabled,
  onClick,
}: HintTileCellProps) {
  const label = `${tile.direction === 'across' ? 'Across' : 'Down'} hint at row ${row + 1}, column ${column + 1}`

  return (
    <button
      className={`hint-cell${tile.imageId ? ' hint-cell--filled' : ''}`}
      type="button"
      aria-label={label}
      title={enabled ? `${label}: add or edit` : 'Select the hint tool to add or edit this clue'}
      disabled={!enabled}
      onClick={onClick}
    >
      {tile.imageId
        ? <img src={`/api/hint-images/${tile.imageId}`} alt="" />
        : <span aria-hidden="true">+</span>}
    </button>
  )
})

function App() {
  const [width, setWidth] = useState(10)
  const [height, setHeight] = useState(10)
  const [pendingWidth, setPendingWidth] = useState('10')
  const [pendingHeight, setPendingHeight] = useState('10')
  const [title, setTitle] = useState('Untitled crossword')
  const [cells, setCells] = useState(() => createBlankGrid(MAX_DIMENSION, MAX_DIMENSION))
  const [hintTiles, setHintTiles] = useState<Record<string, HintTile>>(
    () => createDefaultHintTiles(10, 10),
  )
  const [tabDirection, setTabDirection] = useState<'right' | 'down'>('right')
  const [isHintToolActive, setIsHintToolActive] = useState(false)
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null)
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedPuzzle, setSavedPuzzle] = useState<SavedPuzzle | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const tabDirectionButtonRef = useRef<HTMLButtonElement>(null)
  const saveCrosswordButtonRef = useRef<HTMLButtonElement>(null)

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

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        if (document.querySelector('.hint-editor')) {
          return
        }

        setActiveHint(null)
        setIsHintToolActive(false)
        return
      }

      const shortcut = event.key.toLowerCase()
      if ((shortcut !== 'h' && shortcut !== 'u') || event.repeat) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement
        && (
          target.closest('.hint-editor') !== null
          || target.isContentEditable
          || target instanceof HTMLTextAreaElement
          || target instanceof HTMLSelectElement
          || (target instanceof HTMLInputElement && !target.classList.contains('grid-cell'))
        )
      ) {
        return
      }

      const isGridCell = target instanceof HTMLInputElement && target.classList.contains('grid-cell')
      if (isGridCell) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return
        }
      } else if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      event.preventDefault()
      if (shortcut === 'h') {
        setIsHintToolActive((current) => !current)
      } else {
        setTabDirection((current) => (current === 'right' ? 'down' : 'right'))
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const focusCell = useCallback((row: number, column: number) => {
    requestAnimationFrame(() => document.getElementById(`cell-${row}-${column}`)?.focus())
  }, [])

  const handleCellChange = useCallback((row: number, column: number, rawValue: string) => {
    const value = rawValue.toUpperCase()
    if (value !== '' && !/^[A-ZÅÄÖÆØÐÞ]$/.test(value)) {
      setError('Enter one letter from A to Z or a Nordic letter (Å, Ä, Ö, Æ, Ø, Ð, Þ) per square.')
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
      const traversalOrder = getGridTraversalOrder(width, height, hintTiles, tabDirection)
      const currentIndex = traversalOrder.findIndex((cell) => cell.row === row && cell.column === column)
      const nextCell = traversalOrder[currentIndex + 1]
      if (nextCell) {
        focusCell(nextCell.row, nextCell.column)
      }
    }
  }, [focusCell, height, hintTiles, tabDirection, width])

  const handleCellKeyDown = useCallback((
    row: number,
    column: number,
    value: string,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Tab' && tabDirection === 'down' && !isHintToolActive) {
      const tabOrder = getGridTraversalOrder(width, height, hintTiles, 'down')
      const currentIndex = tabOrder.findIndex((cell) => cell.row === row && cell.column === column)
      if (currentIndex !== -1) {
        event.preventDefault()
        const nextCell = tabOrder[currentIndex + (event.shiftKey ? -1 : 1)]
        if (nextCell) {
          focusCell(nextCell.row, nextCell.column)
        } else if (event.shiftKey) {
          tabDirectionButtonRef.current?.focus()
        } else {
          saveCrosswordButtonRef.current?.focus()
        }
      }
      return
    }

    const movement: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    }
    const direction = movement[event.key]

    if (direction) {
      let nextRow = row + direction[0]
      let nextColumn = column + direction[1]
      while (nextRow >= 0 && nextRow < height && nextColumn >= 0 && nextColumn < width) {
        if (!hintTiles[hintPositionKey(nextRow, nextColumn)]) {
          event.preventDefault()
          focusCell(nextRow, nextColumn)
          break
        }

        nextRow += direction[0]
        nextColumn += direction[1]
      }
    } else if (event.key === 'Backspace' && value === '.') {
      const traversalOrder = getGridTraversalOrder(width, height, hintTiles, tabDirection)
      const currentIndex = traversalOrder.findIndex((cell) => cell.row === row && cell.column === column)
      const previousCell = traversalOrder[currentIndex - 1]
      if (previousCell) {
        event.preventDefault()
        focusCell(previousCell.row, previousCell.column)
      }
    }
  }, [focusCell, height, hintTiles, isHintToolActive, tabDirection, width])

  const verticalTabOrder = tabDirection === 'down' && !isHintToolActive
    ? getGridTraversalOrder(width, height, hintTiles, 'down')
    : []
  const verticalTabFirstCellKey = verticalTabOrder.length > 0
    ? hintPositionKey(verticalTabOrder[0].row, verticalTabOrder[0].column)
    : null

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
    const removesHints = Object.values(hintTiles).some(
      ({ row, column }) => row >= nextHeight || column >= nextWidth,
    )
    if (
      (removesLetters || removesHints)
      && !window.confirm('Resizing will remove letters or hints outside the new grid and may cut words. Continue?')
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

    setHintTiles((current) => {
      const nextTiles: Record<string, HintTile> = {}
      for (const [key, tile] of Object.entries(current)) {
        if (tile.row < nextHeight && tile.column < nextWidth) {
          nextTiles[key] = tile
        }
      }

      for (const [key, tile] of Object.entries(createDefaultHintTiles(nextWidth, nextHeight))) {
        const newlyAddedEdge = tile.row >= height || tile.column >= width
        if (newlyAddedEdge && !nextTiles[key]) {
          nextTiles[key] = tile
        }
      }

      return nextTiles
    })

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
          hints: Object.values(hintTiles),
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

  async function uploadHintImage(image: Blob) {
    const formData = new FormData()
    formData.append('image', image, 'hint.png')

    const response = await fetch('/api/hint-images', {
      method: 'POST',
      body: formData,
    })
    const result = await response.json() as {
      id?: string
      detail?: string
      title?: string
    }
    if (!response.ok) {
      throw new Error(result.detail ?? result.title ?? `Image upload failed (${response.status})`)
    }
    if (!result.id) {
      throw new Error('The server returned an invalid image confirmation.')
    }

    return result.id
  }

  function handleHintTileClick(row: number, column: number, value: string) {
    const key = hintPositionKey(row, column)
    const existingTile = hintTiles[key]
    if (existingTile) {
      setActiveHint({
        row,
        column,
        direction: existingTile.direction,
      })
      return
    }

    if (
      value !== '.'
      && !window.confirm('This square contains a letter. Convert it to a hint tile and erase the letter?')
    ) {
      return
    }

    setCells((current) => current.map((currentRow, rowIndex) => (
      rowIndex === row
        ? `${currentRow.slice(0, column)}.${currentRow.slice(column + 1)}`
        : currentRow
    )))
    setHintTiles((current) => ({
      ...current,
      [key]: {
        row,
        column,
        direction: 'across',
        imageId: null,
      },
    }))
    setSavedPuzzle(null)
    setError(null)
    setActiveHint({ row, column, direction: 'across' })
  }

  function handleHintDirectionChange(direction: ActiveHint['direction']) {
    if (!activeHint) {
      return
    }

    const key = hintPositionKey(activeHint.row, activeHint.column)
    setHintTiles((current) => {
      const tile = current[key]
      return tile ? { ...current, [key]: { ...tile, direction } } : current
    })
    setActiveHint((current) => (current ? { ...current, direction } : current))
    setSavedPuzzle(null)
  }

  function handleHintSaved(imageId: string) {
    if (!activeHint) {
      return
    }

    const key = hintPositionKey(activeHint.row, activeHint.column)
    setHintTiles((current) => {
      const tile = current[key]
      return tile ? { ...current, [key]: { ...tile, imageId } } : current
    })
    setSavedPuzzle(null)
    setError(null)
    setActiveHint(null)
  }

  function removeActiveHint() {
    if (!activeHint) {
      return
    }

    const key = hintPositionKey(activeHint.row, activeHint.column)
    const tile = hintTiles[key]
    if (
      tile?.imageId
      && !window.confirm('This hint already has an image saved. Remove the hint from this grid?')
    ) {
      return
    }

    setHintTiles((current) => {
      const updated = { ...current }
      delete updated[key]
      return updated
    })
    setSavedPuzzle(null)
    setActiveHint(null)
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
              Use the hint tool on any square to replace it with an across or down clue tile. Resizing warns before removing content.
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
            <span>Type A–Z or Nordic letters · arrows move between squares</span>
          </div>

          <div className="editor-tools">
            <button
              className={`secondary-button${isHintToolActive ? ' secondary-button--selected' : ''}`}
              type="button"
              aria-label="Toggle hint tool (H outside editable fields; Alt+H in grid cells)"
              title="Press H outside editable fields, or Alt+H in a grid cell, to toggle the hint tool"
              aria-pressed={isHintToolActive}
              onClick={() => setIsHintToolActive((current) => !current)}
            >
              Hint tool <kbd>H</kbd>
            </button>
            <button
              ref={tabDirectionButtonRef}
              className={`secondary-button${tabDirection === 'down' ? ' secondary-button--selected' : ''}`}
              type="button"
              aria-label={`Tab moves ${tabDirection}; press U outside editable fields or Alt+U in a grid cell to switch direction`}
              aria-pressed={tabDirection === 'down'}
              title="Press U outside editable fields, or Alt+U in a grid cell, to switch Tab direction"
              onClick={() => setTabDirection((current) => (current === 'right' ? 'down' : 'right'))}
            >
              Tab: {tabDirection === 'right' ? 'Right' : 'Down'} <kbd>U</kbd>
            </button>
            <span>The left column starts with Across hints; the top row starts with Down hints. Use the hint tool to edit them or add a hint anywhere. Press Esc to return to letters. Use Alt+H/Alt+U in a grid square so H/U remain available as letters.</span>
          </div>

          <div className="grid-viewport" aria-label="Crossword grid">
            <div
              className="letter-grid"
              style={{ gridTemplateColumns: `repeat(${width}, 34px)` }}
            >
              {cells.slice(0, height).flatMap((row, rowIndex) => (
                Array.from(row.slice(0, width), (value, columnIndex) => {
                  const key = hintPositionKey(rowIndex, columnIndex)
                  const tile = hintTiles[key]
                  if (tile) {
                    return (
                      <HintTileCell
                        key={key}
                        row={rowIndex}
                        column={columnIndex}
                        tile={tile}
                        enabled={isHintToolActive}
                        onClick={() => setActiveHint({
                          row: rowIndex,
                          column: columnIndex,
                          direction: tile.direction,
                        })}
                      />
                    )
                  }

                  return (
                    <GridCell
                      key={key}
                      row={rowIndex}
                      column={columnIndex}
                      value={value}
                      tabIndex={verticalTabOrder.length === 0
                        || key === verticalTabFirstCellKey
                        ? 0
                        : -1}
                      hintToolActive={isHintToolActive}
                      onChange={handleCellChange}
                      onKeyDown={handleCellKeyDown}
                      onHintClick={handleHintTileClick}
                    />
                  )
                })
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
              ref={saveCrosswordButtonRef}
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
      {activeHint && (
        <HintEditor
          title={`Hint · Row ${activeHint.row + 1}, Column ${activeHint.column + 1}`}
          direction={activeHint.direction}
          imageId={hintTiles[hintPositionKey(activeHint.row, activeHint.column)]?.imageId ?? undefined}
          onCancel={() => setActiveHint(null)}
          onEscape={() => setIsHintToolActive(false)}
          onDirectionChange={handleHintDirectionChange}
          onSave={uploadHintImage}
          onSaved={handleHintSaved}
          onRemove={removeActiveHint}
        />
      )}
    </main>
  )
}

export default App
