import { Link2, ListChecks, Plus, Trash2 } from 'lucide-react'
import { nodeKindLabel } from '../copy'
import { describeNode } from '../flow-labels'
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
  const {
    draft,
    selectedNodeId,
    selectedEdgeId,
    preview,
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
    ? { title: '连线', hint: '改接两端，或删除这条连线' }
    : selectedNode
      ? { title: describeNode(selectedNode, cfs, candidateCfs).label, hint: '修改这一步怎么工作' }
      : draft
        ? { title: '流程说明', hint: '没有选中步骤时，这里显示整条流程' }
        : { title: '还没有流程', hint: '先在上方选择或新建一条流程' }

  return (
    <div className="detail-layout">
      <header className="detail-heading">
        <h2>{heading.title}</h2>
        <p>{heading.hint}</p>
      </header>
      <div className="detail-scroll">
        {!draft ? (
          <div className="empty-panel">选中一条流程后，可在这里查看和修改步骤说明。</div>
        ) : selectedEdge ? (
          <section className="inspector-section">
            <div className="section-title-row">
              <div>
                <span className="section-icon">
                  <Link2 size={15} />
                </span>
                <h3>步骤连线</h3>
              </div>
              <span className="tag">可改接</span>
            </div>
            <label className="field">
              <span>从哪一步出发</span>
              <select
                value={selectedEdge.from}
                onChange={(event) => updateEdge({ ...selectedEdge, from: event.target.value })}
              >
                <option value="$entry">开始</option>
                {draft.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {describeNode(node, cfs, candidateCfs).label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>到哪一步</span>
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
              <span>什么时候走这条线</span>
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
                <option value="">上一步结束后</option>
                <option value="completed">上一步成功时</option>
                <option value="failed">上一步失败时</option>
                <option value="branch-case">走到某一条分支时</option>
                <option value="approved">审批通过时</option>
                <option value="rejected">审批拒绝时</option>
              </select>
            </label>
            {selectedEdge.when?.outcome === 'branch-case' &&
              (selectedEdgeSource?.kind === 'branch' ? (
                <label className="field">
                  <span>走哪一条路</span>
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
                  label="这条路的名称"
                  value={selectedEdge.when.caseId ?? ''}
                  onChange={(caseId) =>
                    updateEdge({ ...selectedEdge, when: { outcome: 'branch-case', caseId } })
                  }
                />
              ))}
            <p className="section-help">也可以拖动连线两端改接到别处，或选中后按 Delete 删除。</p>
            <button className="button danger full" type="button" onClick={deleteEdge}>
              <Trash2 size={15} /> 删除这条连线
            </button>
          </section>
        ) : selectedNode ? (
          <section className="inspector-section">
            <div className="section-title-row">
              <div>
                <h3>步骤设置</h3>
              </div>
              <span className="tag">{nodeKindLabel(selectedNode.kind)}</span>
            </div>
            {selectedNode.kind === 'cf-call' && (
              <>
                <div className="inspector-callout">
                  <strong>
                    {selectedCapability &&
                    (selectedCapability.name.trim() || selectedCapability.does.trim())
                      ? selectedCapabilityIsCandidate
                        ? '这是草稿能力，还可以改'
                        : '这是已发布的能力'
                      : '新步骤'}
                  </strong>
                  <span>
                    {selectedCapability &&
                    (selectedCapability.name.trim() || selectedCapability.does.trim())
                      ? selectedCapabilityIsCandidate
                        ? '这里的说明会在下次检查和测试时用到。'
                        : '改动只会用于当前流程，不会修改已经发布的能力。'
                      : '先填写能力名称、任务和处理约束。输入与产出会由流程运行时自动处理。'}
                  </span>
                </div>
                <label className="field">
                  <span>由谁执行</span>
                  <select
                    value={selectedNode.executor ?? ''}
                    onChange={(event) =>
                      updateNode({ ...selectedNode, executor: event.target.value || undefined })
                    }
                  >
                    <option value="">使用这项能力的默认助手</option>
                    {runtimes.map((runtime) => {
                      const available = runtime.enabled && runtime.health?.status === 'available'
                      return (
                        <option key={runtime.id} value={runtime.id} disabled={!available}>
                          {runtime.name} ·{' '}
                          {runtime.health?.status === 'available' ? '可用' : '不可用'}
                        </option>
                      )
                    })}
                  </select>
                </label>
                {selectedCapability && (
                  <>
                    <Field
                      label="能力名称"
                      value={selectedCapability.name}
                      onChange={(name) => updateCapability({ name })}
                    />
                    <Field
                      label="要做什么"
                      value={selectedCapability.does}
                      multiline
                      onChange={(does) => updateCapability({ does })}
                    />
                    <div className="field field-auto-context">
                      <span>数据上下文</span>
                      <div className="auto-context-note">
                        <strong>自动接收上游结果</strong>
                        <span>
                          运行时会把 Flow 输入和所有直接上游节点的完整结果交给
                          Agent，由任务描述决定如何使用。
                        </span>
                      </div>
                    </div>
                    <Field
                      label="处理时要注意什么"
                      value={selectedCapability.process ?? ''}
                      multiline
                      onChange={(process) => updateCapability({ process })}
                    />
                    <div className="field effects-field">
                      <span>会产生什么影响</span>
                      {/(修改|写入|修正|更新).*(文件|文档)/.test(selectedCapability.does) &&
                        !(selectedCapability.effects ?? []).some(
                          (effect) => effect.type === 'file-write',
                        ) && (
                          <small className="effect-warning">
                            当前任务涉及修改文件，请勾选“会修改工作区内的文件”，否则测试时 Agent
                            会拒绝执行。
                          </small>
                        )}
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
                                description: '读取工作区内的文件',
                              })
                            updateCapability({ effects })
                          }}
                        />
                        会读取工作区内的文件
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
                                description: '修改用户工作区内指定文件',
                              })
                            updateCapability({ effects })
                          }}
                        />
                        会修改工作区内的文件
                      </label>
                    </div>
                  </>
                )}
              </>
            )}
            {selectedNode.kind === 'branch' && (
              <>
                <Field
                  label="根据哪个结果来判断"
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
                      <strong>走哪条路</strong>
                      <span>每条说明对应一条往右的路</span>
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      title="增加一条路"
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
                          label="这条路的名称"
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
                          label="什么情况下走这条路"
                          value={selectedNode.caseConditions?.[caseId] ?? ''}
                          multiline
                          onChange={(value) => updateBranchCase(index, caseId, value)}
                        />
                      </div>
                      <button
                        className="icon-button danger"
                        type="button"
                        title="删除这条路"
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
                <span>什么时候继续</span>
                <select
                  value={selectedNode.mode}
                  onChange={(event) =>
                    updateNode({ ...selectedNode, mode: event.target.value as 'all' | 'any' })
                  }
                >
                  <option value="all">等所有上一步都完成</option>
                  <option value="any">任一步完成后继续</option>
                </select>
              </label>
            )}
            {selectedNode.kind === 'approval' && (
              <Field
                label="怎么审批"
                value={selectedNode.policyRef}
                onChange={(policyRef) => updateNode({ ...selectedNode, policyRef })}
              />
            )}
            {selectedNode.kind === 'output' && (
              <Field
                label="结果名称"
                value={selectedNode.outputId}
                onChange={(outputId) => updateNode({ ...selectedNode, outputId })}
              />
            )}
            <details className="tech-disclosure">
              <summary>技术编号</summary>
              <Field label="步骤编号" value={selectedNode.id} readOnly onChange={() => undefined} />
              {selectedNode.kind === 'cf-call' && (
                <>
                  <Field
                    label="能力编号"
                    value={selectedNode.cfRef.cfId}
                    onChange={(cfId) =>
                      updateNode({ ...selectedNode, cfRef: { ...selectedNode.cfRef, cfId } })
                    }
                  />
                  <Field
                    label="版本"
                    value={selectedNode.cfRef.version}
                    onChange={(version) =>
                      updateNode({ ...selectedNode, cfRef: { ...selectedNode.cfRef, version } })
                    }
                  />
                </>
              )}
            </details>
            <button className="button danger full" type="button" onClick={deleteNode}>
              <Trash2 size={15} /> 删除这个步骤
            </button>
          </section>
        ) : (
          <>
            <section className="inspector-section">
              <h3>基本信息</h3>
              <Field
                label="流程名称"
                value={draft.name}
                onChange={(name) => onDraftChange({ ...draft, name, revision: draft.revision + 1 })}
              />
              <Field
                label="目标"
                value={draft.objective}
                multiline
                onChange={(objective) =>
                  onDraftChange({ ...draft, objective, revision: draft.revision + 1 })
                }
              />
              <div className="property-list">
                <div>
                  <span>草稿次数</span>
                  <strong>第 {draft.revision} 稿</strong>
                </div>
                <div>
                  <span>步骤</span>
                  <strong>{draft.nodes.length}</strong>
                </div>
                <div>
                  <span>连线</span>
                  <strong>{draft.edges.length}</strong>
                </div>
                <div>
                  <span>数据交接</span>
                  <strong>自动</strong>
                </div>
              </div>
            </section>
            <section className="inspector-section">
              <div className="section-title-row">
                <div>
                  <h3>能不能测试</h3>
                </div>
              </div>
              <div className={`compile-status ${preview ? 'ready' : ''}`}>
                <span className="status-lamp" />
                <div>
                  <strong>{preview ? '已经检查过，可以测试' : '还没检查'}</strong>
                  <p>
                    {preview
                      ? `${preview.plan.nodes.length} 个步骤已核对`
                      : '检查只确认流程是否完整，不会真的运行或发布。'}
                  </p>
                </div>
              </div>
              <button className="button full" type="button" onClick={onOpenCheck}>
                <ListChecks size={15} /> 去检查
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
