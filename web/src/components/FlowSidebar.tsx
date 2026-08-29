import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FlowDraft, FlowPlan } from '../types'

type FlowSidebarProps = {
  collapsed: boolean
  currentFlowId: string | null
  drafts: FlowDraft[]
  plans: FlowPlan[]
  isRefreshing: boolean
  onToggle: () => void
  onNew: () => void
  onSelectDraft: (draft: FlowDraft) => void
  onSelectPlan: (plan: FlowPlan) => void
  onDeleteDraft: (draft: FlowDraft) => void
  onRefresh: () => void
  onSettings: () => void
  deletingDraftId?: string | null
}

export function FlowSidebar(props: FlowSidebarProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const drafts = useMemo(
    () =>
      props.drafts.filter((draft) =>
        `${draft.name} ${draft.objective} ${draft.flowId}`.toLowerCase().includes(query),
      ),
    [props.drafts, query],
  )
  const plans = useMemo(
    () =>
      props.plans.filter((plan) =>
        `${plan.objective} ${plan.flowId}`.toLowerCase().includes(query),
      ),
    [props.plans, query],
  )

  if (props.collapsed) {
    return (
      <aside className="flow-sidebar is-collapsed" aria-label="已收起的流程列表">
        <div className="sidebar-brand compact">
          <span className="brand-mark">CF</span>
        </div>
        <div className="collapsed-actions">
          <button
            className="icon-button on-dark"
            type="button"
            title="展开流程列表"
            onClick={props.onToggle}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="icon-button on-dark"
            type="button"
            title="新建流程"
            onClick={props.onNew}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="collapsed-spacer" />
        <button
          className="icon-button on-dark"
          type="button"
          title="工作台设置"
          onClick={props.onSettings}
        >
          <Settings2 size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flow-sidebar" aria-label="流程列表">
      <header className="sidebar-brand">
        <span className="brand-mark">CF</span>
        <div>
          <strong>CF 工作台</strong>
          <span>用对话设计流程</span>
        </div>
        <button
          className="icon-button on-dark"
          type="button"
          title="收起流程列表"
          onClick={props.onToggle}
        >
          <ChevronLeft size={16} />
        </button>
      </header>
      <div className="sidebar-controls">
        <button className="new-flow-button" type="button" onClick={props.onNew}>
          <Plus size={16} />
          <span>新建流程</span>
        </button>
        <label className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索流程"
            aria-label="搜索流程"
          />
        </label>
      </div>
      <div className="sidebar-scroll" tabIndex={0} aria-label="流程列表">
        <div className="sidebar-group">
          <div className="sidebar-group-title">
            <span>草稿</span>
            <strong>{drafts.length}</strong>
          </div>
          {drafts.length ? (
            drafts.map((draft) => (
              <div
                key={draft.flowId}
                className={`flow-list-item has-action${props.currentFlowId === draft.flowId ? ' is-current' : ''}`}
              >
                <button
                  className="flow-list-main"
                  type="button"
                  onClick={() => props.onSelectDraft(draft)}
                >
                  <span className="route-lamp is-draft" />
                  <span>
                    <strong>{draft.name}</strong>
                    <small>
                      第 {draft.revision} 稿 · {draft.nodes.length} 个步骤
                    </small>
                  </span>
                </button>
                <button
                  className="flow-list-delete"
                  type="button"
                  title={`删除草稿：${draft.name}`}
                  aria-label={`删除草稿：${draft.name}`}
                  disabled={props.deletingDraftId === draft.flowId}
                  onClick={() => props.onDeleteDraft(draft)}
                >
                  {props.deletingDraftId === draft.flowId ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            ))
          ) : (
            <p className="sidebar-empty">没有符合条件的草稿。试试换个关键词，或新建一条。</p>
          )}
        </div>
        <div className="sidebar-group">
          <div className="sidebar-group-title">
            <span>已发布</span>
            <strong>{plans.length}</strong>
          </div>
          {plans.length ? (
            plans.map((plan) => (
              <button
                key={`${plan.flowId}@${plan.flowVersion}`}
                className={`flow-list-item${props.currentFlowId === plan.flowId ? ' is-current' : ''}`}
                type="button"
                onClick={() => props.onSelectPlan(plan)}
              >
                <span className="route-lamp is-published" />
                <span>
                  <strong>{plan.objective}</strong>
                  <small>
                    v{plan.flowVersion} · {plan.nodes.length} 个步骤
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">还没有已发布的版本。</p>
          )}
        </div>
      </div>
      <footer className="sidebar-footer">
        <div className="service-health">
          <span className="status-lamp is-completed" />
          <span>本地服务已连接</span>
        </div>
        <div>
          <button
            className="icon-button on-dark"
            type="button"
            title="刷新工作台"
            onClick={props.onRefresh}
          >
            <RefreshCw className={props.isRefreshing ? 'spin' : ''} size={16} />
          </button>
          <button
            className="icon-button on-dark"
            type="button"
            title="工作台设置"
            onClick={props.onSettings}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </footer>
    </aside>
  )
}
