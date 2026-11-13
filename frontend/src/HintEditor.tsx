import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 360

type HintDirection = 'across' | 'down'

interface HintEditorProps {
  title: string
  direction: HintDirection
  imageId?: string
  onCancel: () => void
  onEscape: () => void
  onDirectionChange: (direction: HintDirection) => void
  onSave: (image: Blob) => Promise<string>
  onSaved: (imageId: string) => void
  onRemove?: () => void
}

function drawImageOnCanvas(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('The drawing canvas is unavailable.')
  }

  context.fillStyle = '#fff'
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  const scale = Math.min(
    CANVAS_WIDTH / image.naturalWidth,
    CANVAS_HEIGHT / image.naturalHeight,
  )
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.drawImage(
    image,
    (CANVAS_WIDTH - width) / 2,
    (CANVAS_HEIGHT - height) / 2,
    width,
    height,
  )
}

function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
  const bounds = event.currentTarget.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) * (CANVAS_WIDTH / bounds.width),
    y: (event.clientY - bounds.top) * (CANVAS_HEIGHT / bounds.height),
  }
}

function HintEditor({
  title,
  direction,
  imageId,
  onCancel,
  onEscape,
  onDirectionChange,
  onSave,
  onSaved,
  onRemove,
}: HintEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const hasUnsavedChanges = useRef(false)
  const [tool, setTool] = useState<'draw' | 'text'>('draw')
  const [color, setColor] = useState('#263c2b')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingImage, setIsLoadingImage] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      setError('The drawing canvas is unavailable.')
      return
    }

    context.fillStyle = '#fff'
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    hasUnsavedChanges.current = false
    if (!imageId) {
      setIsLoadingImage(false)
      return
    }

    setIsLoadingImage(true)
    const image = new Image()
    image.onload = () => {
      try {
        drawImageOnCanvas(canvas, image)
        setError(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load the hint image.')
      } finally {
        setIsLoadingImage(false)
      }
    }
    image.onerror = () => {
      setError('Unable to load the saved hint image.')
      setIsLoadingImage(false)
    }
    image.src = `/api/hint-images/${imageId}`

    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [imageId])

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || isLoadingImage || isSaving) {
      return
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, or WebP image.')
      return
    }

    setIsLoadingImage(true)
    const imageUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = canvasRef.current
        if (!canvas) {
          throw new Error('The drawing canvas is unavailable.')
        }

        drawImageOnCanvas(canvas, image)
        hasUnsavedChanges.current = true
        setError(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load the selected image.')
      } finally {
        URL.revokeObjectURL(imageUrl)
        setIsLoadingImage(false)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl)
      setError('Unable to load the selected image.')
      setIsLoadingImage(false)
    }
    image.src = imageUrl
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (isLoadingImage || isSaving) {
      return
    }

    const canvas = event.currentTarget
    const context = canvas.getContext('2d')
    if (!context) {
      setError('The drawing canvas is unavailable.')
      return
    }

    const point = canvasPoint(event)
    if (tool === 'text') {
      if (!text.trim()) {
        setError('Enter text, then click the canvas to place it.')
        return
      }

      context.fillStyle = color
      context.font = '24px Segoe UI, sans-serif'
      context.textBaseline = 'top'
      context.fillText(text.trim(), point.x, point.y, CANVAS_WIDTH - point.x)
      hasUnsavedChanges.current = true
      setError(null)
      return
    }

    canvas.setPointerCapture(event.pointerId)
    isDrawing.current = true
    context.beginPath()
    context.moveTo(point.x, point.y)
    context.strokeStyle = color
    context.lineWidth = 5
    context.lineCap = 'round'
    context.lineJoin = 'round'
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || isLoadingImage || isSaving) {
      return
    }

    const context = event.currentTarget.getContext('2d')
    if (!context) {
      setError('The drawing canvas is unavailable.')
      isDrawing.current = false
      return
    }

    const point = canvasPoint(event)
    context.lineTo(point.x, point.y)
    context.stroke()
    hasUnsavedChanges.current = true
  }

  function stopDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    isDrawing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function clearCanvas() {
    if (isLoadingImage || isSaving) {
      return
    }

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      setError('The drawing canvas is unavailable.')
      return
    }

    context.fillStyle = '#fff'
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    hasUnsavedChanges.current = Boolean(imageId)
    setError(null)
  }

  const requestClose = useCallback(() => {
    if (isSaving || isLoadingImage) {
      return false
    }

    if (
      (hasUnsavedChanges.current || Boolean(text.trim()))
      && !window.confirm('You have unsaved hint changes. Close without saving?')
    ) {
      return false
    }

    onCancel()
    return true
  }, [isLoadingImage, isSaving, onCancel, text])

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (requestClose()) {
        onEscape()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onEscape, requestClose])

  function requestRemove() {
    if (
      (hasUnsavedChanges.current || Boolean(text.trim()))
      && !window.confirm('You have unsaved hint changes. Remove this hint tile and discard them?')
    ) {
      return
    }

    onRemove?.()
  }

  async function saveImage() {
    const canvas = canvasRef.current
    if (!canvas) {
      setError('The drawing canvas is unavailable.')
      return
    }

    setIsSaving(true)
    let imageId: string
    try {
      const image = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Unable to create the hint image.'))
          }
        }, 'image/png')
      })
      imageId = await onSave(image)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the hint image.')
      setIsSaving(false)
      return
    }

    setIsSaving(false)
    onSaved(imageId)
  }

  return (
    <div className="hint-editor-backdrop">
      <section
        className="hint-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hint-editor-title"
      >
        <div className="hint-editor-heading">
          <div>
            <p className="eyebrow">Image hint</p>
            <h2 id="hint-editor-title">{title}</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={isSaving || isLoadingImage}
            onClick={requestClose}
          >
            Close
          </button>
        </div>

        <div className="hint-editor-tools">
          <label className="hint-direction-field">
            <span>Answer direction</span>
            <select
              value={direction}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === 'across' || value === 'down') {
                  onDirectionChange(value)
                }
              }}
            >
              <option value="across">Across (to the right)</option>
              <option value="down">Down (below)</option>
            </select>
          </label>
          <button
            className={`secondary-button${tool === 'draw' ? ' secondary-button--selected' : ''}`}
            type="button"
            aria-pressed={tool === 'draw'}
            onClick={() => setTool('draw')}
          >
            Draw
          </button>
          <button
            className={`secondary-button${tool === 'text' ? ' secondary-button--selected' : ''}`}
            type="button"
            aria-pressed={tool === 'text'}
            onClick={() => setTool('text')}
          >
            Add text
          </button>
          <label className="hint-color-field">
            <span>Color</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.currentTarget.value)}
            />
          </label>
          <label className="secondary-button upload-button">
            Upload image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={isLoadingImage || isSaving}
              onChange={handleImageUpload}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={isLoadingImage || isSaving}
            onClick={clearCanvas}
          >
            Clear
          </button>
        </div>

        {tool === 'text' && (
          <label className="hint-text-field">
            <span>Text to place</span>
            <input
              type="text"
              maxLength={100}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              placeholder="Type text, then click the canvas"
            />
          </label>
        )}

        <canvas
          ref={canvasRef}
          className="hint-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          aria-label="Hint drawing canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
        />
        <p className="hint-canvas-help">
          Draw with the pointer, or select Add text and click to place text.
        </p>

        {error && <p className="feedback feedback--error" role="alert">{error}</p>}

        <div className="hint-editor-footer">
          {onRemove && (
            <button
              className="secondary-button"
              type="button"
              disabled={isSaving || isLoadingImage}
              onClick={requestRemove}
            >
              Remove hint tile
            </button>
          )}
          <div className="hint-editor-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isSaving || isLoadingImage}
              onClick={requestClose}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={isSaving || isLoadingImage}
              onClick={() => void saveImage()}
            >
              {isSaving ? 'Saving…' : isLoadingImage ? 'Loading image…' : 'Save hint image'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default HintEditor
