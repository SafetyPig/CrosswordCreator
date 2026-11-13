import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

interface PuzzleContent {
  width: number
  height: number
  cells: string[]
  hints?: HintTileData[]
}

interface PuzzleResponse extends SavedPuzzle {
  content: PuzzleContent
}

interface GridCellProps {
  row: number
  column: number
  value: string
  tabIndex: number
  hintToolActive: boolean
  rangeSelected: boolean
  onPointerDown: (row: number, column: number, pointerId: number) => void
  onChange: (row: number, column: number, value: string) => void
  onKeyDown: (row: number, column: number, value: string, event: KeyboardEvent<HTMLInputElement>) => void
  onHintClick: (row: number, column: number, value: string) => void
}

interface ActiveHint {
  row: number
  column: number
  direction: 'across' | 'down'
}

interface HintPosition {
  row: number
  column: number
}

interface HintDragSelection {
  start: HintPosition
  end: HintPosition
  pointerId: number
}

interface HintTile extends ActiveHint {
  imageId: string | null
  rowSpan: number
  columnSpan: number
}

interface HintTileData extends ActiveHint {
  imageId: string | null
  rowSpan?: number
  columnSpan?: number
  span?: number
}

interface HintTileCellProps {
  row: number
  column: number
  tile: HintTile
  hintToolActive: boolean
  rangeSelected: boolean
  onPointerDown: (row: number, column: number, pointerId: number) => void
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
      rowSpan: 1,
      columnSpan: 1,
    }
  }

  for (let column = 1; column < width; column += 1) {
    tiles[hintPositionKey(0, column)] = {
      row: 0,
      column,
      direction: 'down',
      imageId: null,
      rowSpan: 1,
      columnSpan: 1,
    }
  }

  return tiles
}

function hintPositionKey(row: number, column: number) {
  return `${row}:${column}`
}

function getCoveredHintPositionKeys(hintTiles: Record<string, HintTile>) {
  const covered = new Set<string>()
  for (const tile of Object.values(hintTiles)) {
    for (let rowOffset = 0; rowOffset < tile.rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < tile.columnSpan; columnOffset += 1) {
        if (rowOffset !== 0 || columnOffset !== 0) {
          covered.add(hintPositionKey(tile.row + rowOffset, tile.column + columnOffset))
        }
      }
    }
  }

  return covered
}

function getHintRectangle(tile: Pick<HintTile, 'row' | 'column' | 'rowSpan' | 'columnSpan'>) {
  return {
    row: tile.row,
    column: tile.column,
    rowSpan: tile.rowSpan,
    columnSpan: tile.columnSpan,
  }
}

function hintRectanglesOverlap(
  first: ReturnType<typeof getHintRectangle>,
  second: ReturnType<typeof getHintRectangle>,
) {
  return first.row < second.row + second.rowSpan
    && second.row < first.row + first.rowSpan
    && first.column < second.column + second.columnSpan
    && second.column < first.column + first.columnSpan
}

function hintRectangleContains(
  outer: ReturnType<typeof getHintRectangle>,
  inner: ReturnType<typeof getHintRectangle>,
) {
  return outer.row <= inner.row
    && outer.column <= inner.column
    && outer.row + outer.rowSpan >= inner.row + inner.rowSpan
    && outer.column + outer.columnSpan >= inner.column + inner.columnSpan
}

function getHintSelectionRectangle(
  selection: HintDragSelection | null,
  hintTiles: Record<string, HintTile>,
  width: number,
  height: number,
) {
  if (!selection) {
    return null
  }

  const rectangle = {
    row: Math.min(selection.start.row, selection.end.row),
    column: Math.min(selection.start.column, selection.end.column),
    rowSpan: Math.abs(selection.start.row - selection.end.row) + 1,
    columnSpan: Math.abs(selection.start.column - selection.end.column) + 1,
  }

  let expanded = true
  while (expanded) {
    expanded = false
    for (const tile of Object.values(hintTiles)) {
      const tileRectangle = getHintRectangle(tile)
      if (hintRectanglesOverlap(rectangle, tileRectangle)
        && !hintRectangleContains(rectangle, tileRectangle)) {
        const bottom = Math.max(
          rectangle.row + rectangle.rowSpan,
          tileRectangle.row + tileRectangle.rowSpan,
        )
        const right = Math.max(
          rectangle.column + rectangle.columnSpan,
          tileRectangle.column + tileRectangle.columnSpan,
        )
        rectangle.row = Math.min(rectangle.row, tileRectangle.row)
        rectangle.column = Math.min(rectangle.column, tileRectangle.column)
        rectangle.rowSpan = bottom - rectangle.row
        rectangle.columnSpan = right - rectangle.column
        expanded = true
      }
    }
  }

  if (
    rectangle.row < 0
    || rectangle.column < 0
    || rectangle.row + rectangle.rowSpan > height
    || rectangle.column + rectangle.columnSpan > width
  ) {
    return null
  }

  return rectangle
}

