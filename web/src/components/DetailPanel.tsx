import { Link2, ListChecks, Plus, Trash2 } from 'lucide-react'
import { nodeKindLabel } from '../copy'
import { describeNode } from '../flow-labels'
import { format } from '../i18n'
import { useLocale } from '../locale-context'
import { FileMentionField } from './FileMentionField'
import { FileReferencePicker } from './FileReferencePicker'
import { FileExtractionSettings } from './FileExtractionSettings'
import type {
  CFDraft,
  CFVersion,
  CompilationPreview,
  FlowDraft,
  FlowEdge,
  FlowNode,
  RuntimeWithHealth,
} from '../types'

type DetailPanelProps = {
  draft: FlowDraft | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  preview: CompilationPreview | null
  testCount: number
  cfs?: CFVersion[]
  candidateCfs?: CFDraft[]
  runtimes?: RuntimeWithHealth[]
  onDraftChange: (next: FlowDraft) => void
  onCandidateCfChange?: (next: CFDraft) => void
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
  onOpenCheck: () => void
}

function Field(props: {
  label: string
  value: string
  multiline?: boolean
  readOnly?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea
          value={props.value}
          readOnly={props.readOnly}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input
          value={props.value}
          readOnly={props.readOnly}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </label>
  )
}

/**
 * The left-hand detail panel: edit the selected step, the selected connection,
 * or — when nothing is selected — the flow itself. Technical identifiers stay
 * behind the 技术编号 disclosure.
 */
