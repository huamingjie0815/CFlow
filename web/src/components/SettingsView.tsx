import { AlertTriangle, CheckCircle2, ChevronLeft, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  runtimeBlurb,
  runtimeDiscoveryLabel,
  runtimeHealthErrorSummary,
  runtimeHealthLabel,
  runtimeLaunchDetail,
} from '../copy'
import type { RuntimeWithHealth, WorkspaceSettings } from '../types'

type SettingsViewProps = {
  workspaceRoot: string
  settings: WorkspaceSettings
  runtimes: RuntimeWithHealth[]
  isSaving: boolean
  isDiscovering: boolean
  discoveryWarnings: string[]
  testingRuntimeId: string | null
  onSave: (settings: Partial<WorkspaceSettings>) => void
  onTestRuntime: (id: string) => void
  onDiscoverRuntimes: () => void
  onClose: () => void
}

export function SettingsView(props: SettingsViewProps) {
  const [draft, setDraft] = useState(props.settings)
  useEffect(() => setDraft(props.settings), [props.settings])
  const available = props.runtimes.filter((runtime) => runtime.enabled)
  const timeoutSeconds = Math.max(1, Math.round(draft.testTimeoutMs / 1000) || 1)
  return (
    <section
      className="settings-view"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header className="settings-header">
        <div className="settings-emblem">
          <Settings2 size={19} />
        </div>
        <div>
          <h2 id="settings-title">工作台设置</h2>
          <p>查看当前工作区，并设置默认助手和测试最长等待时间。</p>
        </div>
        <button className="button" type="button" onClick={props.onClose}>
          <ChevronLeft size={15} />
          返回工作台
        </button>
      </header>
      <div className="settings-scroll">
        <section className="settings-section-main">
          <div className="settings-section-title">
            <h3>当前工作区</h3>
            <p>CFlow 只加载这个启动目录中的流程、设置、运行记录和附件。</p>
          </div>
          <label className="field workspace-field">
            <span>启动目录</span>
            <input className="workspace-path" value={props.workspaceRoot} readOnly />
          </label>
        </section>
        <section className="settings-section-main">
          <div className="settings-section-title">
            <h3>默认助手</h3>
            <p>生成和测试流程时都会用这里选的助手。如果它不可用，系统不会自动换成别的。</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              props.onSave(draft)
            }}
          >
            <div className="settings-grid">
              <label className="field">
                <span>默认助手</span>
                <select
                  value={draft.defaultRuntimeId}
                  onChange={(event) => setDraft({ ...draft, defaultRuntimeId: event.target.value })}
                >
                  {available.map((runtime) => (
                    <option
                      key={runtime.id}
                      value={runtime.id}
                      disabled={runtime.health?.status !== 'available'}
                    >
                      {runtime.name} · {runtimeHealthLabel(runtime)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>测试最多等待（秒）</span>
                <input
                  type="number"
                  min={1}
                  max={3600}
                  step={1}
                  value={timeoutSeconds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      testTimeoutMs: Math.max(1, Number(event.target.value) || 1) * 1000,
                    })
                  }
                />
              </label>
            </div>
            <div className="settings-form-actions">
              <button className="button signal" type="submit" disabled={props.isSaving}>
                {props.isSaving ? (
                  <RefreshCw className="spin" size={15} />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                {props.isSaving ? '正在保存' : '保存设置'}
              </button>
            </div>
          </form>
        </section>
        <section className="settings-section-main">
          <div className="settings-section-heading">
            <div className="settings-section-title">
              <h3>本机助手</h3>
              <p>这些是本机上已经装好、可以用来执行步骤的助手。新装了助手就点「重新识别」。</p>
            </div>
            <button
              className="button"
              type="button"
              onClick={props.onDiscoverRuntimes}
              disabled={props.isDiscovering}
            >
              <RefreshCw className={props.isDiscovering ? 'spin' : undefined} size={14} />
              {props.isDiscovering ? '正在识别' : '重新识别'}
            </button>
          </div>
          {props.discoveryWarnings.length > 0 && (
            <div className="runtime-discovery-warning" role="status">
              <AlertTriangle size={14} />
              <span>
                有 {props.discoveryWarnings.length} 个助手配置无法读取，已跳过：
                {props.discoveryWarnings[0]}
              </span>
            </div>
          )}
          <div className="runtime-table">
            {props.runtimes.map((runtime) => (
              <article key={runtime.id}>
                <span className={`status-lamp is-${runtime.health?.status ?? 'checking'}`} />
                <div className="runtime-info">
                  <strong>{runtime.name}</strong>
                  <p>{runtimeBlurb(runtime)}</p>
                  <small
                    title={`${runtimeDiscoveryLabel(runtime.discovery?.source)} · 配置版本 ${runtime.profileVersion}`}
                  >
                    {runtime.health?.authentication === 'unknown'
                      ? '登录状态会在真正使用时确认'
                      : '已确认可用'}
                  </small>
                  {runtime.health?.status === 'unavailable' && (
                    <>
                      <p className="runtime-error-summary" role="alert">
                        {runtimeHealthErrorSummary(runtime.health.error)}
                      </p>
                      <details className="runtime-technical-details">
                        <summary>技术详情</summary>
                        <dl>
                          <div>
                            <dt>启动方式</dt>
                            <dd>{runtimeLaunchDetail(runtime)}</dd>
                          </div>
                          <div>
                            <dt>原始错误</dt>
                            <dd>{runtime.health.error ?? '未返回错误信息'}</dd>
                          </div>
                        </dl>
                      </details>
                    </>
                  )}
                </div>
                <span className="runtime-health">{runtimeHealthLabel(runtime)}</span>
                <button
                  className="button"
                  type="button"
                  onClick={() => props.onTestRuntime(runtime.id)}
                  disabled={props.testingRuntimeId === runtime.id}
                >
                  {props.testingRuntimeId === runtime.id && (
                    <RefreshCw className="spin" size={14} />
                  )}
                  测试连接
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
