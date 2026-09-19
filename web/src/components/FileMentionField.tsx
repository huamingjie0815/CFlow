import { FileText } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { format } from '../i18n'
import { useLocale } from '../locale-context'

type FileMentionFieldProps = {
  value: string
  references: string[]
  active: boolean
  onChange: (value: string) => void
}

export function FileMentionField(props: FileMentionFieldProps) {
  const { m } = useLocale()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const suggestionsId = useId()
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const indexed = new Set(props.references)
  const staleMentions = [...props.value.matchAll(/@\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((path, index, paths) => !indexed.has(path) && paths.indexOf(path) === index)
  const suggestions = mention
    ? props.references
        .filter((path) => path.toLocaleLowerCase().includes(mention.query))
        .slice(0, 8)
    : []

  const updateMention = (value: string, cursor: number) => {
    if (!props.active || !props.references.length) {
      setMention(null)
      return
    }
    const prefix = value.slice(0, cursor)
    const start = prefix.lastIndexOf('@')
    if (start < 0 || /[\s{}]/.test(prefix.slice(start + 1))) {
      setMention(null)
      return
    }
    setActiveIndex(0)
    setMention({ start, end: cursor, query: prefix.slice(start + 1).toLocaleLowerCase() })
  }

  const selectSuggestion = (path: string) => {
    if (!mention) return
    const nextValue = `${props.value.slice(0, mention.start)}@{${path}}${props.value.slice(mention.end)}`
    const nextCursor = mention.start + path.length + 3
    props.onChange(nextValue)
    setMention(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return (
    <div className="field file-mention-field">
      <span>{m.files.does}</span>
      <textarea
        ref={textareaRef}
        aria-label={m.files.does}
        aria-autocomplete="list"
        aria-controls={mention && suggestions.length > 0 ? suggestionsId : undefined}
        aria-expanded={mention !== null && suggestions.length > 0}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value)
          updateMention(event.target.value, event.target.selectionStart)
        }}
        onClick={(event) =>
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyUp={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onKeyDown={(event) => {
          if (!mention || suggestions.length === 0) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const direction = event.key === 'ArrowDown' ? 1 : -1
            setActiveIndex(
              (current) => (current + direction + suggestions.length) % suggestions.length,
            )
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            selectSuggestion(suggestions[activeIndex] ?? suggestions[0])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setMention(null)
          }
        }}
        onBlur={() => setMention(null)}
      />
      {mention && suggestions.length > 0 && (
        <div
          id={suggestionsId}
          className="file-mention-suggestions"
          role="listbox"
          aria-label={m.files.mentionAria}
        >
          {suggestions.map((path, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              key={path}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(path)}
            >
              <FileText size={12} />
              <span>{path}</span>
            </button>
          ))}
        </div>
      )}
      {staleMentions.length > 0 && (
        <small className="effect-warning" role="status">
          {format(m.files.staleMentions, { count: staleMentions.length })}
        </small>
      )}
    </div>
  )
}
