import { Check, Clipboard, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { nodeKindLabel } from '../copy'
import { describeNode } from '../flow-labels'
import { format } from '../i18n'
import { useLocale } from '../locale-context'
import type { CFDraft, CFVersion, CompilationPreview, FlowDraft, RuntimeWithHealth } from '../types'

type CheckPanelProps = {
  draft: FlowDraft
  preview: CompilationPreview | null
  error: string | null
  isPending: boolean
  runtimes: RuntimeWithHealth[]
  runtimeId: string
  cfs: CFVersion[]
  candidateCfs: CFDraft[]
  onRuntimeChange: (id: string) => void
  onCompile: () => void
  runInput: string
  onRunInputChange: (value: string) => void
}

/**
 * The 检查 tab of the bottom drawer: does this flow hold together, and in what
 * order will it run. Compact by design — the raw FlowPlan/CFProgram JSON lives
 * in a closed disclosure, because a drawer is no place to read JSON.
 */
export function CheckPanel(props: CheckPanelProps) {
  const { m, locale } = useLocale()
  const { draft, preview, error, isPending, runtimes, runtimeId, onRuntimeChange, onCompile } =
    props
  const [copied, setCopied] = useState(false)
  const output = preview ? JSON.stringify(preview, null, 2) : ''
  const copy = async () => {
    if (!output) return
    await navigator.clipboard.writeText(output)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="check-panel">
      <div className="check-bar">
        {draft.nodes.some(
          (node) => node.kind === 'cf-call' && !node.cfRef.cfId.startsWith('builtin:'),
        ) && (
          <label className="check-runtime">
            <span>{m.check.runtime}</span>
            <select value={runtimeId} onChange={(event) => onRuntimeChange(event.target.value)}>
              {runtimes.map((runtime) => (
                <option
                  key={runtime.id}
                  value={runtime.id}
                  disabled={!runtime.enabled || runtime.health?.status !== 'available'}
                >
                  {runtime.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="check-counts">
          {preview
            ? format(m.check.previewCounts, {
                nodes: preview.plan.nodes.length,
                edges: preview.plan.edges.length,
                version: preview.plan.flowVersion,
              })
            : format(m.check.draftCounts, {
                nodes: draft.nodes.length,
                edges: draft.edges.length,
              })}
        </span>
        <span className="toolbar-spacer" />
        {preview && (
          <button className="button" type="button" onClick={copy}>
            {copied ? <Check size={14} /> : <Clipboard size={14} />}
            {copied ? m.check.copied : m.check.copy}
          </button>
        )}
        <button className="button signal" type="button" onClick={onCompile} disabled={isPending}>
          <RefreshCw className={isPending ? 'spin' : undefined} size={14} />
          {isPending ? m.check.checking : preview ? m.check.recheck : m.check.start}
        </button>
      </div>

      {error && (
        <div className="inline-alert error" role="alert">
          <strong>{m.check.failed}</strong>
          <span>{error}</span>
        </div>
      )}

      {!!preview?.warnings.length && (
        <div className="inline-alert warning" role="status">
          <strong>{m.check.warning}</strong>
          <span>{preview.warnings.map((warning) => warning.message).join('；')}</span>
        </div>
      )}

      <div className="check-body">
        <details className="tech-disclosure run-input-editor">
          <summary>{m.check.runInput}</summary>
          <label className="field">
            <span>{m.check.runInputJson}</span>
            <textarea
              aria-label={m.check.runInputAria}
              rows={4}
              value={props.runInput}
              onChange={(event) => props.onRunInputChange(event.target.value)}
              spellCheck={false}
            />
          </label>
        </details>
        {preview ? (
          <>
            <ol className="check-steps">
              {preview.plan.nodes.map((node) => (
                <li key={node.id}>
                  <span className="check-step-kind">{nodeKindLabel(node.kind, locale)}</span>
                  <strong>{describeNode(node, props.cfs, props.candidateCfs, locale).label}</strong>
                </li>
              ))}
            </ol>
            <details className="tech-disclosure">
              <summary>{m.check.technical}</summary>
              <div className="code-section">
                <header>
                  <div>
                    <h3>{m.check.plan}</h3>
                  </div>
                  <code>{preview.plan.planHash}</code>
                </header>
                <pre>
                  <code>{JSON.stringify(preview.plan, null, 2)}</code>
                </pre>
              </div>
              {preview.programs.map((version) => (
                <div className="code-section" key={`${version.cfId}@${version.version}`}>
                  <header>
                    <div>
                      <h3>{version.draft.name}</h3>
                    </div>
                    <code>
                      {version.cfId}@{version.version}
                    </code>
                  </header>
                  <pre>
                    <code>{JSON.stringify(version.program, null, 2)}</code>
                  </pre>
                </div>
              ))}
            </details>
          </>
        ) : (
          <div className="empty-panel compact">
            {error ? m.check.fixThenRecheck : m.check.startHint}
          </div>
        )}
      </div>
    </div>
  )
}
