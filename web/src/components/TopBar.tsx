import {
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Settings2,
} from 'lucide-react'
import { FlowSwitcher } from './FlowSwitcher'
import { testStateLabel } from '../copy'
import type { FlowListRow } from '../flow-list'
import type { TestState } from '../workbench-ui'
import type { FlowDraft, FlowPlan } from '../types'

type TopBarProps = {
  drafts: FlowDraft[]
  plans: FlowPlan[]
  draft: FlowDraft | null
  testCount: number
  testCounts: Record<string, number>
  testState: TestState
  saveStatus: string | null
  isSaving: boolean
  saveFailed: boolean
  isRefreshing: boolean
  deletingKey: string | null
  leftCollapsed: boolean
  rightCollapsed: boolean
  onSelectFlow: (row: FlowListRow) => void
  onDeleteFlow: (row: FlowListRow) => void
  onNewFlow: () => void
  onRefresh: () => void
  onSettings: () => void
  onToggleLeft: () => void
  onToggleRight: () => void
}

/**
 * Flow management only: which flow am I in, what state is it in, and the few
 * workbench-wide utilities. Everything about editing lives below.
 */
export function TopBar(props: TopBarProps) {
  return (
    <header className="top-bar">
      <img className="brand-mark" src="/cflow-mark.svg" alt="CFlow" draggable={false} />
      <FlowSwitcher
        drafts={props.drafts}
        plans={props.plans}
        testCounts={props.testCounts}
        currentFlowId={props.draft?.flowId ?? null}
        deletingKey={props.deletingKey}
        onSelect={props.onSelectFlow}
        onDelete={props.onDeleteFlow}
        onNew={props.onNewFlow}
      />
      {props.draft && (
        <span className="top-bar-meta">
          <span className={`route-state is-${props.testState}`} />
          {testStateLabel(props.testState)}
          <span className="top-bar-dot">·</span>测试 {props.testCount} 次
          <span className="top-bar-dot">·</span>
          {props.draft.nodes.length} 个步骤
        </span>
      )}
      {props.saveStatus && (
        <span className={`save-state${props.saveFailed ? ' is-error' : ''}`}>
          {props.isSaving ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
          {props.saveStatus}
        </span>
      )}
      <span className="toolbar-spacer" />
      <span className="service-health" title="本地服务已连接">
        <span className="status-lamp is-completed" />
        本地服务
      </span>
      <button
        className="icon-button"
        type="button"
        title="刷新工作台"
        aria-label="刷新工作台"
        onClick={props.onRefresh}
      >
        <RefreshCw className={props.isRefreshing ? 'spin' : ''} size={15} />
      </button>
      <button
        className="icon-button"
        type="button"
        title="工作台设置"
        aria-label="工作台设置"
        onClick={props.onSettings}
      >
        <Settings2 size={15} />
      </button>
      <span className="toolbar-divider" />
      <button
        className="icon-button"
        type="button"
        title={props.leftCollapsed ? '展开详情' : '收起详情'}
        aria-label={props.leftCollapsed ? '展开详情' : '收起详情'}
        onClick={props.onToggleLeft}
      >
        {props.leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      <button
        className="icon-button"
        type="button"
        title={props.rightCollapsed ? '展开助手' : '收起助手'}
        aria-label={props.rightCollapsed ? '展开助手' : '收起助手'}
        onClick={props.onToggleRight}
      >
        {props.rightCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
      </button>
    </header>
  )
}
