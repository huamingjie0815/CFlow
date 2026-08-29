import { Check, Clipboard, FileCheck2, Play, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { nodeKindLabel } from '../copy'
import type { CompilationPreview, FlowDraft, RuntimeWithHealth } from '../types'

type CompilerPreviewProps = {
  draft: FlowDraft
  preview: CompilationPreview | null
  error: string | null
  isPending: boolean
  runtimes: RuntimeWithHealth[]
  runtimeId: string
  onRuntimeChange: (id: string) => void
  onCompile: () => void
}

export function CompilerPreviewView(props: CompilerPreviewProps) {
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
    <section className="compiler-view" aria-label="执行前检查">
      <header className="compiler-header">
        <div>
          <span className="view-kicker">编译快照</span>
          <h2>检查 DSL</h2>
          <p>检查当前 FlowDraft 会生成可保存的编译快照，不会直接运行或发布。</p>
        </div>
        <div className="compiler-actions">
          <label className="compiler-runtime-select">
            <span>用哪个助手检查</span>
            <select value={runtimeId} onChange={(event) => onRuntimeChange(event.target.value)}>
              {runtimes.map((runtime) => (
                <option
                  key={runtime.id}
                  value={runtime.id}
                  disabled={!runtime.enabled || runtime.health?.status !== 'available'}
                >
                  {runtime.name} · {runtime.health?.status === 'available' ? '可用' : '不可用'}
                </option>
              ))}
            </select>
          </label>
          <div className="compiler-action-buttons">
            {preview && (
              <button className="button" type="button" onClick={copy}>
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
                {copied ? '已复制' : '复制检查结果'}
              </button>
            )}
              <button
                className="button signal"
                type="button"
                onClick={onCompile}
                disabled={isPending}
              >
              {isPending ? (
                <RefreshCw className="spin" size={15} />
              ) : preview ? (
                <RefreshCw size={15} />
              ) : (
                <Play size={15} />
              )}
              {isPending ? '正在检查' : preview ? '重新检查' : '检查并保存'}
              </button>
            </div>
          </div>
      </header>
      {error && (
        <div className="inline-alert error">
          <strong>检查未通过</strong>
          <span>{error}</span>
        </div>
      )}
      {!preview && !error ? (
        <div className="compiler-empty">
          <FileCheck2 size={28} />
          <h3>还没有检查结果</h3>
          <p>
            当前草稿有 {draft.nodes.length} 个步骤、{draft.edges.length}{' '}
            条连线。点右侧按钮检查并保存这份编译快照。
          </p>
        </div>
      ) : preview ? (
        <div className="compiler-scroll">
          <div className="compiler-summary">
            <div>
              <span>流程版本</span>
              <strong>v{preview.plan.flowVersion}</strong>
            </div>
            <div>
              <span>步骤</span>
              <strong>{preview.plan.nodes.length}</strong>
            </div>
            <div>
              <span>连线</span>
              <strong>{preview.plan.edges.length}</strong>
            </div>
            <div>
              <span>用到的能力</span>
              <strong>{preview.programs.length}</strong>
            </div>
          </div>
          <section className="compiler-steps">
            <h3>检查到的步骤</h3>
            <ol>
              {preview.plan.nodes.map((node) => (
                <li key={node.id}>
                  <span>{nodeKindLabel(node.kind)}</span>
                  <strong>
                    {node.kind === 'cf-call'
                      ? (preview.programs.find(
                          (program) =>
                            program.cfId === node.cfRef.cfId &&
                            program.version === node.cfRef.version,
                        )?.draft.name ?? node.cfRef.cfId)
                      : node.kind === 'approval'
                        ? '人工审批'
                        : node.kind === 'branch'
                          ? '条件分支'
                          : node.kind === 'join'
                            ? '汇合'
                            : '流程结果'}
                  </strong>
                </li>
              ))}
            </ol>
          </section>
          <details className="tech-disclosure">
            <summary>查看技术细节</summary>
            <section className="code-section">
              <header>
                <div>
                  <span className="status-lamp is-completed" />
                  <h3>流程方案</h3>
                </div>
                <code>{preview.plan.planHash}</code>
              </header>
              <pre>
                <code>{JSON.stringify(preview.plan, null, 2)}</code>
              </pre>
            </section>
            {preview.programs.map((version) => (
              <section className="code-section" key={`${version.cfId}@${version.version}`}>
                <header>
                  <div>
                    <span className="status-lamp is-completed" />
                    <h3>{version.draft.name}</h3>
                  </div>
                  <code>
                    {version.cfId}@{version.version} · {version.programHash}
                  </code>
                </header>
                <pre>
                  <code>{JSON.stringify(version.program, null, 2)}</code>
                </pre>
              </section>
            ))}
          </details>
        </div>
      ) : null}
    </section>
  )
}
