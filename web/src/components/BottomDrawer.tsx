import { ListChecks, ScrollText, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useLocale } from '../locale-context'
import type { DrawerTab } from '../workbench-ui'

type BottomDrawerProps = {
  tab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
  onClose: () => void
  children: ReactNode
}

const tabIcons: Record<DrawerTab, ReactNode> = {
  log: <ScrollText size={14} />,
  check: <ListChecks size={14} />,
}

const MIN_HEIGHT = 180
const MAX_HEIGHT = 640

function maxDrawerHeight() {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, window.innerHeight - 140))
}

function clampHeight(value: number) {
  return Math.max(MIN_HEIGHT, Math.min(maxDrawerHeight(), value))
}

/**
 * Sits under the canvas as a real flex sibling, so opening it resizes the
 * canvas rather than covering the zoom controls or the minimap. Never opens on
 * its own — the toolbar is the only way in.
 */
export function BottomDrawer(props: BottomDrawerProps) {
  const { m } = useLocale()
  const tabs: { id: DrawerTab; label: string; icon: ReactNode }[] = [
    { id: 'log', label: m.drawer.log, icon: tabIcons.log },
    { id: 'check', label: m.drawer.check, icon: tabIcons.check },
  ]
  const drawerRef = useRef<HTMLElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const currentHeight = drawerRef.current?.getBoundingClientRect().height
    if (!currentHeight) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startY: event.clientY, startHeight: currentHeight }
    setIsResizing(true)
    setHeight(currentHeight)
  }

  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const { startY, startHeight } = dragRef.current
    setHeight(clampHeight(startHeight + startY - event.clientY))
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setIsResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const adjustWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentHeight = height ?? drawerRef.current?.getBoundingClientRect().height
    if (!currentHeight) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      setHeight(clampHeight(currentHeight + (event.key === 'ArrowUp' ? 24 : -24)))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setHeight(event.key === 'Home' ? MIN_HEIGHT : maxDrawerHeight())
    }
  }

  return (
    <section
      ref={drawerRef}
      className={`bottom-drawer${isResizing ? ' is-resizing' : ''}`}
      aria-label={m.drawer.aria}
      style={height ? { height: `${height}px` } : undefined}
    >
      <div
        className="drawer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={m.drawer.resize}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maxDrawerHeight()}
        aria-valuenow={height ?? undefined}
        tabIndex={0}
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={adjustWithKeyboard}
      >
        <span aria-hidden="true" />
      </div>
      <div className="drawer-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={props.tab === tab.id}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="icon-button drawer-close"
          onClick={props.onClose}
          title={m.drawer.collapse}
          aria-label={m.drawer.collapseLog}
        >
          <X size={15} />
        </button>
      </div>
      <div className="drawer-body">{props.children}</div>
    </section>
  )
}
