import { Activity, Check, ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export function AgentTracePopover({ invocationId }: { invocationId?: string }) {
  const [open, setOpen] = useState(false)
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
  if (!invocationId) return null
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
  return (
    <span className="agent-trace-wrap">
      <button
        type="button"
        className={`icon-button agent-trace-trigger${open ? ' is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="查看处理过程"
        aria-label="查看处理过程"
        aria-expanded={open}
      >
        <Activity size={14} />
      </button>
      {open && (
        <span className="agent-trace-popover" role="dialog" aria-label="Agent 处理过程">
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
      )}
    </span>
  )
}
