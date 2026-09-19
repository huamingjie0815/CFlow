import { ChevronLeft, ChevronRight, Library, Plus, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useLocale } from '../locale-context'
import type { CFDraft, CFVersion } from '../types'

type CapabilityLibraryProps = {
  published: CFVersion[]
  candidates: CFDraft[]
  open: boolean
  onToggle: () => void
  onAddPublished: (version: CFVersion) => void
  onAddCandidate: (cf: CFDraft) => void
}

export function CapabilityLibrary(props: CapabilityLibraryProps) {
  const { m } = useLocale()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const published = useMemo(
    () =>
      props.published.filter((version) =>
        `${version.draft.name} ${version.draft.does}`.toLowerCase().includes(needle),
      ),
    [needle, props.published],
  )
  const candidates = useMemo(
    () => props.candidates.filter((cf) => `${cf.name} ${cf.does}`.toLowerCase().includes(needle)),
    [needle, props.candidates],
  )

  return (
    <aside
      className={`library-tray${props.open ? '' : ' is-collapsed'}`}
      aria-label={m.library.aria}
    >
      {props.open ? (
        <>
          <header className="library-header">
            <div>
              <strong>{m.library.title}</strong>
              <span>{m.library.hint}</span>
            </div>
            <button
              type="button"
              className="icon-button library-toggle"
              onClick={props.onToggle}
              aria-label={m.library.collapse}
              title={m.library.collapse}
            >
              <ChevronLeft size={16} />
            </button>
          </header>
          <label className="library-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={m.library.search}
              aria-label={m.library.search}
            />
          </label>
          <div className="library-scroll">
            <LibraryGroup title={m.library.published} count={published.length}>
              {published.length ? (
                published.map((version) => (
                  <LibraryCard
                    key={`${version.cfId}@${version.version}`}
                    badge={version.draft.execution?.kind === 'builtin' ? 'builtin' : 'available'}
                    name={version.draft.name}
                    summary={version.draft.does}
                    onAdd={() => props.onAddPublished(version)}
                  />
                ))
              ) : (
                <p className="library-empty">
                  {needle ? m.library.noPublishedMatch : m.library.noPublished}
                </p>
              )}
            </LibraryGroup>
            <LibraryGroup title={m.library.drafts} count={candidates.length}>
              {candidates.length ? (
                candidates.map((cf) => (
                  <LibraryCard
                    key={cf.cfId}
                    badge="draft"
                    name={cf.name}
                    summary={cf.does}
                    onAdd={() => props.onAddCandidate(cf)}
                  />
                ))
              ) : (
                <p className="library-empty">
                  {needle ? m.library.noDraftMatch : m.library.noDrafts}
                </p>
              )}
            </LibraryGroup>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="library-rail-button"
          onClick={props.onToggle}
          aria-label={m.library.expand}
          title={m.library.expand}
        >
          <Library size={16} />
          <span>{m.library.title}</span>
          <ChevronRight size={16} />
        </button>
      )}
    </aside>
  )
}

function LibraryGroup(props: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="library-group">
      <div className="library-group-header">
        <span>{props.title}</span>
        <strong>{props.count}</strong>
      </div>
      <div className="library-group-body">{props.children}</div>
    </section>
  )
}

function LibraryCard(props: {
  badge: 'builtin' | 'available' | 'draft'
  name: string
  summary: string
  onAdd: () => void
}) {
  const { m } = useLocale()
  const badgeLabel =
    props.badge === 'draft'
      ? m.library.draft
      : props.badge === 'builtin'
        ? m.library.builtin
        : m.library.available
  return (
    <article className="library-card">
      <div className="library-card-row">
        <button type="button" className="library-card-main" onClick={props.onAdd}>
          <span className={`capability-mark${props.badge === 'draft' ? ' candidate' : ''}`}>
            {badgeLabel}
          </span>
          <span>
            <strong>{props.name.trim() || m.library.emptyName}</strong>
            <small>{props.summary || m.library.emptySummary}</small>
          </span>
          <Plus size={14} />
        </button>
      </div>
    </article>
  )
}
