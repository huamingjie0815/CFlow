import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { nodeRunStateLabel, nodeRunStateTone } from '../run'
import {
  buildRunLog,
  compactJson,
  formatJson,
  type RunLogEntry,
  type RunLogGroup,
} from '../run-log'
import { runStatusLabel } from '../copy'
import type { CFDraft, CFVersion, FlowDraft, RunDetail, RunSummary } from '../types'

const RECENT_RUN_LIMIT = 4

type RunLogPanelProps = {
  draft: FlowDraft | null
  runDetail: RunDetail | null
  runs: RunSummary[]
  selectedRunId: string | null
  cfs: CFVersion[]
  candidateCfs: CFDraft[]
  onSelectRun: (id: string) => void
  onSelectNode: (id: string | null) => void
}

const runKind = (flowVersionId: unknown) =>
  String(flowVersionId).startsWith('test:') ? '测试运行' : '正式运行'

function EntryRow({ entry }: { entry: RunLogEntry }) {
  return (
    <article>
      <span className={`status-lamp is-${entry.tone}`} />
      <div>
        <strong>{entry.title}</strong>
        <p>{entry.detail}</p>
        <small>{entry.at}</small>
      </div>
    </article>
  )
}

function TechnicalDetails({ entries }: { entries: RunLogEntry[] }) {
  const withPayload = entries.filter((entry) => entry.technical)
  if (!withPayload.length) return null
  return (
    <details className="tech-disclosure">
      <summary>技术细节</summary>
      {withPayload.map((entry) => (
        <div className="code-section" key={`${entry.seq}-tech`}>
          <header>
            <div>
              <h3>{entry.title}</h3>
            </div>
            <code title={entry.type}>{entry.type}</code>
          </header>
          <pre>
            <code>{entry.technical}</code>
          </pre>
        </div>
      ))}
    </details>
  )
}

function StepGroup({
  group,
  onSelectNode,
}: {
  group: RunLogGroup
  onSelectNode: (id: string | null) => void
}) {
  const clickable = Boolean(group.nodeId) && !group.stale
  return (
    <section className="run-log-group">
      {clickable ? (
        <button
          type="button"
          className="run-log-head"
          onClick={() => onSelectNode(group.nodeId!)}
          title="在左侧详情里打开这一步"
        >
          <RunLogHead group={group} />
        </button>
      ) : (
        <div className="run-log-head is-static">
          <RunLogHead group={group} />
        </div>
      )}
      <div className="activity-list">
        {group.entries.map((entry) => (
          <EntryRow entry={entry} key={`${entry.seq}-${entry.type}`} />
        ))}
      </div>
      <TechnicalDetails entries={group.entries} />
    </section>
  )
}

function RunLogHead({ group }: { group: RunLogGroup }) {
  return (
    <>
      {group.order != null && (
        <span className="run-log-order">{String(group.order).padStart(2, '0')}</span>
      )}
      <span className="run-log-title">
        <strong>{group.title}</strong>
        <small>
          {[group.kindLabel, group.configNote, group.stale ? '流程已改动' : null]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      {group.state && (
        <span className="run-log-state">
          <span className={`status-lamp is-${nodeRunStateTone(group.state)}`} />
          {nodeRunStateLabel(group.state)}
        </span>
      )}
      <small className="run-log-time">{group.lastAt}</small>
    </>
  )
}

/**
 * The run log, grouped by step in the order the steps actually ran. Reads as
 * "what happened, step by step" rather than as a flat event stream.
 */
export function RunLogPanel(props: RunLogPanelProps) {
  const log = useMemo(
    () => buildRunLog(props.draft, props.runDetail, props.cfs, props.candidateCfs),
    [props.candidateCfs, props.cfs, props.draft, props.runDetail],
  )
  const flowRuns = useMemo(
    () =>
      props.draft
        ? props.runs
            .filter((run) => String(run.flow_version_id).includes(props.draft!.flowId))
            .slice(0, RECENT_RUN_LIMIT)
        : [],
    [props.draft, props.runs],
  )
  const runOutput = (props.runDetail?.run as { value?: unknown } | undefined)?.value

  return (
    <div className="run-log">
      <div className="run-log-main">
        {!log ? (
          <div className="empty-panel compact">
            还没有运行记录。测试或正式运行之后，这里会按步骤显示发生了什么。
          </div>
        ) : (
          <>
            <div className="run-log-summary">
              <span className={`status-lamp is-${props.runDetail!.run.status}`} />
              <div>
                <strong>{runStatusLabel(props.runDetail!.run.status)}</strong>
                <p>
                  {runKind(props.runDetail!.run.flow_version_id)} · 共 {log.nodes.length}{' '}
                  个步骤有记录
                </p>
              </div>
              {runOutput != null && (
                <details className="run-log-output">
                  <summary>
                    <ChevronRight aria-hidden="true" size={13} />
                    <span className="run-log-output-label">
                      <strong>运行结果</strong>
                      <code>{compactJson(runOutput, 320)}</code>
                    </span>
                  </summary>
                  <pre>
                    <code>{formatJson(runOutput)}</code>
                  </pre>
                </details>
              )}
            </div>
            {log.run.entries.length > 0 && (
              <section className="run-log-group is-run">
                <div className="run-log-head is-static">
                  <span className="run-log-title">
                    <strong>整条流程</strong>
                    <small>运行级记录</small>
                  </span>
                </div>
                <div className="activity-list">
                  {log.run.entries.map((entry) => (
                    <EntryRow entry={entry} key={`${entry.seq}-${entry.type}`} />
                  ))}
                </div>
                <TechnicalDetails entries={log.run.entries} />
              </section>
            )}
            {log.nodes.map((group) => (
              <StepGroup group={group} key={group.key} onSelectNode={props.onSelectNode} />
            ))}
            {!log.nodes.length && !log.run.entries.length && (
              <div className="empty-panel compact">这次运行还没有产生记录。</div>
            )}
          </>
        )}
      </div>
      <aside className="run-log-runs" aria-label="最近运行">
        <h3>最近运行</h3>
        {flowRuns.length ? (
          <div className="activity-list">
            {flowRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                className={`activity-list-item${props.selectedRunId === run.id ? ' is-selected' : ''}`}
                onClick={() => props.onSelectRun(run.id)}
              >
                <span className={`status-lamp is-${run.status}`} />
                <div>
                  <strong>{runStatusLabel(run.status)}</strong>
                  <p>{runKind(run.flow_version_id)}</p>
                  <small>{run.updated_at ?? run.created_at ?? ''}</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-panel compact">这条流程还没有运行记录。</div>
        )}
      </aside>
    </div>
  )
}
