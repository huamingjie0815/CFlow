import {
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Settings2,
  Workflow,
} from 'lucide-react'
import { FlowSwitcher } from './FlowSwitcher'
import { testStateLabel } from '../copy'
import { format, type Locale } from '../i18n'
import { useLocale } from '../locale-context'
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
  onAddDemo: () => void
  isAddingDemo: boolean
  isDemoDisabled: boolean
  onRefresh: () => void
  onSettings: () => void
  onToggleLeft: () => void
  onToggleRight: () => void
  locale: Locale
  onLocaleChange: (locale: Locale) => void
}

/**
 * Flow management only: which flow am I in, what state is it in, and the few
 * workbench-wide utilities. Everything about editing lives below.
 */
export function TopBar(props: TopBarProps) {
  const { m, locale } = useLocale()
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
      <button
        className="button top-bar-demo-button"
        type="button"
        title={m.topBar.addDemoTitle}
        disabled={props.isDemoDisabled}
        onClick={props.onAddDemo}
      >
        {props.isAddingDemo ? <LoaderCircle className="spin" size={14} /> : <Workflow size={14} />}
        {props.isAddingDemo ? m.topBar.addingDemo : m.topBar.addDemo}
      </button>
      {props.draft && (
        <span className="top-bar-meta">
          <span className={`route-state is-${props.testState}`} />
          {testStateLabel(props.testState, locale)}
          <span className="top-bar-dot">·</span>
          {format(m.topBar.tests, { count: props.testCount })}
          <span className="top-bar-dot">·</span>
          {format(m.topBar.steps, { count: props.draft.nodes.length })}
        </span>
      )}
      {props.saveStatus && (
        <span className={`save-state${props.saveFailed ? ' is-error' : ''}`}>
          {props.isSaving ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
          {props.saveStatus}
        </span>
      )}
      <span className="toolbar-spacer" />
      <div className="locale-switch" role="group" aria-label={m.language.group}>
        <button
          type="button"
          aria-pressed={locale === 'zh-CN'}
          onClick={() => props.onLocaleChange('zh-CN')}
        >
          {m.language.zh}
        </button>
        <button
          type="button"
          aria-pressed={locale === 'en'}
          onClick={() => props.onLocaleChange('en')}
        >
          {m.language.en}
        </button>
      </div>
      <span className="service-health" title={m.topBar.localServiceTitle}>
        <span className="status-lamp is-completed" />
        {m.topBar.localService}
      </span>
      <button
        className="icon-button"
        type="button"
        title={m.topBar.refresh}
        aria-label={m.topBar.refresh}
        onClick={props.onRefresh}
      >
        <RefreshCw className={props.isRefreshing ? 'spin' : ''} size={15} />
      </button>
      <button
        className="icon-button"
        type="button"
        title={m.topBar.settings}
        aria-label={m.topBar.settings}
        onClick={props.onSettings}
      >
        <Settings2 size={15} />
      </button>
      <span className="toolbar-divider" />
      <button
        className="icon-button"
        type="button"
        title={props.leftCollapsed ? m.topBar.expandDetail : m.topBar.collapseDetail}
        aria-label={props.leftCollapsed ? m.topBar.expandDetail : m.topBar.collapseDetail}
        onClick={props.onToggleLeft}
      >
        {props.leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      <button
        className="icon-button"
        type="button"
        title={props.rightCollapsed ? m.topBar.expandAgent : m.topBar.collapseAgent}
        aria-label={props.rightCollapsed ? m.topBar.expandAgent : m.topBar.collapseAgent}
        onClick={props.onToggleRight}
      >
        {props.rightCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
      </button>
    </header>
  )
}
