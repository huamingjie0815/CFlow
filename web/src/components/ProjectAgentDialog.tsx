import { CheckCircle2, ChevronDown, FileInput, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { readableError } from '../api'
import { useLocale } from '../locale-context'
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
  const { m, locale } = useLocale()
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
                ? m.projectAgent.editPreset
                : editing
                  ? m.projectAgent.edit
                  : m.projectAgent.add}
            </h3>
            <p id="project-agent-description">
              {props.initial?.preset ? m.projectAgent.presetHint : m.projectAgent.addHint}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={props.onClose}
            aria-label={m.projectAgent.close}
          >
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
              setError(readableError(saveError, locale))
            }
          }}
        >
          {!editing && (
            <div className="project-agent-example">
              <div>
                <strong>{m.projectAgent.piTitle}</strong>
                <span>{m.projectAgent.piHint}</span>
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
                {m.projectAgent.applyExample}
              </button>
            </div>
          )}
          <div className="project-agent-fields">
            <label className="field">
              <span>{m.projectAgent.name}</span>
              <input
                autoFocus
                required
                maxLength={80}
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder={m.projectAgent.namePlaceholder}
              />
            </label>
            <label className="field">
              <span>{m.projectAgent.id}</span>
              <input
                required
                minLength={2}
                maxLength={64}
                pattern="[a-z0-9][a-z0-9._-]{1,63}"
                value={form.id}
                onChange={(event) => update('id', event.target.value)}
                placeholder={m.projectAgent.idPlaceholder}
                disabled={editing}
              />
              <small>{editing ? m.projectAgent.idLocked : m.projectAgent.idHint}</small>
            </label>
            <label className="field project-agent-wide-field">
              <span>{m.projectAgent.description}</span>
              <input
                maxLength={400}
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder={m.projectAgent.descriptionPlaceholder}
              />
            </label>
            <label className="field project-agent-wide-field">
              <span>{m.projectAgent.command}</span>
              <input
                required
                value={form.command}
                onChange={(event) => update('command', event.target.value)}
                placeholder={m.projectAgent.commandPlaceholder}
              />
              <small>{m.projectAgent.commandHint}</small>
            </label>
            <label className="field project-agent-wide-field">
              <span>
                {props.initial?.preset
                  ? m.projectAgent.assistantCommand
                  : m.projectAgent.assistantCommandOptional}
              </span>
              <input
                required={Boolean(props.initial?.preset)}
                value={form.assistantCommand}
                onChange={(event) => update('assistantCommand', event.target.value)}
                placeholder={m.projectAgent.assistantPlaceholder}
              />
              <small>{m.projectAgent.assistantHint}</small>
            </label>
            <label className="field project-agent-wide-field">
              <span>{m.projectAgent.args}</span>
              <textarea
                value={form.args}
                onChange={(event) => update('args', event.target.value)}
                placeholder={'--mode\nacp'}
              />
            </label>
            {form.id === 'pi-agent' && (
              <p className="project-agent-example-note">{m.projectAgent.piInstall}</p>
            )}
          </div>
          <details className="project-agent-advanced">
            <summary>
              <ChevronDown size={14} />
              {m.projectAgent.advanced}
            </summary>
            <div className="project-agent-fields">
              <label className="field">
                <span>{m.projectAgent.outputMode}</span>
                <select
                  value={form.outputMode}
                  onChange={(event) =>
                    update('outputMode', event.target.value as ProjectAgentConfig['outputMode'])
                  }
                >
                  <option value="json">{m.projectAgent.outputJson}</option>
                  <option value="text">{m.projectAgent.outputText}</option>
                </select>
              </label>
              <label className="field">
                <span>{m.projectAgent.timeout}</span>
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
                <span>{m.projectAgent.outputLimit}</span>
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
                <span>{m.projectAgent.pathEnv}</span>
                <input
                  value={form.assistantPathEnvironment}
                  onChange={(event) => update('assistantPathEnvironment', event.target.value)}
                  placeholder={m.projectAgent.pathEnvPlaceholder}
                  pattern="[A-Za-z_][A-Za-z0-9_]*"
                />
                <small>{m.projectAgent.pathEnvHint}</small>
              </label>
              <label className="field">
                <span>{m.projectAgent.envAllow}</span>
                <textarea
                  value={form.envAllowlist}
                  onChange={(event) => update('envAllowlist', event.target.value)}
                  placeholder={'API_KEY\nHTTP_PROXY'}
                />
                <small>{m.projectAgent.envAllowHint}</small>
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
              {m.projectAgent.cancel}
            </button>
            <button className="button signal" type="submit" disabled={props.isSaving}>
              {props.isSaving ? (
                <RefreshCw className="spin" size={15} />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {props.isSaving ? m.projectAgent.saving : m.projectAgent.save}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
