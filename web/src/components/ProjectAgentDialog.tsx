import { CheckCircle2, ChevronDown, FileInput, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { readableError } from '../api'
import {
  emptyProjectAgentForm,
  piProjectAgentExample,
  projectAgentFromForm,
  projectAgentToForm,
  type ProjectAgentFormValues,
} from '../project-agent-form'
import type { ProjectAgentConfig } from '../types'

type ProjectAgentDialogProps = {
  initial?: ProjectAgentConfig
  isSaving: boolean
  onSave: (config: ProjectAgentConfig) => Promise<void>
  onClose: () => void
}

export function ProjectAgentDialog(props: ProjectAgentDialogProps) {
  const editing = Boolean(props.initial)
  const [form, setForm] = useState<ProjectAgentFormValues>(() =>
    props.initial ? projectAgentToForm(props.initial) : emptyProjectAgentForm(),
  )
  const [error, setError] = useState<string | null>(null)
  const update = <K extends keyof ProjectAgentFormValues>(
    key: K,
    value: ProjectAgentFormValues[K],
  ) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <div
      className="project-agent-layer"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        props.onClose()
      }}
    >
      <section
        className="project-agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-agent-title"
        aria-describedby="project-agent-description"
      >
        <header>
          <div>
            <h3 id="project-agent-title">
              {props.initial?.preset
                ? '编辑默认助手配置'
                : editing
                  ? '编辑项目助手'
                  : '接入项目助手'}
            </h3>
            <p id="project-agent-description">
              {props.initial?.preset
                ? '修改只作用于当前项目，随时可以恢复默认配置。'
                : '配置只保存在当前项目。密钥请由启动 CFlow 的环境提供，这里只填写变量名。'}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={props.onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            try {
              await props.onSave(projectAgentFromForm(form))
              props.onClose()
            } catch (saveError) {
              setError(readableError(saveError))
            }
          }}
        >
          {!editing && (
            <div className="project-agent-example">
              <div>
                <strong>Pi Agent 示例</strong>
                <span>Pi 本身不直接支持 ACP，示例使用社区 pi-acp 适配器。</span>
              </div>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setForm(piProjectAgentExample())
                  setError(null)
                }}
              >
                <FileInput size={14} />
                套用示例
              </button>
            </div>
          )}
          <div className="project-agent-fields">
            <label className="field">
              <span>助手名称</span>
              <input
                autoFocus
                required
                maxLength={80}
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="例如：团队代码助手"
              />
            </label>
            <label className="field">
              <span>英文配置标识</span>
              <input
                required
                minLength={2}
                maxLength={64}
                pattern="[a-z0-9][a-z0-9._-]{1,63}"
                value={form.id}
                onChange={(event) => update('id', event.target.value)}
                placeholder="例如：team-coder"
                disabled={editing}
              />
              <small>{editing ? '创建后不可修改。' : '用于识别配置，创建后不可修改。'}</small>
            </label>
            <label className="field project-agent-wide-field">
              <span>说明（可选）</span>
              <input
                maxLength={400}
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="说明这个助手适合处理什么任务"
              />
            </label>
            <label className="field project-agent-wide-field">
              <span>连接命令</span>
              <input
                required
                value={form.command}
                onChange={(event) => update('command', event.target.value)}
                placeholder="例如：my-agent-acp"
              />
              <small>这个命令负责与助手通信，必须能由启动 CFlow 的用户直接运行。</small>
            </label>
            <label className="field project-agent-wide-field">
              <span>助手 CLI 命令{props.initial?.preset ? '' : '（可选）'}</span>
              <input
                required={Boolean(props.initial?.preset)}
                value={form.assistantCommand}
                onChange={(event) => update('assistantCommand', event.target.value)}
                placeholder="例如：claude、codex 或 pi"
              />
              <small>
                填写后，只有在当前用户环境中找到该 CLI 才会启用助手。也可以填写绝对路径。
              </small>
            </label>
            <label className="field project-agent-wide-field">
              <span>启动参数（每行一个）</span>
              <textarea
                value={form.args}
                onChange={(event) => update('args', event.target.value)}
                placeholder={'--mode\nacp'}
              />
            </label>
            {form.id === 'pi-agent' && (
              <p className="project-agent-example-note">
                使用前请先运行 npm install -g @mariozechner/pi-coding-agent 并在 Pi
                中完成登录；连接适配器会由 npx 启动。
              </p>
            )}
          </div>
          <details className="project-agent-advanced">
            <summary>
              <ChevronDown size={14} />
              高级设置
            </summary>
            <div className="project-agent-fields">
              <label className="field">
                <span>返回格式</span>
                <select
                  value={form.outputMode}
                  onChange={(event) =>
                    update('outputMode', event.target.value as ProjectAgentConfig['outputMode'])
                  }
                >
                  <option value="json">JSON</option>
                  <option value="text">文本</option>
                </select>
              </label>
              <label className="field">
                <span>超时时间（秒）</span>
                <input
                  type="number"
                  required
                  min={1}
                  max={3600}
                  step={1}
                  value={form.timeoutSeconds}
                  onChange={(event) => update('timeoutSeconds', event.target.value)}
                />
              </label>
              <label className="field">
                <span>最大输出（KB）</span>
                <input
                  type="number"
                  required
                  min={1}
                  max={16384}
                  step={1}
                  value={form.maxOutputKilobytes}
                  onChange={(event) => update('maxOutputKilobytes', event.target.value)}
                />
              </label>
              <label className="field">
                <span>CLI 路径变量（可选）</span>
                <input
                  value={form.assistantPathEnvironment}
                  onChange={(event) => update('assistantPathEnvironment', event.target.value)}
                  placeholder="例如：MY_AGENT_PATH"
                  pattern="[A-Za-z_][A-Za-z0-9_]*"
                />
                <small>连接命令通过这个环境变量接收已找到的 CLI 绝对路径。</small>
              </label>
              <label className="field">
                <span>允许传入的环境变量名称</span>
                <textarea
                  value={form.envAllowlist}
                  onChange={(event) => update('envAllowlist', event.target.value)}
                  placeholder={'API_KEY\nHTTP_PROXY'}
                />
                <small>每行一个变量名，不要填写变量值或密钥。</small>
              </label>
            </div>
          </details>
          {error && (
            <p className="project-agent-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button className="button" type="button" onClick={props.onClose}>
              取消
            </button>
            <button className="button signal" type="submit" disabled={props.isSaving}>
              {props.isSaving ? (
                <RefreshCw className="spin" size={15} />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {props.isSaving ? '正在保存并测试' : '保存并测试连接'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
