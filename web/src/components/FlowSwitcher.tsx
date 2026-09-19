import { ChevronDown, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildFlowList, currentFlowLabel, filterFlowList, type FlowListRow } from '../flow-list'
import { format } from '../i18n'
import { useLocale } from '../locale-context'
import type { FlowDraft, FlowPlan } from '../types'

type FlowSwitcherProps = {
  drafts: FlowDraft[]
  plans: FlowPlan[]
  testCounts: Record<string, number>
  currentFlowId: string | null
  deletingKey: string | null
  onSelect: (row: FlowListRow) => void
  onDelete: (row: FlowListRow) => void
  onNew: () => void
}

/**
 * The flow switcher replaces the old left sidebar. One flat list — every draft
 * plus every published version — because deleting a version targets an exact
 * flowVersion, so versions cannot be collapsed away.
 *
 * A plain button list with roving tabIndex rather than a listbox: a per-row
 * delete button nested inside an `option` would be invalid ARIA.
 */
export function FlowSwitcher(props: FlowSwitcherProps) {
  const { m, locale } = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  const allRows = useMemo(
    () => buildFlowList(props.drafts, props.plans, props.currentFlowId, props.testCounts, locale),
    [locale, props.currentFlowId, props.drafts, props.plans, props.testCounts],
  )
  const rows = useMemo(() => filterFlowList(allRows, query), [allRows, query])
  const current = currentFlowLabel(allRows, props.currentFlowId, locale)

  const close = (returnFocus = true) => {
    setOpen(false)
    setQuery('')
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])
  useEffect(() => setActiveIndex(0), [query])

  // pointerdown, not click, so a press on the trigger doesn't reopen instantly.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const move = (delta: number) => {
    if (!rows.length) return
    const next = Math.min(rows.length - 1, Math.max(0, activeIndex + delta))
    setActiveIndex(next)
    rowRefs.current[next]?.focus()
    rowRefs.current[next]?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flow-switcher" ref={containerRef}>
      <button
        className="flow-switcher-trigger"
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {current.statusTone !== 'none' && (
          <span className={`route-lamp is-${current.statusTone}`} />
        )}
        <span className="flow-switcher-name">{current.name}</span>
        {current.statusLabel && (
          <span className={`tag is-${current.statusTone}`}>{current.statusLabel}</span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="flow-switcher-menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            }
            if (event.key === 'Home') {
              event.preventDefault()
              move(-rows.length)
            }
            if (event.key === 'End') {
              event.preventDefault()
              move(rows.length)
            }
          }}
        >
          <label className="search-field">
            <Search size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={m.flowSwitcher.search}
              aria-label={m.flowSwitcher.search}
            />
          </label>
          <ul className="flow-switcher-list">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className={`flow-list-item has-action${row.flowId === props.currentFlowId ? ' is-current' : ''}`}
              >
                <button
                  className="flow-list-main"
                  type="button"
                  ref={(element) => {
                    rowRefs.current[index] = element
                  }}
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-current={row.flowId === props.currentFlowId || undefined}
                  onClick={() => {
                    props.onSelect(row)
                    close(false)
                  }}
                >
                  <span className={`route-lamp is-${row.statusTone}`} />
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.detail}</small>
                  </span>
                </button>
                <span className={`tag is-${row.statusTone}`}>{row.statusLabel}</span>
                <button
                  className="flow-list-delete"
                  type="button"
                  title={format(m.flowSwitcher.delete, { status: row.statusLabel, name: row.name })}
                  aria-label={format(m.flowSwitcher.delete, {
                    status: row.statusLabel,
                    name: row.name,
                  })}
                  disabled={props.deletingKey === row.key}
                  onClick={() => props.onDelete(row)}
                >
                  {props.deletingKey === row.key ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!rows.length && (
            <p className="flow-switcher-empty">
              {allRows.length ? m.flowSwitcher.emptyFiltered : m.flowSwitcher.empty}
            </p>
          )}
          <button
            className="flow-switcher-new"
            type="button"
            onClick={() => {
              close(false)
              props.onNew()
            }}
          >
            <Plus size={15} /> {m.flowSwitcher.newFlow}
          </button>
        </div>
      )}
    </div>
  )
}