function getHintSelectionTileKeys(
  selectionRectangle: ReturnType<typeof getHintSelectionRectangle>,
  hintTiles: Record<string, HintTile>,
) {
  const selected = new Set<string>()
  if (!selectionRectangle) {
    return selected
  }

  for (const tile of Object.values(hintTiles)) {
    if (hintRectanglesOverlap(selectionRectangle, getHintRectangle(tile))) {
      selected.add(hintPositionKey(tile.row, tile.column))
    }
  }

  return selected
}

function getHintTilePositionFromPointerEvent(
  event: globalThis.PointerEvent,
) {
  if (!(event.target instanceof Element)) {
    return null
  }

  const gridCell = event.target.closest<HTMLElement>('[data-grid-row][data-grid-column]')
  if (!gridCell) {
    return null
  }

  const row = Number(gridCell.dataset.gridRow)
  const column = Number(gridCell.dataset.gridColumn)
  const rowSpan = Number(gridCell.dataset.rowSpan ?? 1)
  const columnSpan = Number(gridCell.dataset.columnSpan ?? 1)
  const bounds = gridCell.getBoundingClientRect()
  const rowStep = (bounds.height + rowSpan - 1) / rowSpan
  const columnStep = (bounds.width + columnSpan - 1) / columnSpan
  const rowOffset = Math.min(rowSpan - 1, Math.floor((event.clientY - bounds.top) / rowStep))
  const columnOffset = Math.min(
    columnSpan - 1,
    Math.floor((event.clientX - bounds.left) / columnStep),
  )

  return {
    row: row + rowOffset,
    column: column + columnOffset,
  }
}

function getHintDimensionOptions(
  tile: HintTile,
  hintTiles: Record<string, HintTile>,
  width: number,
  height: number,
  dimension: 'rows' | 'columns',
) {
  const maximum = dimension === 'rows'
    ? height - tile.row
    : width - tile.column

  return Array.from({ length: maximum }, (_, index) => index + 1).filter((size) => {
    const candidate = {
      row: tile.row,
      column: tile.column,
      rowSpan: dimension === 'rows' ? size : tile.rowSpan,
      columnSpan: dimension === 'columns' ? size : tile.columnSpan,
    }

    return Object.values(hintTiles).every((otherTile) => {
      if (otherTile.row === tile.row && otherTile.column === tile.column) {
        return true
      }

      const otherRectangle = getHintRectangle(otherTile)
      return !hintRectanglesOverlap(candidate, otherRectangle)
        || hintRectangleContains(candidate, otherRectangle)
    })
  })
}

function isSavedPuzzle(value: unknown): value is SavedPuzzle {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && typeof value.id === 'string'
    && 'title' in value
    && typeof value.title === 'string'
}

