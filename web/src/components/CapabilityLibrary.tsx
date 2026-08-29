import { ChevronLeft, ChevronRight, Library, Plus, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
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
    <aside className={`library-tray${props.open ? '' : ' is-collapsed'}`} aria-label="能力库">
      {props.open ? (
        <>
          <header className="library-header">
            <div>
              <strong>能力库</strong>
              <span>展开后可直接选用</span>
            </div>
            <button
              type="button"
              className="icon-button library-toggle"
              onClick={props.onToggle}
              aria-label="收起能力库"
              title="收起能力库"
            >
              <ChevronLeft size={16} />
            </button>
          </header>
          <label className="library-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索能力"
              aria-label="搜索能力"
            />
          </label>
          <div className="library-scroll">
            <LibraryGroup title="现成能力" count={published.length}>
              {published.length ? (
                published.map((version) => (
                  <LibraryCard
                    key={`${version.cfId}@${version.version}`}
                    badge="可用"
                    name={version.draft.name}
                    summary={version.draft.does}
                    onAdd={() => props.onAddPublished(version)}
                  />
                ))
              ) : (
                <p className="library-empty">
                  {needle
                    ? '没有符合条件的现成能力。'
                    : '还没有现成能力。先在「目标」里说说你想做什么，系统会给出候选步骤。'}
                </p>
              )}
            </LibraryGroup>
            <LibraryGroup title="这次生成的草稿" count={candidates.length}>
              {candidates.length ? (
                candidates.map((cf) => (
                  <LibraryCard
                    key={cf.cfId}
                    badge="草稿"
                    name={cf.name}
                    summary={cf.does}
                    onAdd={() => props.onAddCandidate(cf)}
                  />
                ))
              ) : (
                <p className="library-empty">
                  {needle ? '没有符合条件的草稿能力。' : '这次还没有生成新的能力草稿。'}
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
          aria-label="展开能力库"
          title="展开能力库"
        >
          <Library size={16} />
          <span>能力库</span>
          <ChevronRight size={16} />
        </button>
      )}
    </aside>
  )
}

function LibraryGroup(props: {
  title: string
  count: number
  children: ReactNode
}) {
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
  badge: string
  name: string
  summary: string
  onAdd: () => void
}) {
  return (
    <article className="library-card">
      <div className="library-card-row">
        <button type="button" className="library-card-main" onClick={props.onAdd}>
          <span className={`capability-mark${props.badge === '草稿' ? ' candidate' : ''}`}>
            {props.badge === '草稿' ? '草稿' : '能力'}
          </span>
          <span>
            <strong>{props.name.trim() || '空能力节点'}</strong>
            <small>{props.summary || '还没有说明'}</small>
          </span>
          <Plus size={14} />
        </button>
      </div>
    </article>
  )
}
