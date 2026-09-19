import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  runtimeBlurb,
  runtimeDiscoveryLabel,
  runtimeHealthErrorSummary,
  runtimeHealthLabel,
  runtimeLaunchDetail,
} from '../copy'
import { format, type Locale } from '../i18n'
import { useLocale } from '../locale-context'
import type { ProjectAgentConfig, RuntimeWithHealth, WorkspaceSettings } from '../types'
import { ProjectAgentDialog } from './ProjectAgentDialog'

type SettingsViewProps = {
  workspaceRoot: string
  settings: WorkspaceSettings
  runtimes: RuntimeWithHealth[]
  isSaving: boolean
  isDiscovering: boolean
  discoveryWarnings: string[]
  testingRuntimeId: string | null
  projectAgents: ProjectAgentConfig[]
  isSavingProjectAgent: boolean
  deletingProjectAgentId: string | null
  onSave: (settings: Partial<WorkspaceSettings>) => void
  onTestRuntime: (id: string) => void
  onDiscoverRuntimes: () => void
  onSaveProjectAgent: (config: ProjectAgentConfig, editing: boolean) => Promise<void>
  onDeleteProjectAgent: (id: string) => Promise<void>
  onClose: () => void
  onLocaleChange?: (locale: Locale) => void
}

export function SettingsView(props: SettingsViewProps) {
  const { m, locale } = useLocale()
  const [draft, setDraft] = useState(props.settings)
  const [projectAgentDialog, setProjectAgentDialog] = useState<ProjectAgentConfig | 'new' | null>(
    null,
  )
  useEffect(() => setDraft(props.settings), [props.settings])
  const available = props.runtimes.filter((runtime) => runtime.enabled)
  const projectAgentById = new Map(props.projectAgents.map((agent) => [agent.id, agent]))
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
          <h2 id="settings-title">{m.settings.title}</h2>
          <p>{m.settings.subtitle}</p>
        </div>
        <button className="button" type="button" onClick={props.onClose}>
          <ChevronLeft size={15} />
          {m.settings.back}
        </button>
      </header>
      <div className="settings-scroll">
        <section className="settings-section-main">
          <div className="settings-section-title">
            <h3>{m.settings.workspace}</h3>
            <p>{m.settings.workspaceHint}</p>
          </div>
          <label className="field workspace-field">
            <span>{m.settings.root}</span>
            <input className="workspace-path" value={props.workspaceRoot} readOnly />
          </label>
          <label className="field">
            <span>{m.language.field}</span>
            <select
              value={locale}
              onChange={(event) => props.onLocaleChange?.(event.target.value as Locale)}
            >
              <option value="zh-CN">{m.language.chinese}</option>
              <option value="en">{m.language.english}</option>
            </select>
          </label>
        </section>
        <section className="settings-section-main">
          <div className="settings-section-title">
            <h3>{m.settings.defaultAssistant}</h3>
            <p>{m.settings.defaultAssistantHint}</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              props.onSave(draft)
            }}
          >
            <div className="settings-grid">
              <label className="field">
                <span>{m.settings.defaultAssistant}</span>
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
                      {runtime.name} · {runtimeHealthLabel(runtime, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{m.settings.timeout}</span>
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
                {props.isSaving ? m.settings.saving : m.settings.save}
              </button>
            </div>
          </form>
        </section>
        <section className="settings-section-main">
          <div className="settings-section-heading">
            <div className="settings-section-title">
              <h3>{m.settings.localAssistants}</h3>
              <p>{m.settings.localAssistantsHint}</p>
            </div>
            <div className="settings-section-actions">
              <button className="button" type="button" onClick={() => setProjectAgentDialog('new')}>
                <Plus size={14} />
                {m.settings.addProject}
              </button>
              <button
                className="button"
                type="button"
                onClick={props.onDiscoverRuntimes}
                disabled={props.isDiscovering}
              >
                <RefreshCw className={props.isDiscovering ? 'spin' : undefined} size={14} />
                {props.isDiscovering ? m.settings.discovering : m.settings.rediscover}
              </button>
            </div>
          </div>
          {props.discoveryWarnings.length > 0 && (
            <div className="runtime-discovery-warning" role="status">
              <AlertTriangle size={14} />
              <span>
                {format(m.settings.discoveryWarning, {
                  count: props.discoveryWarnings.length,
                  first: props.discoveryWarnings[0],
                })}
              </span>
            </div>
          )}
          <div className="runtime-table">
            {props.runtimes.map((runtime) => {
              const projectAgent = projectAgentById.get(runtime.id)
              const isDefault = props.settings.defaultRuntimeId === runtime.id
              return (
                <article key={runtime.id}>
                  <span className={`status-lamp is-${runtime.health?.status ?? 'checking'}`} />
                  <div className="runtime-info">
                    <strong>{runtime.name}</strong>
                    <p>{runtimeBlurb(runtime, locale)}</p>
                    <small
                      title={`${runtimeDiscoveryLabel(runtime.discovery?.source, locale)} · ${format(m.settings.profileVersion, { version: runtime.profileVersion })}`}
                    >
                      {projectAgent?.preset
                        ? projectAgent.overridden
                          ? m.settings.overridden
                          : m.settings.preset
                        : projectAgent
                          ? m.settings.projectConfig
                          : ''}
                      {runtime.health?.authentication === 'required'
                        ? m.settings.authRequired
                        : runtime.health?.authentication === 'unknown'
                          ? m.settings.authUnknown
                          : m.settings.authOk}
                    </small>
                    {runtime.health?.status === 'unavailable' && (
                      <>
                        <p className="runtime-error-summary" role="alert">
                          {runtimeHealthErrorSummary(runtime.health.error, locale)}
                        </p>
                        <details className="runtime-technical-details">
                          <summary>{m.settings.technical}</summary>
                          <dl>
                            <div>
                              <dt>{m.settings.launch}</dt>
                              <dd>{runtimeLaunchDetail(runtime, locale)}</dd>
                            </div>
                            <div>
                              <dt>{m.settings.rawError}</dt>
                              <dd>{runtime.health.error ?? m.settings.noError}</dd>
                            </div>
                          </dl>
                        </details>
                      </>
                    )}
                  </div>
                  <span className="runtime-health">{runtimeHealthLabel(runtime, locale)}</span>
                  <div className="runtime-actions">
                    {projectAgent && (
                      <>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => setProjectAgentDialog(projectAgent)}
                          aria-label={format(m.settings.edit, { name: runtime.name })}
                          title={
                            projectAgent.preset ? m.settings.editPreset : m.settings.editProject
                          }
                        >
                          <Pencil size={14} />
                        </button>
                        {(!projectAgent.preset || projectAgent.overridden) && (
                          <button
                            className={`icon-button${projectAgent.preset ? '' : ' danger'}`}
                            type="button"
                            onClick={async () => {
                              const action = projectAgent.preset
                                ? m.settings.restorePreset
                                : m.settings.deleteProject
                              if (
                                !window.confirm(
                                  format(m.settings.confirmAction, {
                                    action,
                                    name: runtime.name,
                                  }),
                                )
                              )
                                return
                              await props.onDeleteProjectAgent(runtime.id).catch(() => undefined)
                            }}
                            disabled={
                              (!projectAgent.preset && isDefault) ||
                              props.deletingProjectAgentId === runtime.id
                            }
                            aria-label={
                              projectAgent.preset
                                ? format(m.settings.restoreAria, { name: runtime.name })
                                : format(m.settings.deleteAria, { name: runtime.name })
                            }
                            title={
                              !projectAgent.preset && isDefault
                                ? m.settings.switchDefaultFirst
                                : projectAgent.preset
                                  ? m.settings.restorePreset
                                  : m.settings.deleteProject
                            }
                          >
                            {props.deletingProjectAgentId === runtime.id ? (
                              <RefreshCw className="spin" size={14} />
                            ) : projectAgent.preset ? (
                              <RotateCcw size={14} />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        )}
                      </>
                    )}
                    <button
                      className="button"
                      type="button"
                      onClick={() => props.onTestRuntime(runtime.id)}
                      disabled={props.testingRuntimeId === runtime.id}
                    >
                      {props.testingRuntimeId === runtime.id && (
                        <RefreshCw className="spin" size={14} />
                      )}
                      {m.settings.testConnection}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
      {projectAgentDialog && (
        <ProjectAgentDialog
          key={projectAgentDialog === 'new' ? 'new' : projectAgentDialog.id}
          initial={projectAgentDialog === 'new' ? undefined : projectAgentDialog}
          isSaving={props.isSavingProjectAgent}
          onSave={(config) => props.onSaveProjectAgent(config, projectAgentDialog !== 'new')}
          onClose={() => setProjectAgentDialog(null)}
        />
      )}
    </section>
  )
}
