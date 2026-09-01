import { AtSign, Check, FileText, LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'

type FileReferencePickerProps = {
  active: boolean
  references: string[]
  onChange: (paths: string[]) => void
}

export function FileReferencePicker(props: FileReferencePickerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [staged, setStaged] = useState<string[]>([])
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const referenceKey = props.references.join('\n')

  const placePicker = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 456)),
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 376)),
    })
  }

  useEffect(() => {
    if (!props.references.length) {
      setMissing([])
      return
    }
    let current = true
    void api
      .searchWorkspaceFiles('', props.references)
      .then((result) => {
        if (current) setMissing(result.missing)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [referenceKey])

  useEffect(() => {
    if (!open) return
    placePicker()
    const requestId = ++requestRef.current
    const timer = window.setTimeout(() => {
      setPending(true)
      setError(false)
      void api
        .searchWorkspaceFiles(query, staged)
        .then((result) => {
          if (requestRef.current !== requestId) return
          setMatches(result.matches)
          setMissing(result.missing)
          setTruncated(result.truncated)
        })
        .catch(() => {
          if (requestRef.current === requestId) setError(true)
        })
        .finally(() => {
          if (requestRef.current === requestId) setPending(false)
        })
    }, 160)
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!pickerRef.current?.contains(target) && !buttonRef.current?.contains(target))
        setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', placePicker)
    window.addEventListener('scroll', placePicker, true)
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', placePicker)
      window.removeEventListener('scroll', placePicker, true)
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, query, staged])

  const toggle = (path: string) => {
    setStaged((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    )
  }

  return (
    <div className={`file-references${props.active ? '' : ' is-inactive'}`}>
      <div className="file-reference-heading">
        <div>
          <strong>引用文件</strong>
          <span>{props.active ? 'Agent 会优先从这些路径查找' : '已保留，启用文件权限后生效'}</span>
        </div>
        <button
          ref={buttonRef}
          className="button file-reference-trigger"
          type="button"
          disabled={!props.active}
          onClick={() => {
            setStaged(props.references)
            setQuery('')
            setOpen(true)
          }}
        >
          <AtSign size={13} /> 引用文件
        </button>
      </div>

      {props.references.length > 0 && (
        <ol className="file-reference-list">
          {props.references.map((path) => (
            <li className={missing.includes(path) ? 'is-missing' : undefined} key={path}>
              <span className="file-reference-order">{props.references.indexOf(path) + 1}</span>
              <FileText size={13} aria-hidden="true" />
              <span title={path}>{path}</span>
              <button
                className="icon-button"
                type="button"
                title={`移除 ${path}`}
                aria-label={`移除 ${path}`}
                onClick={() => props.onChange(props.references.filter((item) => item !== path))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {missing.length > 0 && (
        <small className="effect-warning" role="status">
          {missing.length} 个引用文件已不存在，检查时会保留警告。
        </small>
      )}

      {open &&
        createPortal(
          <div
            ref={pickerRef}
            className="file-picker-popover"
            role="dialog"
            aria-label="选择工作区文件"
            style={position}
          >
            <header>
              <div>
                <strong>引用工作区文件</strong>
                <span>只记录路径，不读取文件内容</span>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </header>
            <label className="file-picker-search">
              <Search size={14} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件名或路径"
                aria-label="搜索工作区文件"
              />
              {pending && <LoaderCircle className="spin" size={13} />}
            </label>
            <div className="file-picker-results">
              {matches.map((path) => (
                <label key={path}>
                  <input
                    type="checkbox"
                    checked={staged.includes(path)}
                    onChange={() => toggle(path)}
                  />
                  <FileText size={13} aria-hidden="true" />
                  <span title={path}>{path}</span>
                </label>
              ))}
              {!pending && !matches.length && <p>没有找到匹配的文件</p>}
              {error && <p className="is-error">暂时无法读取工作区文件，请重试。</p>}
            </div>
            <footer>
              <span>
                已选 {staged.length} 个{truncated ? ' · 继续输入以缩小范围' : ''}
              </span>
              <button className="button" type="button" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="button signal"
                type="button"
                onClick={() => {
                  props.onChange(staged)
                  setOpen(false)
                }}
              >
                <Check size={13} /> 确认
              </button>
            </footer>
          </div>,
          document.body,
        )}
    </div>
  )
}