export function DetailPanel(props: DetailPanelProps) {
  const { m, locale } = useLocale()
  const {
    draft,
    selectedNodeId,
    selectedEdgeId,
    preview,
    testCount,
    cfs = [],
    candidateCfs = [],
    runtimes = [],
    onDraftChange,
    onCandidateCfChange = () => undefined,
    onSelectEdge,
    onSelectNode,
    onOpenCheck,
  } = props
  const selectedNode = draft?.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedBranchNode = selectedNode?.kind === 'branch' ? selectedNode : null
  const selectedCfNode = selectedNode?.kind === 'cf-call' ? selectedNode : null
  const selectedEdge = draft?.edges.find((edge) => edge.id === selectedEdgeId) ?? null
  const selectedEdgeSource =
    selectedEdge && draft ? draft.nodes.find((node) => node.id === selectedEdge.from) : null
  const selectedCapability = selectedCfNode
    ? (candidateCfs.find((item) => item.cfId === selectedCfNode.cfRef.cfId) ??
      cfs.find(
        (item) =>
          item.cfId === selectedCfNode.cfRef.cfId && item.version === selectedCfNode.cfRef.version,
      )?.draft)
    : null
  const selectedCapabilityIsCandidate =
    selectedCfNode !== null && candidateCfs.some((item) => item.cfId === selectedCfNode.cfRef.cfId)
  const hasFileAccess = (selectedCapability?.effects ?? []).some(
    (effect) => effect.type === 'file-read' || effect.type === 'file-write',
  )
  const fileWarnings = selectedCfNode
    ? (preview?.warnings ?? []).filter((warning) => warning.nodeId === selectedCfNode.id)
    : []
  const updateNode = (next: FlowNode) => {
    if (!draft) return
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.map((node) => (node.id === next.id ? next : node)),
    })
  }
  const updateEdge = (next: FlowEdge) => {
    if (!draft) return
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      edges: draft.edges.map((edge) => (edge.id === next.id ? next : edge)),
    })
  }
  const updateBranchCase = (index: number, nextId: string, description: string) => {
    if (!draft || !selectedBranchNode) return
    const currentId = selectedBranchNode.cases[index]
    const id = nextId.trim() || currentId
    const cases = selectedBranchNode.cases.map((caseId, caseIndex) =>
      caseIndex === index ? id : caseId,
    )
    const caseConditions = { ...(selectedBranchNode.caseConditions ?? {}) }
    delete caseConditions[currentId]
    caseConditions[id] = description
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.map((node) =>
        node.id === selectedBranchNode.id ? { ...node, cases, caseConditions } : node,
      ),
      edges: draft.edges.map((edge) =>
        edge.from === selectedBranchNode.id &&
        edge.when?.outcome === 'branch-case' &&
        edge.when.caseId === currentId
          ? { ...edge, when: { ...edge.when, caseId: id } }
          : edge,
      ),
    })
  }
  const addBranchCase = () => {
    if (!draft || !selectedBranchNode) return
    const id = `case-${selectedBranchNode.cases.length + 1}`
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.map((node) =>
        node.id === selectedBranchNode.id
          ? {
              ...selectedBranchNode,
              cases: [...selectedBranchNode.cases, id],
              caseConditions: { ...(selectedBranchNode.caseConditions ?? {}), [id]: '' },
            }
          : node,
      ),
    })
  }
  const removeBranchCase = (index: number) => {
    if (!draft || !selectedBranchNode || selectedBranchNode.cases.length <= 1) return
    const removed = selectedBranchNode.cases[index]
    const cases = selectedBranchNode.cases.filter((_, caseIndex) => caseIndex !== index)
    const caseConditions = { ...(selectedBranchNode.caseConditions ?? {}) }
    delete caseConditions[removed]
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.map((node) =>
        node.id === selectedBranchNode.id ? { ...node, cases, caseConditions } : node,
      ),
      edges: draft.edges.filter(
        (edge) =>
          !(
            edge.from === selectedBranchNode.id &&
            edge.when?.outcome === 'branch-case' &&
            edge.when.caseId === removed
          ),
      ),
    })
  }
  const updateCapability = (patch: Partial<CFDraft>) => {
    if (!draft || !selectedCfNode || !selectedCapability) return
    const revision =
      Math.max(
        selectedCapability.revision,
        Number.parseInt(selectedCfNode.cfRef.version, 10) || 1,
      ) + 1
    const nextCapability: CFDraft = { ...selectedCapability, ...patch, revision }
    onCandidateCfChange(nextCapability)
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.map((node) =>
        node.kind === 'cf-call' && node.id === selectedCfNode.id
          ? { ...node, cfRef: { ...node.cfRef, version: `${revision}.0.0` } }
          : node,
      ),
    })
  }
  const deleteEdge = () => {
    if (!draft || !selectedEdge) return
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      edges: draft.edges.filter((edge) => edge.id !== selectedEdge.id),
    })
    onSelectEdge(null)
  }
  const deleteNode = () => {
    if (!draft || !selectedNode) return
    onDraftChange({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.filter((node) => node.id !== selectedNode.id),
      edges: draft.edges.filter(
        (edge) => edge.from !== selectedNode.id && edge.to !== selectedNode.id,
      ),
    })
    onSelectNode(null)
  }

  const heading = selectedEdge
    ? { title: m.detail.edgeTitle, hint: m.detail.edgeHint }
    : selectedNode
      ? {
          title: describeNode(selectedNode, cfs, candidateCfs, locale).label,
          hint: m.detail.nodeHint,
        }
      : draft
        ? { title: m.detail.flowTitle, hint: m.detail.flowHint }
        : { title: m.detail.emptyTitle, hint: m.detail.emptyHint }

  return (
    <div className="detail-layout">
      <header className="detail-heading">
        <h2>{heading.title}</h2>
        <p>{heading.hint}</p>
      </header>
      <div className="detail-scroll">
        {!draft ? (
          <div className="empty-panel">{m.detail.empty}</div>
        ) : selectedEdge ? (
          <section className="inspector-section">
            <div className="section-title-row">
              <div>
                <span className="section-icon">
                  <Link2 size={15} />
                </span>
                <h3>{m.detail.edgeHeading}</h3>
              </div>
              <span className="tag">{m.detail.reconnectable}</span>
            </div>
            <label className="field">
              <span>{m.detail.from}</span>
              <select
                value={selectedEdge.from}
                onChange={(event) => updateEdge({ ...selectedEdge, from: event.target.value })}
              >
                <option value="$entry">{m.canvas.start}</option>
                {draft.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {describeNode(node, cfs, candidateCfs).label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{m.detail.to}</span>
              <select
                value={selectedEdge.to}
                onChange={(event) => updateEdge({ ...selectedEdge, to: event.target.value })}
              >
                {draft.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {describeNode(node, cfs, candidateCfs).label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{m.detail.when}</span>
              <select
                value={selectedEdge.when?.outcome ?? ''}
                onChange={(event) => {
                  const outcome = event.target.value as
                    NonNullable<FlowEdge['when']>['outcome'] | ''
                  const defaultCase =
                    selectedEdgeSource?.kind === 'branch'
                      ? (selectedEdgeSource.cases[0] ?? 'case-1')
                      : 'default'
                  updateEdge({
                    ...selectedEdge,
                    when: outcome
                      ? { outcome, ...(outcome === 'branch-case' ? { caseId: defaultCase } : {}) }
                      : undefined,
                  })
                }}
              >
                <option value="">{m.detail.afterPrevious}</option>
                <option value="completed">{m.detail.onSuccess}</option>
                <option value="failed">{m.detail.onFailure}</option>
                <option value="branch-case">{m.detail.onBranch}</option>
              </select>
            </label>
            {selectedEdge.when?.outcome === 'branch-case' &&
              (selectedEdgeSource?.kind === 'branch' ? (
                <label className="field">
                  <span>{m.detail.whichRoute}</span>
                  <select
                    value={selectedEdge.when.caseId ?? ''}
                    onChange={(event) =>
                      updateEdge({
                        ...selectedEdge,
                        when: { outcome: 'branch-case', caseId: event.target.value },
                      })
                    }
                  >
                    {selectedEdgeSource.cases.map((caseId) => (
                      <option key={caseId} value={caseId}>
                        {selectedEdgeSource.caseConditions?.[caseId] || caseId}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Field
                  label={m.detail.routeName}
                  value={selectedEdge.when.caseId ?? ''}
                  onChange={(caseId) =>
                    updateEdge({ ...selectedEdge, when: { outcome: 'branch-case', caseId } })
                  }
                />
              ))}
            <p className="section-help">{m.detail.edgeHelp}</p>
            <button className="button danger full" type="button" onClick={deleteEdge}>
              <Trash2 size={15} /> {m.detail.deleteEdge}
            </button>
          </section>
        ) : selectedNode ? (
          <section className="inspector-section">
            <div className="section-title-row">
              <div>
                <h3>{m.detail.stepHeading}</h3>
              </div>
              <span className="tag">{nodeKindLabel(selectedNode.kind, locale)}</span>
            </div>
            {selectedNode.kind === 'cf-call' &&
              selectedCapability?.execution?.kind === 'builtin' && (
                <FileExtractionSettings
                  key={selectedNode.id}
                  node={selectedNode}
                  draft={draft}
                  onChange={updateNode}
                />
              )}
            {selectedNode.kind === 'cf-call' &&
              selectedCapability?.execution?.kind !== 'builtin' && (
                <>
                  <div className="inspector-callout">
                    <strong>
                      {selectedCapability &&
                      (selectedCapability.name.trim() || selectedCapability.does.trim())
                        ? selectedCapabilityIsCandidate
                          ? m.detail.draftCapability
                          : m.detail.publishedCapability
                        : m.detail.newStep}
                    </strong>
                    <span>
                      {selectedCapability &&
                      (selectedCapability.name.trim() || selectedCapability.does.trim())
                        ? selectedCapabilityIsCandidate
                          ? m.detail.draftHint
                          : m.detail.publishedHint
                        : m.detail.newHint}
                    </span>
                  </div>
                  <label className="field">
                    <span>{m.detail.executor}</span>
                    <select
                      value={selectedNode.executor ?? ''}
                      onChange={(event) =>
                        updateNode({ ...selectedNode, executor: event.target.value || undefined })
                      }
                    >
                      <option value="">{m.detail.defaultExecutor}</option>
                      {selectedNode.executor === 'cflow-demo' &&
                        !runtimes.some((runtime) => runtime.id === 'cflow-demo') && (
                          <option value="cflow-demo">{m.detail.demoExecutor}</option>
                        )}
                      {runtimes.map((runtime) => {
                        const available = runtime.enabled && runtime.health?.status === 'available'
                        return (
                          <option key={runtime.id} value={runtime.id} disabled={!available}>
                            {runtime.name} ·{' '}
                            {runtime.health?.status === 'available'
                              ? m.detail.available
                              : m.detail.unavailable}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  {selectedCapability && (
                    <>
                      <Field
                        label={m.detail.capabilityName}
                        value={selectedCapability.name}
                        onChange={(name) => updateCapability({ name })}
                      />
                      <FileMentionField
                        value={selectedCapability.does}
                        references={selectedCapability.fileReferences ?? []}
                        active={hasFileAccess}
                        onChange={(does) => updateCapability({ does })}
                      />
                      <div className="field field-auto-context">
                        <span>{m.detail.context}</span>
                        <div className="auto-context-note">
                          <strong>{m.detail.autoUpstream}</strong>
                          <span>{m.detail.autoUpstreamHint}</span>
                        </div>
                      </div>
                      <Field
                        label={m.detail.process}
                        value={selectedCapability.process ?? ''}
                        multiline
                        onChange={(process) => updateCapability({ process })}
                      />
                      <div className="field effects-field">
                        <span>{m.detail.effects}</span>
                        {/(修改|写入|修正|更新|change|write|update).*(文件|文档|file|document)/i.test(
                          selectedCapability.does,
                        ) &&
                          !(selectedCapability.effects ?? []).some(
                            (effect) => effect.type === 'file-write',
                          ) && <small className="effect-warning">{m.detail.fileWriteHint}</small>}
                        {/(执行|运行|调用|启动|run|execute|launch).*(脚本|命令|程序|script|command|program|PowerShell|Python|bash|shell)/i.test(
                          `${selectedCapability.does} ${selectedCapability.process ?? ''}`,
                        ) &&
                          !(selectedCapability.effects ?? []).some(
                            (effect) => effect.type === 'command',
                          ) && <small className="effect-warning">{m.detail.commandHint}</small>}
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={(selectedCapability.effects ?? []).some(
                              (effect) => effect.type === 'file-read',
                            )}
                            onChange={(event) => {
                              const effects = (selectedCapability.effects ?? []).filter(
                                (effect) => effect.type !== 'file-read',
                              )
                              if (event.target.checked)
                                effects.push({
                                  type: 'file-read',
                                  scope: 'workspace',
                                  description: m.detail.readFilesDesc,
                                })
                              updateCapability({ effects })
                            }}
                          />
                          {m.detail.readFiles}
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={(selectedCapability.effects ?? []).some(
                              (effect) => effect.type === 'file-write',
                            )}
                            onChange={(event) => {
                              const effects = (selectedCapability.effects ?? []).filter(
                                (effect) => effect.type !== 'file-write',
                              )
                              if (event.target.checked)
                                effects.push({
                                  type: 'file-write',
                                  scope: 'workspace',
                                  description: m.detail.writeFilesDesc,
                                })
                              updateCapability({ effects })
                            }}
                          />
                          {m.detail.writeFiles}
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={(selectedCapability.effects ?? []).some(
                              (effect) => effect.type === 'command',
                            )}
                            onChange={(event) => {
                              const effects = (selectedCapability.effects ?? []).filter(
                                (effect) => effect.type !== 'command',
                              )
                              if (event.target.checked)
                                effects.push({
                                  type: 'command',
                                  scope: 'workspace',
                                  description: m.detail.runCommandsDesc,
                                })
                              updateCapability({ effects })
                            }}
                          />
                          {m.detail.runCommands}
                        </label>
                        <FileReferencePicker
                          active={hasFileAccess}
                          references={selectedCapability.fileReferences ?? []}
                          onChange={(fileReferences) => updateCapability({ fileReferences })}
                        />
                        {fileWarnings.length > 0 && (
                          <div className="file-reference-warnings" role="status">
                            {fileWarnings.map((warning) => (
                              <span key={`${warning.code}:${warning.path}`}>{warning.message}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            {selectedNode.kind === 'branch' && (
              <>
                <Field
                  label={m.detail.branchOn}
                  value={
                    selectedNode.cond &&
                    typeof selectedNode.cond === 'object' &&
                    !Array.isArray(selectedNode.cond) &&
                    '$get' in selectedNode.cond
                      ? String(selectedNode.cond.$get ?? '')
                      : ''
                  }
                  onChange={(path) => updateNode({ ...selectedNode, cond: { $get: path.trim() } })}
                />
                <div className="branch-conditions">
                  <div className="branch-conditions-heading">
                    <div>
                      <strong>{m.detail.routes}</strong>
                      <span>{m.detail.routesHint}</span>
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      title={m.detail.addRoute}
                      onClick={addBranchCase}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  {selectedNode.cases.map((caseId, index) => (
                    <div className="branch-condition-row" key={`${caseId}-${index}`}>
                      <div className="branch-condition-index">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div className="branch-condition-fields">
                        <Field
                          label={m.detail.routeName}
                          value={caseId}
                          onChange={(value) =>
                            updateBranchCase(
                              index,
                              value,
                              selectedNode.caseConditions?.[caseId] ?? '',
                            )
                          }
                        />
                        <Field
                          label={m.detail.routeCondition}
                          value={selectedNode.caseConditions?.[caseId] ?? ''}
                          multiline
                          onChange={(value) => updateBranchCase(index, caseId, value)}
                        />
                      </div>
                      <button
                        className="icon-button danger"
                        type="button"
                        title={m.detail.deleteRoute}
                        onClick={() => removeBranchCase(index)}
                        disabled={selectedNode.cases.length <= 1}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {selectedNode.kind === 'join' && (
              <label className="field">
                <span>{m.detail.joinWhen}</span>
                <select
                  value={selectedNode.mode}
                  onChange={(event) =>
                    updateNode({ ...selectedNode, mode: event.target.value as 'all' | 'any' })
                  }
                >
                  <option value="all">{m.detail.joinAll}</option>
                  <option value="any">{m.detail.joinAny}</option>
                </select>
              </label>
            )}
            {selectedNode.kind === 'output' && (
              <Field
                label={m.detail.outputName}
                value={selectedNode.outputId}
                onChange={(outputId) => updateNode({ ...selectedNode, outputId })}
              />
            )}
            <details className="tech-disclosure">
              <summary>{m.detail.technical}</summary>
              <Field
                label={m.detail.stepId}
                value={selectedNode.id}
                readOnly
                onChange={() => undefined}
              />
              {selectedNode.kind === 'cf-call' && (
                <>
                  <Field
                    label={m.detail.capabilityId}
                    value={selectedNode.cfRef.cfId}
                    onChange={(cfId) =>
                      updateNode({ ...selectedNode, cfRef: { ...selectedNode.cfRef, cfId } })
                    }
                  />
                  <Field
                    label={m.detail.version}
                    value={selectedNode.cfRef.version}
                    onChange={(version) =>
                      updateNode({ ...selectedNode, cfRef: { ...selectedNode.cfRef, version } })
                    }
                  />
                </>
              )}
            </details>
            <button className="button danger full" type="button" onClick={deleteNode}>
              <Trash2 size={15} /> {m.detail.deleteStep}
            </button>
          </section>
        ) : (
          <>
            <section className="inspector-section">
              <h3>{m.detail.basics}</h3>
              <Field
                label={m.detail.flowName}
                value={draft.name}
                onChange={(name) => onDraftChange({ ...draft, name, revision: draft.revision + 1 })}
              />
              <Field
                label={m.detail.objective}
                value={draft.objective}
                multiline
                onChange={(objective) =>
                  onDraftChange({ ...draft, objective, revision: draft.revision + 1 })
                }
              />
              <div className="property-list">
                <div>
                  <span>{m.detail.testTimes}</span>
                  <strong>{format(m.detail.testCount, { count: testCount })}</strong>
                </div>
                <div>
                  <span>{m.detail.stepCountLabel}</span>
                  <strong>{draft.nodes.length}</strong>
                </div>
                <div>
                  <span>{m.detail.edges}</span>
                  <strong>{draft.edges.length}</strong>
                </div>
                <div>
                  <span>{m.detail.handoff}</span>
                  <strong>{m.detail.auto}</strong>
                </div>
              </div>
            </section>
            <section className="inspector-section">
              <div className="section-title-row">
                <div>
                  <h3>{m.detail.canTest}</h3>
                </div>
              </div>
              <div className={`compile-status ${preview ? 'ready' : ''}`}>
                <span className="status-lamp" />
                <div>
                  <strong>{preview ? m.detail.checked : m.detail.notChecked}</strong>
                  <p>
                    {preview
                      ? format(m.detail.checkedSteps, { count: preview.plan.nodes.length })
                      : m.detail.checkHint}
                  </p>
                </div>
              </div>
              <button className="button full" type="button" onClick={onOpenCheck}>
                <ListChecks size={15} /> {m.detail.openCheck}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
