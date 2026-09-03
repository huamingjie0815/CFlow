import { Activity, Check, ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

const POPOVER_WIDTH = 320
const POPOVER_MAX_HEIGHT = 300
const POPOVER_GAP = 4
const VIEWPORT_MARGIN = 8

type PopoverPosition = {
  left: number
  maxHeight: number
  top: number
}

export function AgentTracePopover({ invocationId }: { invocationId?: string }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)
  const query = useQuery({
    queryKey: ['agent-invocation', invocationId],
    queryFn: () => api.getAgentInvocation(invocationId!),
    enabled: open && Boolean(invocationId),
    refetchInterval: (q) => {
      const status = q.state.data?.invocation.status
      return status && !['queued', 'running'].includes(status) ? false : 700
    },
  })
  useEffect(() => {
    if (!open || !invocationId || typeof EventSource === 'undefined') return
    const source = new EventSource(
      `/api/agent-invocations/${encodeURIComponent(invocationId)}/events`,
    )
    const refresh = () => void query.refetch()
    source.onmessage = refresh
    source.addEventListener('complete', refresh)
    return () => source.close()
  }, [invocationId, open, query.refetch])
  const detail = query.data
  const events = useMemo(() => {
    const values = detail?.events ?? []
    const positions = new Map<string, number>()
    return values.reduce<typeof values>((items, event) => {
      const technical =
        event.technical && typeof event.technical === 'object' && !Array.isArray(event.technical)
          ? event.technical
          : undefined
      const toolCallId =
        technical && 'toolCallId' in technical ? String(technical.toolCallId ?? '') : ''
      if (event.kind === 'tool' && toolCallId && positions.has(toolCallId)) {
        items[positions.get(toolCallId)!] = event
      } else {
        if (toolCallId) positions.set(toolCallId, items.length)
        items.push(event)
      }
      return items
    }, [])
  }, [detail?.events])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const updatePosition = () => {
      const trigger = triggerRef.current
      const popover = popoverRef.current
      if (!trigger || !popover) return
      const triggerRect = trigger.getBoundingClientRect()
      const availableBelow = window.innerHeight - triggerRect.bottom - POPOVER_GAP - VIEWPORT_MARGIN
      const availableAbove = triggerRect.top - POPOVER_GAP - VIEWPORT_MARGIN
      const naturalHeight = Math.min(popover.scrollHeight, POPOVER_MAX_HEIGHT)
      const placeAbove = availableBelow < naturalHeight && availableAbove > availableBelow
      const availableHeight = placeAbove ? availableAbove : availableBelow
      const maxHeight = Math.max(0, Math.min(POPOVER_MAX_HEIGHT, availableHeight))
      const renderedHeight = Math.min(naturalHeight, maxHeight)
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, triggerRect.right - POPOVER_WIDTH),
        window.innerWidth - VIEWPORT_MARGIN - POPOVER_WIDTH,
      )
      setPosition({
        left,
        maxHeight,
        top: placeAbove
          ? triggerRect.top - POPOVER_GAP - renderedHeight
          : triggerRect.bottom + POPOVER_GAP,
      })
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    if (popoverRef.current) observer.observe(popoverRef.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  if (!invocationId) return null

  const popover = open && (
    <span
      ref={popoverRef}
      className="agent-trace-popover"
      role="dialog"
      aria-label="Agent 处理过程"
      style={position ? position : { visibility: 'hidden' }}
    >
      <span className="agent-trace-heading">
        <strong>处理过程</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="收起处理过程">
          <ChevronDown size={14} />
        </button>
      </span>
      {!detail ? (
        <span className="agent-trace-loading">
          <LoaderCircle className="spin" size={13} /> 正在读取…
        </span>
      ) : (
        <span className="agent-trace-events">
          {events.length ? (
            events.map((event) => (
              <span className="agent-trace-event" key={`${event.invocationId}-${event.seq}`}>
                <span className={`agent-trace-dot is-${event.status ?? 'completed'}`}>
                  {event.kind === 'error' ? <CircleAlert size={11} /> : <Check size={10} />}
                </span>
                <span>
                  <strong>{event.title}</strong>
                  {event.detail && <small>{event.detail}</small>}
                  {event.technical !== undefined && (
                    <details className="agent-trace-technical">
                      <summary>技术细节</summary>
                      <pre>{JSON.stringify(event.technical, null, 2)}</pre>
                    </details>
                  )}
                </span>
              </span>
            ))
          ) : (
            <span className="agent-trace-empty">该 Agent 未提供更细的过程事件。</span>
          )}
        </span>
      )}
    </span>
  )

  return (
    <span className="agent-trace-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`icon-button agent-trace-trigger${open ? ' is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="查看处理过程"
        aria-label="查看处理过程"
        aria-expanded={open}
      >
        <Activity size={14} />
      </button>
      {popover && createPortal(popover, document.body)}
    </span>
  )
}
