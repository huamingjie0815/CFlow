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
import { format } from '../i18n'
import { useLocale } from '../locale-context'
import type { CFDraft, CFVersion, FlowDraft, RunDetail, RunSummary } from '../types'
import { AgentTracePopover } from './AgentTracePopover'
import { FileExtractionResult } from './FileExtractionResult'

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

const runKind = (flowVersionId: unknown, testLabel: string, liveLabel: string) =>
  String(flowVersionId).startsWith('test:') ? testLabel : liveLabel

function EntryRow({ entry }: { entry: RunLogEntry }) {
  return (
    <article>
      <span className={`status-lamp is-${entry.tone}`} />
      <div>
        <strong>{entry.title}</strong>
        <p>{entry.detail}</p>
        <small>{entry.at}</small>
        {entry.extraction && <FileExtractionResult result={entry.extraction} />}
      </div>
    </article>
  )
}

function TechnicalDetails({ entries }: { entries: RunLogEntry[] }) {
  const { m } = useLocale()
  const withPayload = entries.filter((entry) => entry.technical)
  if (!withPayload.length) return null
  return (
    <details className="tech-disclosure">
      <summary>{m.log.technical}</summary>
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
  invocationId,
}: {
  group: RunLogGroup
  onSelectNode: (id: string | null) => void
  invocationId?: string
}) {
  const { m } = useLocale()
  const clickable = Boolean(group.nodeId) && !group.stale
  return (
    <section className="run-log-group">
      <div className="run-log-head is-static">
        {clickable ? (
          <button
            type="button"
            className="run-log-select"
            onClick={() => onSelectNode(group.nodeId!)}
            title={m.log.openStep}
          >
            <RunLogHead group={group} />
          </button>
        ) : (
          <span className="run-log-select is-static">
            <RunLogHead group={group} />
          </span>
        )}
        {invocationId && <AgentTracePopover invocationId={invocationId} />}
      </div>
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
  const { m, locale } = useLocale()
  return (
    <>
      {group.order != null && (
        <span className="run-log-order">{String(group.order).padStart(2, '0')}</span>
      )}
      <span className="run-log-title">
        <strong>{group.title}</strong>
        <small>
          {[group.kindLabel, group.configNote, group.stale ? m.log.stale : null]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      {group.state && (
        <span className="run-log-state">
          <span className={`status-lamp is-${nodeRunStateTone(group.state)}`} />
          {nodeRunStateLabel(group.state, locale)}
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
  const { m, locale } = useLocale()
  const log = useMemo(
    () => buildRunLog(props.draft, props.runDetail, props.cfs, props.candidateCfs, locale),
    [locale, props.candidateCfs, props.cfs, props.draft, props.runDetail],
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
          <div className="empty-panel compact">{m.log.empty}</div>
        ) : (
          <>
            <div className="run-log-summary">
              <span className={`status-lamp is-${props.runDetail!.run.status}`} />
              <div>
                <strong>{runStatusLabel(props.runDetail!.run.status, locale)}</strong>
                <p>
                  {format(m.log.summary, {
                    kind: runKind(
                      props.runDetail!.run.flow_version_id,
                      m.log.testRun,
                      m.log.liveRun,
                    ),
                    count: log.nodes.length,
                  })}
                </p>
              </div>
              {runOutput != null && (
                <details className="run-log-output">
                  <summary>
                    <ChevronRight aria-hidden="true" size={13} />
                    <span className="run-log-output-label">
                      <strong>{m.log.result}</strong>
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
                    <strong>{m.log.wholeFlow}</strong>
                    <small>{m.log.runLevel}</small>
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
              <StepGroup
                group={group}
                key={group.key}
                onSelectNode={props.onSelectNode}
                invocationId={
                  props.runDetail?.invocations?.find((item) => item.node === group.nodeIndex)?.id
                }
              />
            ))}
            {!log.nodes.length && !log.run.entries.length && (
              <div className="empty-panel compact">{m.log.noEvents}</div>
            )}
          </>
        )}
      </div>
      <aside className="run-log-runs" aria-label={m.log.recentAria}>
        <h3>{m.log.recent}</h3>
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
                  <strong>{runStatusLabel(run.status, locale)}</strong>
                  <p>{runKind(run.flow_version_id, m.log.testRun, m.log.liveRun)}</p>
                  <small>{run.updated_at ?? run.created_at ?? ''}</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-panel compact">{m.log.noRuns}</div>
        )}
      </aside>
    </div>
  )
}
