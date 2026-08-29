import { CheckCircle2, ChevronLeft, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { runtimeBlurb, runtimeHealthLabel } from '../copy'
import type { RuntimeWithHealth, WorkspaceSettings } from '../types'

type SettingsViewProps = {
  settings: WorkspaceSettings
  runtimes: RuntimeWithHealth[]
  isSaving: boolean
  testingRuntimeId: string | null
  onSave: (settings: Partial<WorkspaceSettings>) => void
  onTestRuntime: (id: string) => void
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
          <p>选择默认助手、本机工作文件夹，以及测试最多等多久。</p>
        </div>
        <button className="button" type="button" onClick={props.onClose}>
          <ChevronLeft size={15} />
          返回工作台
        </button>
      </header>
      <div className="settings-scroll">
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
            <label className="field">
              <span>本机工作文件夹</span>
              <input
                value={draft.workspaceRoot}
                onChange={(event) => setDraft({ ...draft, workspaceRoot: event.target.value })}
              />
              <small>
                流程读写电脑文件时会用这个文件夹。请填写完整路径，例如 /Users/you/work。
              </small>
            </label>
            <button className="button signal" type="submit" disabled={props.isSaving}>
              {props.isSaving ? (
                <RefreshCw className="spin" size={15} />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {props.isSaving ? '正在保存' : '保存设置'}
            </button>
          </form>
        </section>
        <section className="settings-section-main">
          <div className="settings-section-title">
            <h3>本机助手</h3>
            <p>看看每个助手有没有装好、能不能用。</p>
          </div>
          <div className="runtime-table">
            {props.runtimes.map((runtime) => (
              <article key={runtime.id}>
                <span className={`status-lamp is-${runtime.health?.status ?? 'checking'}`} />
                <div>
                  <strong>{runtime.name}</strong>
                  <p>{runtimeBlurb(runtime)}</p>
                  <small>配置版本 {runtime.profileVersion}</small>
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
