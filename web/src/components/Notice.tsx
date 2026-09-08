import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export type NoticeValue = {
  tone: 'info' | 'success' | 'error'
  title: string
  detail: string
}

type NoticeProps = {
  notice: NoticeValue | null
  onClose: () => void
}

export function Notice({ notice, onClose }: NoticeProps) {
  const noticeRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<number | null>(null)
  const remainingRef = useRef(0)
  const startedAtRef = useRef(0)
  const pauseSourcesRef = useRef(new Set<'hover' | 'focus'>())
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const clearTimer = () => {
    if (timeoutRef.current === null) return
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }
  const startTimer = () => {
    clearTimer()
    if (!notice || pauseSourcesRef.current.size > 0) return
    startedAtRef.current = performance.now()
    timeoutRef.current = window.setTimeout(() => closeRef.current(), remainingRef.current)
  }
  const pause = (source: 'hover' | 'focus') => {
    if (pauseSourcesRef.current.has(source)) return
    pauseSourcesRef.current.add(source)
    if (timeoutRef.current !== null) {
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (performance.now() - startedAtRef.current),
      )
      clearTimer()
    }
  }
  const resume = (source: 'hover' | 'focus') => {
    pauseSourcesRef.current.delete(source)
    if (pauseSourcesRef.current.size === 0) startTimer()
  }

  useEffect(() => {
    clearTimer()
    pauseSourcesRef.current.clear()
    remainingRef.current = notice?.tone === 'error' ? 8_000 : 4_000
    if (noticeRef.current?.matches(':hover')) pauseSourcesRef.current.add('hover')
    if (noticeRef.current?.contains(document.activeElement)) pauseSourcesRef.current.add('focus')
    if (notice) startTimer()
    return clearTimer
  }, [notice])

  return (
    <div className="notice-stack">
      {notice && (
        <div
          ref={noticeRef}
          className={`operation-notice ${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => pause('hover')}
          onMouseLeave={() => resume('hover')}
          onFocus={() => pause('focus')}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) resume('focus')
          }}
        >
          <span className="status-lamp" />
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.detail}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
