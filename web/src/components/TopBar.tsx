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

const GITHUB_REPO = 'https://github.com/huamingjie0815/CFlow'

function GithubMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

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
      <a
        className="icon-button"
        href={GITHUB_REPO}
        target="_blank"
        rel="noopener noreferrer"
        title={m.topBar.github}
        aria-label={m.topBar.github}
      >
        <GithubMark size={15} />
      </a>
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