function getGridTraversalOrder(
  width: number,
  height: number,
  hintTiles: Record<string, HintTile>,
  direction: 'right' | 'down',
) {
  const cells: Array<{ row: number; column: number }> = []
  const coveredHintKeys = getCoveredHintPositionKeys(hintTiles)
  if (direction === 'down') {
    for (let column = 0; column < width; column += 1) {
      for (let row = 0; row < height; row += 1) {
        const key = hintPositionKey(row, column)
        if (!hintTiles[key] && !coveredHintKeys.has(key)) {
          cells.push({ row, column })
        }
      }
    }
  } else {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const key = hintPositionKey(row, column)
        if (!hintTiles[key] && !coveredHintKeys.has(key)) {
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
  rangeSelected,
  onPointerDown,
  onChange,
  onKeyDown,
  onHintClick,
}: GridCellProps) {
  return (
    <input
      id={`cell-${row}-${column}`}
      className={`grid-cell${hintToolActive ? ' grid-cell--hint-ready' : ''}${rangeSelected ? ' grid-cell--range-selected' : ''}`}
      type="text"
      inputMode="text"
      autoComplete="off"
      maxLength={1}
      tabIndex={tabIndex}
      aria-label={`Row ${row + 1}, column ${column + 1}`}
      value={value === '.' ? '' : value}
      data-grid-row={row}
      data-grid-column={column}
      data-row-span="1"
      data-column-span="1"
      style={{ gridRow: row + 1, gridColumn: column + 1 }}
      onPointerDown={(event) => {
        if (hintToolActive && event.button === 0) {
          onPointerDown(row, column, event.pointerId)
        }
      }}
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
  hintToolActive,
  rangeSelected,
  onPointerDown,
  onClick,
}: HintTileCellProps) {
  const isSpanned = tile.rowSpan > 1 || tile.columnSpan > 1
  const label = `${tile.direction === 'across' ? 'Across' : 'Down'} hint at row ${row + 1}, column ${column + 1}${isSpanned ? `, ${tile.rowSpan} by ${tile.columnSpan} boxes` : ''}`
  const spanStyle = {
    gridRow: `${row + 1} / span ${tile.rowSpan}`,
    gridColumn: `${column + 1} / span ${tile.columnSpan}`,
  }

  return (
    <button
      className={`hint-cell${tile.imageId ? ' hint-cell--filled' : ''}${isSpanned ? ' hint-cell--spanned' : ''}${hintToolActive ? ' hint-cell--hint-tool-active' : ''}${rangeSelected ? ' hint-cell--range-selected' : ''}`}
      type="button"
      aria-label={label}
      title={hintToolActive
        ? `${label}: drag across grid squares to create a rectangular hint`
        : `${label}: add or edit`}
      data-grid-row={row}
      data-grid-column={column}
      data-row-span={tile.rowSpan}
      data-column-span={tile.columnSpan}
      style={spanStyle}
      onPointerDown={(event) => {
        if (hintToolActive && event.button === 0) {
          onPointerDown(row, column, event.pointerId)
        }
      }}
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
  const [puzzles, setPuzzles] = useState<SavedPuzzle[]>([])
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null)
  const [cells, setCells] = useState(() => createBlankGrid(MAX_DIMENSION, MAX_DIMENSION))
  const [hintTiles, setHintTiles] = useState<Record<string, HintTile>>(
    () => createDefaultHintTiles(10, 10),
  )
  const [isDirty, setIsDirty] = useState(false)
  const [isLoadingPuzzle, setIsLoadingPuzzle] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [tabDirection, setTabDirection] = useState<'right' | 'down'>('right')
  const [isHintToolActive, setIsHintToolActive] = useState(false)
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null)
  const [hintDragSelection, setHintDragSelection] = useState<HintDragSelection | null>(null)
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedPuzzle, setSavedPuzzle] = useState<SavedPuzzle | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const tabDirectionButtonRef = useRef<HTMLButtonElement>(null)
  const saveCrosswordButtonRef = useRef<HTMLButtonElement>(null)
  const hintDragSelectionRef = useRef<HintDragSelection | null>(null)
  const suppressHintClickRef = useRef(false)
  const coveredHintPositionKeys = useMemo(
    () => getCoveredHintPositionKeys(hintTiles),
    [hintTiles],
  )
  const hintDragRectangle = useMemo(
    () => getHintSelectionRectangle(hintDragSelection, hintTiles, width, height),
    [height, hintDragSelection, hintTiles, width],
  )
  const selectedHintTileKeys = useMemo(
    () => getHintSelectionTileKeys(hintDragRectangle, hintTiles),
    [hintDragRectangle, hintTiles],
  )

  function updateHintDragSelection(selection: HintDragSelection | null) {
    hintDragSelectionRef.current = selection
    setHintDragSelection(selection)
  }

  useEffect(() => {
    if (!hintDragSelection) {
      return
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const current = hintDragSelectionRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }

      const position = getHintTilePositionFromPointerEvent(event)
      if (!position) {
        return
      }

      if (position.row !== current.end.row || position.column !== current.end.column) {
        updateHintDragSelection({ ...current, end: position })
      }
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const current = hintDragSelectionRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }

      const pointerPosition = getHintTilePositionFromPointerEvent(event)
      const end = pointerPosition ?? current.end
      const moved = end.row !== current.start.row || end.column !== current.start.column
      updateHintDragSelection(null)
      if (!moved) {
        return
      }

      suppressHintClickRef.current = true
      window.setTimeout(() => {
        suppressHintClickRef.current = false
      }, 0)
      if (!isHintToolActive) {
        return
      }

      const rectangle = getHintSelectionRectangle(
        { ...current, end },
        hintTiles,
        width,
        height,
      )
      if (!rectangle) {
        setError('The selected hint area must stay within the grid.')
        return
      }

      if (changeHintArea(rectangle.row, rectangle.column, rectangle.rowSpan, rectangle.columnSpan)) {
        const key = hintPositionKey(rectangle.row, rectangle.column)
        const tile = hintTiles[key]
        setActiveHint({
          row: rectangle.row,
          column: rectangle.column,
          direction: tile?.direction
            ?? (rectangle.row === 0 && rectangle.column > 0 ? 'down' : 'across'),
        })
      }
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      const current = hintDragSelectionRef.current
      if (current?.pointerId === event.pointerId) {
        updateHintDragSelection(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [hintDragSelection, hintTiles, height, isHintToolActive, width])

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
    const controller = new AbortController()

    async function loadPuzzles() {
      try {
        const response = await fetch('/api/puzzles', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Unable to load saved puzzles (${response.status})`)
        }

        const result: unknown = await response.json()
        if (!Array.isArray(result) || !result.every(isSavedPuzzle)) {
          throw new Error('The server returned an invalid puzzle list.')
        }

        setPuzzles((current) => [
          ...current,
          ...result.filter((puzzle) => !current.some((item) => item.id === puzzle.id)),
        ])
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }

        setError(requestError instanceof Error ? requestError.message : 'Unable to load saved puzzles.')
      }
    }

    void loadPuzzles()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        if (document.querySelector('.hint-editor')) {
          return
        }

        setActiveHint(null)
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
    setIsDirty(true)
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
        const key = hintPositionKey(nextRow, nextColumn)
        if (!hintTiles[key] && !coveredHintPositionKeys.has(key)) {
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
  }, [coveredHintPositionKeys, focusCell, height, hintTiles, isHintToolActive, tabDirection, width])

  const verticalTabOrder = tabDirection === 'down' && !isHintToolActive
    ? getGridTraversalOrder(width, height, hintTiles, 'down')
    : []
  const verticalTabFirstCellKey = verticalTabOrder.length > 0
    ? hintPositionKey(verticalTabOrder[0].row, verticalTabOrder[0].column)
    : null
  const printCellSize = Math.min(8, 176 / Math.max(width, height))
  const activeHintTile = activeHint
    ? hintTiles[hintPositionKey(activeHint.row, activeHint.column)]
    : undefined
  const activeHintRowOptions = activeHintTile
    ? getHintDimensionOptions(activeHintTile, hintTiles, width, height, 'rows')
    : undefined
  const activeHintColumnOptions = activeHintTile
    ? getHintDimensionOptions(activeHintTile, hintTiles, width, height, 'columns')
    : undefined

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
    const removesHints = Object.values(hintTiles).some((tile) => {
      return tile.row >= nextHeight
        || tile.column >= nextWidth
        || tile.row + tile.rowSpan > nextHeight
        || tile.column + tile.columnSpan > nextWidth
    })
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
          nextTiles[key] = {
            ...tile,
            rowSpan: Math.min(tile.rowSpan, nextHeight - tile.row),
            columnSpan: Math.min(tile.columnSpan, nextWidth - tile.column),
          }
        }
      }

      const coveredPositions = getCoveredHintPositionKeys(nextTiles)
      for (const [key, tile] of Object.entries(createDefaultHintTiles(nextWidth, nextHeight))) {
        const newlyAddedEdge = tile.row >= height || tile.column >= width
        if (newlyAddedEdge && !nextTiles[key] && !coveredPositions.has(key)) {
          nextTiles[key] = tile
        }
      }

      return nextTiles
    })

    setWidth(nextWidth)
    setHeight(nextHeight)
    setSavedPuzzle(null)
    setIsDirty(true)
    setError(null)
  }

  function startNewPuzzle() {
    setWidth(10)
    setHeight(10)
    setPendingWidth('10')
    setPendingHeight('10')
    setTitle('Untitled crossword')
    setCells(createBlankGrid(MAX_DIMENSION, MAX_DIMENSION))
    setHintTiles(createDefaultHintTiles(10, 10))
    setSelectedPuzzleId(null)
    setSavedPuzzle(null)
    setActiveHint(null)
    updateHintDragSelection(null)
    setIsHintToolActive(false)
    setIsDirty(false)
    setError(null)
  }

  async function handlePuzzleSelectionChange(puzzleId: string) {
    const nextPuzzleId = puzzleId || null
    if (nextPuzzleId === selectedPuzzleId) {
      return
    }

    if (
      isDirty
      && !window.confirm('Discard unsaved crossword changes and switch puzzles?')
    ) {
      return
    }

    if (nextPuzzleId === null) {
      startNewPuzzle()
      return
    }

    setIsLoadingPuzzle(true)
    setError(null)
    try {
      const response = await fetch(`/api/puzzles/${nextPuzzleId}`)
      if (!response.ok) {
        throw new Error(`Unable to load crossword (${response.status})`)
      }

      const result = await response.json() as PuzzleResponse
      const content = result.content
      if (
        result.id !== nextPuzzleId
        || !result.title
        || !content
        || !Number.isInteger(content.width)
        || content.width < 1
        || content.width > MAX_DIMENSION
        || !Number.isInteger(content.height)
        || content.height < 1
        || content.height > MAX_DIMENSION
        || !Array.isArray(content.cells)
        || content.cells.length !== content.height
        || (content.hints !== undefined && !Array.isArray(content.hints))
      ) {
        throw new Error('The server returned invalid crossword data.')
      }

      const loadedCells = createBlankGrid(MAX_DIMENSION, MAX_DIMENSION)
      for (let rowIndex = 0; rowIndex < content.height; rowIndex += 1) {
        const row = content.cells[rowIndex]
        if (typeof row !== 'string' || row.length !== content.width) {
          throw new Error('The server returned invalid crossword grid data.')
        }

        loadedCells[rowIndex] = `${row}${'.'.repeat(MAX_DIMENSION - content.width)}`
      }

      const loadedHintTiles: Record<string, HintTile> = {}
      const occupiedHintPositions = new Set<string>()
      for (const tile of content.hints ?? []) {
        const hasDimensionFields = tile.rowSpan !== undefined || tile.columnSpan !== undefined
        const legacySpan = tile.span ?? 1
        const rowSpan = tile.rowSpan
          ?? (!hasDimensionFields && tile.column === 0 ? legacySpan : 1)
        const columnSpan = tile.columnSpan
          ?? (!hasDimensionFields && tile.row === 0 && tile.column > 0 ? legacySpan : 1)
        if (
          !Number.isInteger(tile.row)
          || tile.row < 0
          || tile.row >= content.height
          || !Number.isInteger(tile.column)
          || tile.column < 0
          || tile.column >= content.width
          || (tile.direction !== 'across' && tile.direction !== 'down')
          || !Number.isInteger(rowSpan)
          || rowSpan < 1
          || tile.row + rowSpan > content.height
          || !Number.isInteger(columnSpan)
          || columnSpan < 1
          || tile.column + columnSpan > content.width
          || !Number.isInteger(legacySpan)
          || legacySpan < 1
          || (legacySpan > 1
            && !hasDimensionFields
            && tile.row !== 0
            && tile.column !== 0)
        ) {
          throw new Error('The server returned invalid crossword hint data.')
        }

        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
            const position = { row: tile.row + rowOffset, column: tile.column + columnOffset }
            const positionKey = hintPositionKey(position.row, position.column)
            if (
              content.cells[position.row][position.column] !== '.'
              || occupiedHintPositions.has(positionKey)
            ) {
              throw new Error('The server returned overlapping crossword hint data.')
            }

            occupiedHintPositions.add(positionKey)
          }
        }

        loadedHintTiles[hintPositionKey(tile.row, tile.column)] = {
          row: tile.row,
          column: tile.column,
          direction: tile.direction,
          imageId: tile.imageId,
          rowSpan,
          columnSpan,
        }
      }

      setWidth(content.width)
      setHeight(content.height)
      setPendingWidth(String(content.width))
      setPendingHeight(String(content.height))
      setTitle(result.title)
      setCells(loadedCells)
      setHintTiles(loadedHintTiles)
      setSelectedPuzzleId(result.id)
      setSavedPuzzle(null)
      setActiveHint(null)
      updateHintDragSelection(null)
      setIsHintToolActive(false)
      setIsDirty(false)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load crossword.')
    } finally {
      setIsLoadingPuzzle(false)
    }
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
      const response = await fetch(
        selectedPuzzleId ? `/api/puzzles/${selectedPuzzleId}` : '/api/puzzles',
        {
          method: selectedPuzzleId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: normalizedTitle,
            width,
            height,
            cells: cells.slice(0, height).map((row) => row.slice(0, width)),
            hints: Object.values(hintTiles),
          }),
        },
      )
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

      const savedResult = { id: result.id, title: result.title }
      setSavedPuzzle(savedResult)
      setSelectedPuzzleId(savedResult.id)
      setIsDirty(false)
      setPuzzles((current) => [
        savedResult,
        ...current.filter((puzzle) => puzzle.id !== savedResult.id),
      ])
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the crossword.')
      setSavedPuzzle(null)
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteSelectedPuzzle() {
    if (!selectedPuzzleId || isDeleting) {
      return
    }

    const selectedPuzzle = puzzles.find((puzzle) => puzzle.id === selectedPuzzleId)
    const puzzleTitle = selectedPuzzle?.title ?? title
    const unsavedChangesMessage = isDirty ? ' Any unsaved changes will also be lost.' : ''
    if (!window.confirm(
      `Delete "${puzzleTitle}"? This cannot be undone.${unsavedChangesMessage}`,
    )) {
      return
    }

    setIsDeleting(true)
    setError(null)
    try {
      const response = await fetch(`/api/puzzles/${selectedPuzzleId}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'The selected crossword no longer exists.'
            : `Delete failed (${response.status}).`,
        )
      }

      setPuzzles((current) => current.filter((puzzle) => puzzle.id !== selectedPuzzleId))
      startNewPuzzle()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the crossword.')
    } finally {
      setIsDeleting(false)
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

  function handleHintPointerDown(row: number, column: number, pointerId: number) {
    if (!isHintToolActive) {
      return
    }

    const position = { row, column }
    updateHintDragSelection({
      start: position,
      end: position,
      pointerId,
    })
  }

  function handleExistingHintClick(row: number, column: number, direction: ActiveHint['direction']) {
    if (suppressHintClickRef.current) {
      suppressHintClickRef.current = false
      return
    }

    setActiveHint({ row, column, direction })
  }

  function handleHintTileClick(row: number, column: number, value: string) {
    if (suppressHintClickRef.current) {
      suppressHintClickRef.current = false
      return
    }

    const key = hintPositionKey(row, column)
    const existingTile = hintTiles[key]
    if (existingTile) {
      handleExistingHintClick(row, column, existingTile.direction)
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
        rowSpan: 1,
        columnSpan: 1,
      },
    }))
    setSavedPuzzle(null)
    setIsDirty(true)
    setError(null)
    setActiveHint({ row, column, direction: 'across' })
  }

  function changeHintArea(row: number, column: number, rowSpan: number, columnSpan: number) {
    const key = hintPositionKey(row, column)
    const tile = hintTiles[key]
    const rectangle = { row, column, rowSpan, columnSpan }
    if (
      !Number.isInteger(rowSpan)
      || !Number.isInteger(columnSpan)
      || rowSpan < 1
      || columnSpan < 1
      || row + rowSpan > height
      || column + columnSpan > width
    ) {
      return false
    }

    const overlappingTiles = Object.values(hintTiles).filter((candidate) => (
      hintRectanglesOverlap(rectangle, getHintRectangle(candidate))
    ))
    if (overlappingTiles.some((candidate) => {
      const candidateRectangle = getHintRectangle(candidate)
      const isAnchor = candidate.row === row && candidate.column === column
      return !hintRectangleContains(rectangle, candidateRectangle)
        && !(isAnchor && hintRectangleContains(candidateRectangle, rectangle))
    })) {
      setError('The selected hint area cannot split another combined hint.')
      return false
    }

    if (
      tile
      && tile.rowSpan === rowSpan
      && tile.columnSpan === columnSpan
      && overlappingTiles.length === 1
    ) {
      return true
    }

    let erasedLetterCount = 0
    for (let selectedRow = row; selectedRow < row + rowSpan; selectedRow += 1) {
      for (let selectedColumn = column; selectedColumn < column + columnSpan; selectedColumn += 1) {
        if (cells[selectedRow][selectedColumn] !== '.') {
          erasedLetterCount += 1
        }
      }
    }

    const imageTiles = overlappingTiles.filter((candidate) => candidate.imageId)
    const retainedImageId = tile?.imageId ?? imageTiles[0]?.imageId ?? null
    const removedImageCount = imageTiles.length - (retainedImageId ? 1 : 0)
    const confirmationParts: string[] = []
    if (erasedLetterCount > 0) {
      confirmationParts.push(`${erasedLetterCount} letter${erasedLetterCount === 1 ? '' : 's'} will be erased`)
    }
    if (removedImageCount > 0) {
      confirmationParts.push(`saved images from ${removedImageCount} hint${removedImageCount === 1 ? '' : 's'} will be removed`)
    }
    if (
      confirmationParts.length > 0
      && !window.confirm(`This rectangular hint will replace the selected content: ${confirmationParts.join('; ')}. Continue?`)
    ) {
      return false
    }

    setHintTiles((current) => {
      const updated = { ...current }
      for (const existingTile of overlappingTiles) {
        delete updated[hintPositionKey(existingTile.row, existingTile.column)]
        for (let rowOffset = 0; rowOffset < existingTile.rowSpan; rowOffset += 1) {
          for (let columnOffset = 0; columnOffset < existingTile.columnSpan; columnOffset += 1) {
            const restoredRow = existingTile.row + rowOffset
            const restoredColumn = existingTile.column + columnOffset
            if (
              restoredRow >= row
              && restoredRow < row + rowSpan
              && restoredColumn >= column
              && restoredColumn < column + columnSpan
            ) {
              continue
            }

            updated[hintPositionKey(restoredRow, restoredColumn)] = {
              row: restoredRow,
              column: restoredColumn,
              direction: existingTile.direction,
              imageId: null,
              rowSpan: 1,
              columnSpan: 1,
            }
          }
        }
      }

      updated[key] = {
        row,
        column,
        direction: tile?.direction ?? (row === 0 && column > 0 ? 'down' : 'across'),
        imageId: retainedImageId,
        rowSpan,
        columnSpan,
      }
      return updated
    })
    setCells((current) => current.map((currentRow, rowIndex) => (
      rowIndex >= row && rowIndex < row + rowSpan
        ? `${currentRow.slice(0, column)}${'.'.repeat(columnSpan)}${currentRow.slice(column + columnSpan)}`
        : currentRow
    )))

    setSavedPuzzle(null)
    setIsDirty(true)
    setError(null)
    return true
  }

  function handleHintDimensionsChange(rowSpan: number, columnSpan: number) {
    if (activeHint) {
      changeHintArea(activeHint.row, activeHint.column, rowSpan, columnSpan)
    }
  }

  function handleHintSaved(imageId: string | null) {
    if (!activeHint) {
      return
    }

    const key = hintPositionKey(activeHint.row, activeHint.column)
    setHintTiles((current) => {
      const tile = current[key]
      return tile ? { ...current, [key]: { ...tile, imageId } } : current
    })
    setSavedPuzzle(null)
    setIsDirty(true)
    setError(null)
    setActiveHint(null)
  }

  function removeActiveHint() {
    if (!activeHint) {
      return
    }

    const key = hintPositionKey(activeHint.row, activeHint.column)
    const tile = hintTiles[key]
    if (!tile) {
      return
    }

    if (
      tile?.imageId
      && !window.confirm(
        tile.rowSpan > 1 || tile.columnSpan > 1
          ? 'This hint has a saved image. Remove it and restore all covered squares as letter boxes?'
          : 'This hint already has an image saved. Remove the hint from this grid?',
      )
    ) {
      return
    }

    setHintTiles((current) => {
      const updated = { ...current }
      for (let rowOffset = 0; rowOffset < tile.rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < tile.columnSpan; columnOffset += 1) {
          delete updated[hintPositionKey(tile.row + rowOffset, tile.column + columnOffset)]
        }
      }
      return updated
    })
    setCells((current) => current.map((row, rowIndex) => (
      rowIndex >= tile.row && rowIndex < tile.row + tile.rowSpan
        ? `${row.slice(0, tile.column)}${'.'.repeat(tile.columnSpan)}${row.slice(tile.column + tile.columnSpan)}`
        : row
    )))
    setSavedPuzzle(null)
    setIsDirty(true)
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
              <p className="eyebrow">{selectedPuzzleId ? 'Editing saved puzzle' : 'New puzzle'}</p>
              <h2 id="editor-title">{selectedPuzzleId ? 'Edit your grid' : 'Build your grid'}</h2>
            </div>
            <p className="editor-hint">
              Use the hint tool on any square to replace it with an across or down clue tile. Resizing warns before removing content.
            </p>
          </div>

          <div className="editor-controls">
            <label className="puzzle-picker" htmlFor="puzzle-picker">
              <span>Choose puzzle</span>
              <select
                id="puzzle-picker"
                value={selectedPuzzleId ?? ''}
                disabled={isLoadingPuzzle || isSaving || isDeleting}
                onChange={(event) => void handlePuzzleSelectionChange(event.currentTarget.value)}
              >
                <option value="">New crossword</option>
                {puzzles.map((puzzle) => (
                  <option key={puzzle.id} value={puzzle.id}>{puzzle.title}</option>
                ))}
              </select>
            </label>
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
                  setIsDirty(true)
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
              Move: {tabDirection === 'right' ? 'Right' : 'Down'} <kbd>U</kbd>
            </button>
            <span>The left column starts with Across hints; the top row starts with Down hints. Click a square with the hint tool to create one hint, or drag across any rectangular area to create a combined hint. Click an existing hint to edit it. Press Esc to return to letters. Use Alt+H/Alt+U in a grid square so H/U remain available as letters.</span>
          </div>

          <div className="grid-container" aria-busy={isLoadingPuzzle}>
            <div className="grid-viewport" aria-label="Crossword grid">
              <div
                className="letter-grid"
                style={{ gridTemplateColumns: `repeat(${width}, 34px)` }}
              >
                {cells.slice(0, height).flatMap((row, rowIndex) => (
                  Array.from(row.slice(0, width), (value, columnIndex) => {
                    const key = hintPositionKey(rowIndex, columnIndex)
                    if (coveredHintPositionKeys.has(key)) {
                      return null
                    }

                    const tile = hintTiles[key]
                    if (tile) {
                      return (
                        <HintTileCell
                          key={key}
                          row={rowIndex}
                          column={columnIndex}
                          tile={tile}
                          hintToolActive={isHintToolActive}
                          rangeSelected={selectedHintTileKeys.has(key)}
                          onPointerDown={handleHintPointerDown}
                          onClick={() => handleExistingHintClick(
                            rowIndex,
                            columnIndex,
                            tile.direction,
                          )}
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
                        rangeSelected={Boolean(
                          hintDragRectangle
                          && rowIndex >= hintDragRectangle.row
                          && rowIndex < hintDragRectangle.row + hintDragRectangle.rowSpan
                          && columnIndex >= hintDragRectangle.column
                          && columnIndex < hintDragRectangle.column + hintDragRectangle.columnSpan,
                        )}
                        onPointerDown={handleHintPointerDown}
                        onChange={handleCellChange}
                        onKeyDown={handleCellKeyDown}
                        onHintClick={handleHintTileClick}
                      />
                    )
                  })
                ))}
              </div>
            </div>
            {isLoadingPuzzle && (
              <div className="grid-loading-overlay" role="status" aria-live="polite">
                <span className="grid-loading-spinner" aria-hidden="true" />
                <span>Loading crossword…</span>
              </div>
            )}
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
            <div className="editor-actions">
              <button
                className="secondary-button print-button"
                type="button"
                onClick={() => window.print()}
              >
                Print crossword
              </button>
              <button
                className="secondary-button delete-button"
                type="button"
                disabled={!selectedPuzzleId || isLoadingPuzzle || isSaving || isDeleting}
                onClick={() => void deleteSelectedPuzzle()}
              >
                {isDeleting ? 'Deleting…' : 'Delete crossword'}
              </button>
              <button
                ref={saveCrosswordButtonRef}
                className="primary-button"
                type="button"
                disabled={isSaving || isLoadingPuzzle || isDeleting}
                onClick={() => void saveCrossword()}
              >
                {isSaving
                  ? 'Saving…'
                  : selectedPuzzleId
                    ? 'Save changes'
                    : 'Save crossword'}
              </button>
            </div>
          </div>
        </section>
      </div>
      <section className="print-preview" aria-hidden="true">
        <h1>{title.trim() || 'Untitled crossword'}</h1>
        <table
          className="print-grid"
          style={{ width: `${width * printCellSize}mm` }}
        >
          <tbody>
            {cells.slice(0, height).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from(row.slice(0, width), (value, columnIndex) => {
                  const key = hintPositionKey(rowIndex, columnIndex)
                  if (coveredHintPositionKeys.has(key)) {
                    return null
                  }

                  const tile = hintTiles[key]
                  const style = { height: `${printCellSize}mm` }

                  if (tile) {
                    return (
                      <td
                        className="print-cell print-cell--hint"
                        key={key}
                        rowSpan={tile.rowSpan > 1 ? tile.rowSpan : undefined}
                        colSpan={tile.columnSpan > 1 ? tile.columnSpan : undefined}
                        style={style}
                      >
                        {tile.imageId && <img src={`/api/hint-images/${tile.imageId}`} alt="" />}
                      </td>
                    )
                  }

                  return (
                    <td
                      className={`print-cell${value === '.' ? ' print-cell--empty' : ' print-cell--letter'}`}
                      key={key}
                      style={style}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {activeHint && (
        <HintEditor
          title={`Hint · Row ${activeHint.row + 1}, Column ${activeHint.column + 1}`}
          imageId={activeHintTile?.imageId ?? undefined}
          rowSpan={activeHintTile?.rowSpan}
          columnSpan={activeHintTile?.columnSpan}
          rowSpanOptions={activeHintRowOptions}
          columnSpanOptions={activeHintColumnOptions}
          onCancel={() => setActiveHint(null)}
          onDimensionsChange={handleHintDimensionsChange}
          onSave={uploadHintImage}
          onSaved={handleHintSaved}
          onRemove={removeActiveHint}
        />
      )}
    </main>
  )
}

export default App
