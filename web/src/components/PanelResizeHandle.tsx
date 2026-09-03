import { useRef, useState } from 'react'
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '../workbench-ui'

type PanelResizeHandleProps = {
  defaultWidth: number
  oppositeWidth: number
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
  onResizeStateChange: (resizing: boolean) => void
}

export function PanelResizeHandle(props: PanelResizeHandleProps) {
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const label = props.side === 'left' ? '调整详情栏宽度' : '调整 AI 助手栏宽度'

  const resizeTo = (requestedWidth: number, target: HTMLDivElement) => {
    const containerWidth = target.parentElement?.getBoundingClientRect().width ?? window.innerWidth
    props.onResize(clampPanelWidth(requestedWidth, containerWidth, props.oppositeWidth))
  }

  const setResizeState = (next: boolean) => {
    setResizing(next)
    props.onResizeStateChange(next)
  }

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: props.width }
    setResizeState(true)
  }

  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const movement = event.clientX - dragRef.current.startX
    const nextWidth = dragRef.current.startWidth + (props.side === 'left' ? movement : -movement)
    resizeTo(nextWidth, event.currentTarget)
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setResizeState(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null
    if (event.key === 'Home') nextWidth = PANEL_MIN_WIDTH
    if (event.key === 'End') nextWidth = PANEL_MAX_WIDTH
    if (event.key === 'ArrowLeft') nextWidth = props.width + (props.side === 'left' ? -24 : 24)
    if (event.key === 'ArrowRight') nextWidth = props.width + (props.side === 'left' ? 24 : -24)
    if (nextWidth == null) return
    event.preventDefault()
    resizeTo(nextWidth, event.currentTarget)
  }

  return (
    <div
      className={`panel-resize-handle is-${props.side}${resizing ? ' is-resizing' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuenow={Math.round(props.width)}
      tabIndex={0}
      title={`${label}，双击恢复默认宽度`}
      onDoubleClick={(event) => resizeTo(props.defaultWidth, event.currentTarget)}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={beginResize}
      onPointerMove={resize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
    >
      <span aria-hidden="true" />
    </div>
  )
}
