import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  CircleStop,
  GitBranch,
  GitMerge,
  Library,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Split,
  Workflow,
  Upload,
} from 'lucide-react'
import { api, readableError } from './api'
import { CapabilityLibrary } from './components/CapabilityLibrary'
import { CompilerPreviewView } from './components/CompilerPreview'
import { FlowCanvas } from './components/FlowCanvas'
import { FlowSidebar } from './components/FlowSidebar'
import { Inspector } from './components/Inspector'
import { SettingsView } from './components/SettingsView'
import { testStateLabel } from './copy'
import { deriveNodeRunStates, type NodeRunState } from './run'
import { draftSaveStatus, runStopControl } from './workbench-ui'
import type {
  CanvasPosition,
  CFDraft,
  CompilationPreview,
  RunDetail,
  FlowDraft,
  FlowNode,
  FlowPlan,
  AgentChatAction,
  AgentChatMessage,
} from './types'

type WorkView = 'chat' | 'canvas' | 'compiler'
type TestState = 'idle' | 'running' | 'passed' | 'failed' | 'cancelled' | 'published'
type Message = { id: string; role: 'user' | 'assistant'; body: string; meta?: string }

const workspaceKey = 'cf-platform-react-workbench-v1'

function readStoredWorkspace() {
  try {
    const value = localStorage.getItem(workspaceKey)
    return value
      ? (JSON.parse(value) as {
          draft?: FlowDraft
          positions?: Record<string, CanvasPosition>
          candidateCfs?: CFDraft[]
          messages?: Message[]
          agentMessages?: AgentChatMessage[]
          runId?: string | null
          runMode?: 'test' | 'live' | null
          inspectedRunId?: string | null
          inspectorTab?: 'details' | 'activity' | 'agent'
        })
      : {}
  } catch {
    return {}
  }
}

function planToDraft(plan: FlowPlan): FlowDraft {
  const idByIndex = new Map(plan.nodes.map((node) => [node.index, node.id]))
  return {
    flowId: plan.flowId,
    revision: Number.parseInt(plan.flowVersion, 10) + 1,
    name: plan.objective,
    objective: plan.objective,
    nodes: plan.nodes.map((node) => {
      const {
        index: _index,
        programHash: _programHash,
        executorProfile: _profile,
        ...draftNode
      } = node
      return draftNode as FlowNode
    }),
    edges: plan.edges.map((edge) => ({
      ...edge,
      from: edge.from === '$entry' ? '$entry' : idByIndex.get(edge.from)!,
      to: idByIndex.get(edge.to)!,
    })),
    resources: plan.resources,
    limits: plan.limits,
  }
}

function runtimeStatus(runtime: { enabled: boolean; health?: { status: string } }) {
  if (!runtime.enabled) return 'disabled'
  return runtime.health?.status ?? 'checking'
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function App() {
  const queryClient = useQueryClient()
  const stored = useRef(readStoredWorkspace()).current
  const [draft, setDraft] = useState<FlowDraft | null>(stored.draft ?? null)
  const [positions, setPositions] = useState<Record<string, CanvasPosition>>(stored.positions ?? {})
  const [candidateCfs, setCandidateCfs] = useState<CFDraft[]>(stored.candidateCfs ?? [])
  const [messages, setMessages] = useState<Message[]>(stored.messages ?? [])
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>(stored.agentMessages ?? [])
  const [view, setView] = useState<WorkView>(stored.draft ? 'canvas' : 'chat')
  const [inspectorTab, setInspectorTab] = useState<'details' | 'activity' | 'agent'>(
    stored.inspectorTab ?? 'details',
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dirty, setDirty] = useState(Boolean(stored.draft))
  const [testState, setTestState] = useState<TestState>('idle')
  const [runId, setRunId] = useState<string | null>(stored.runId ?? null)
  const [runMode, setRunMode] = useState<'test' | 'live' | null>(stored.runMode ?? null)
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(
    stored.inspectedRunId ?? stored.runId ?? null,
  )
  const [preview, setPreview] = useState<CompilationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    tone: 'info' | 'success' | 'error'
    title: string
    detail: string
  } | null>(null)
  const [goal, setGoal] = useState('')
  const [runtimeId, setRuntimeId] = useState('echo')
  const [compileRuntimeId, setCompileRuntimeId] = useState('echo')
  const [testingRuntimeId, setTestingRuntimeId] = useState<string | null>(null)

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap })
  const data = bootstrap.data
  const handledRunStateRef = useRef<string | null>(null)

  useEffect(() => {
    if (data?.settings.defaultRuntimeId && runtimeId === 'echo')
      setRuntimeId(data.settings.defaultRuntimeId)
  }, [data?.settings.defaultRuntimeId, runtimeId])
  useEffect(() => {
    if (data?.settings.defaultRuntimeId && compileRuntimeId === 'echo')
      setCompileRuntimeId(data.settings.defaultRuntimeId)
  }, [compileRuntimeId, data?.settings.defaultRuntimeId])
  useEffect(() => {
    if (!settingsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen])

  useEffect(() => {
    if (!data?.cfs.length || !candidateCfs.length) return
    setCandidateCfs((current) =>
      current.filter(
        (candidate) =>
          !data.cfs.some(
            (version) => version.cfId === candidate.cfId && version.version === '1.0.0',
          ),
      ),
    )
  }, [data?.cfs, candidateCfs.length])

  useEffect(() => {
    localStorage.setItem(
      workspaceKey,
      JSON.stringify({
        draft,
        positions,
        candidateCfs,
        messages,
        agentMessages,
        runId,
        runMode,
        inspectedRunId,
        inspectorTab,
      }),
    )
  }, [
    agentMessages,
    candidateCfs,
    draft,
    inspectedRunId,
    inspectorTab,
    messages,
    positions,
    runId,
    runMode,
  ])

  useEffect(() => {
    if (!draft || !data?.flowCompilations.length) return
    const snapshot = [...data.flowCompilations]
      .filter(
        (item) =>
          item.flowId === draft.flowId &&
          item.flowRevision === draft.revision &&
          item.plan.flowId === draft.flowId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!snapshot) return
    setPreview((current) => {
      if (
        current &&
        current.plan.flowId === snapshot.plan.flowId &&
        current.plan.flowVersion === snapshot.plan.flowVersion
      ) {
        return current
      }
      return { plan: snapshot.plan, programs: snapshot.programs }
    })
  }, [data?.flowCompilations, draft?.flowId, draft?.revision])

  const saveMutation = useMutation({
    mutationFn: api.saveDraft,
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: '自动保存失败', detail: readableError(error) }),
  })
  const deleteDraftMutation = useMutation({
    mutationFn: api.deleteDraft,
    onSuccess: (_, flowId) => {
      queryClient.setQueryData<typeof data>(['bootstrap'], (current) =>
        current
          ? {
              ...current,
              flowDrafts: current.flowDrafts.filter((item) => item.flowId !== flowId),
            }
          : current,
      )
      setNotice({
        tone: 'success',
        title: '草稿已删除',
        detail: '这份未发布的流程草稿已从工作台移除。',
      })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: '删除失败', detail: readableError(error) }),
  })
  useEffect(() => {
    if (!dirty || !draft) return
    const timer = window.setTimeout(() => saveMutation.mutate(draft), 900)
    return () => window.clearTimeout(timer)
  }, [dirty, draft])

  const compileMutation = useMutation({
    mutationFn: () => api.compile(draft!, candidateCfs, compileRuntimeId),
    onMutate: () => setPreviewError(null),
    onSuccess: (result) => {
      setPreview(result)
      setNotice({
        tone: 'success',
        title: '检查完成',
        detail: `流程完整，共 ${result.plan.nodes.length} 个步骤，可以开始测试。`,
      })
    },
    onError: (error) => {
      const detail = readableError(error)
      setPreview(null)
      setPreviewError(detail)
      setNotice({ tone: 'error', title: '检查未通过', detail })
    },
  })
  const isRunning = Boolean(runMode)

  const proposalMutation = useMutation({
    mutationFn: ({ objective, runtime }: { objective: string; runtime: string }) =>
      api.propose(objective, runtime),
    onSuccess: (proposal, variables) => {
      if (!proposal.flowDraft) {
        setMessages((current) => [
          ...current,
          {
            id: uniqueId('message'),
            role: 'assistant',
            body: '还没有足够的现成能力来组成这条流程。请换一个可用的助手，或先把相关能力发布出来。',
          },
        ])
        return
      }
      setDraft(proposal.flowDraft)
      setCandidateCfs(proposal.cfDrafts ?? [])
      setPositions({})
      setMessages((current) => [
        ...current,
        {
          id: uniqueId('message'),
          role: 'assistant',
          body: proposal.assistantMessage ?? '已经生成一份可以调整的流程草案。',
          meta: variables.runtime,
        },
      ])
      setDirty(true)
      setTestState('idle')
      setPreview(null)
      setView('canvas')
    },
    onError: (error) => {
      const detail = readableError(error)
      setMessages((current) => [
        ...current,
        { id: uniqueId('message'), role: 'assistant', body: `生成失败：${detail}` },
      ])
      setNotice({ tone: 'error', title: '生成失败', detail })
    },
  })

  const testMutation = useMutation({
    mutationFn: () =>
      api.test(draft!, candidateCfs, data?.settings.defaultResourceProfileId, compileRuntimeId),
    onMutate: () => {
      setRunMode('test')
      setTestState('running')
      setNotice({
        tone: 'info',
        title: '正在测试这条流程',
        detail: '会先自动编译并保存 DSL，再试跑一遍，结果会显示在右侧活动里。',
      })
    },
    onSuccess: (result) => {
      setRunId(result.runId)
      setInspectedRunId(result.runId)
      setPreview({ plan: result.plan, programs: result.programs })
    },
    onError: (error) => {
      const detail = readableError(error)
      setTestState('failed')
      setRunMode(null)
      setNotice({ tone: 'error', title: '测试未通过', detail })
    },
  })
  const liveRunMutation = useMutation({
    mutationFn: (plan: FlowPlan) =>
      api.run(plan.flowId, plan.flowVersion, data?.settings.defaultResourceProfileId),
    onMutate: () => {
      setRunMode('live')
      setNotice({ tone: 'info', title: '流程已开始运行', detail: '进度和输出会显示在右侧活动里。' })
    },
    onSuccess: (result) => {
      setRunId(result.runId)
      setInspectedRunId(result.runId)
    },
    onError: (error) => {
      setRunMode(null)
      setNotice({ tone: 'error', title: '运行启动失败', detail: readableError(error) })
    },
  })
  const liveRunQuery = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status
      return status && ['completed', 'failed', 'cancelled'].includes(status) ? false : 700
    },
  })
  const viewedRunQuery = useQuery({
    queryKey: ['run', inspectedRunId],
    queryFn: () => api.getRun(inspectedRunId!),
    enabled: Boolean(inspectedRunId),
  })
  const activeRun: RunDetail | null = liveRunQuery.data ?? null
  const viewedRun: RunDetail | null = viewedRunQuery.data ?? null
  const nodeRunStates = useMemo(() => deriveNodeRunStates(draft, activeRun), [activeRun, draft])
  const nodeRunStateRecord = useMemo(
    () => Object.fromEntries(nodeRunStates) as Record<string, NodeRunState>,
    [nodeRunStates],
  )
  const waitingApprovalNode = [...(liveRunQuery.data?.events ?? [])]
    .reverse()
    .find((event) => event.type === 'approval.requested')?.node
  const approvalMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      api.decideApproval(runId!, waitingApprovalNode!, decision),
    onSuccess: (_, decision) => {
      setNotice({
        tone: 'success',
        title: decision === 'approved' ? '已批准继续' : '已拒绝',
        detail: decision === 'approved' ? '运行正在继续。' : '运行将按拒绝线路推进。',
      })
      void liveRunQuery.refetch()
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: '审批失败', detail: readableError(error) }),
  })
  const cancelMutation = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: () =>
      setNotice({ tone: 'info', title: '正在停止', detail: '正在安全停下当前运行。' }),
    onError: (error) =>
      setNotice({ tone: 'error', title: '取消失败', detail: readableError(error) }),
  })
  useEffect(() => {
    const status = liveRunQuery.data?.run.status
    const currentRunId = liveRunQuery.data?.run.id
    if (!currentRunId || !status) {
      handledRunStateRef.current = null
      return
    }
    const runStateKey = `${currentRunId}:${status}`
    if (handledRunStateRef.current === runStateKey) return
    if (
      status === 'waiting-approval' &&
      runMode === 'test' &&
      waitingApprovalNode != null &&
      !approvalMutation.isPending
    ) {
      handledRunStateRef.current = runStateKey
      approvalMutation.mutate('approved')
      return
    }
    if (status === 'completed') {
      handledRunStateRef.current = runStateKey
      if (runMode === 'test') {
        setTestState('passed')
        setNotice({
          tone: 'success',
          title: '测试通过',
          detail: '测试通过。现在可以发布，或在右侧活动里查看这次运行的结果。',
        })
      } else {
        setNotice({
          tone: 'success',
          title: '流程已跑完',
          detail: '运行结果和输出已记在右侧活动里。',
        })
      }
      setRunMode(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    } else if (status === 'cancelled') {
      handledRunStateRef.current = runStateKey
      if (runMode === 'test') setTestState('cancelled')
      setInspectorTab('agent')
      setNotice({
        tone: 'info',
        title: runMode === 'test' ? '测试已停止' : '运行已停止',
        detail: '当前任务已经安全停止。',
      })
      setRunMode(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    } else if (status === 'failed') {
      handledRunStateRef.current = runStateKey
      if (runMode === 'test') setTestState('failed')
      setInspectorTab('agent')
      setNotice({
        tone: 'error',
        title: runMode === 'test' ? '测试未通过' : '运行失败',
        detail: '这次运行没有完成，可以查看右侧活动了解原因。',
      })
      setRunMode(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    }
  }, [
    approvalMutation,
    queryClient,
    runMode,
    liveRunQuery.data?.run.id,
    liveRunQuery.data?.run.status,
    waitingApprovalNode,
  ])

  const publishMutation = useMutation({
    mutationFn: () => api.publish(draft!, candidateCfs),
    onSuccess: (plan) => {
      setTestState('published')
      setCandidateCfs([])
      setDirty(false)
      setNotice({
        tone: 'success',
        title: '流程已发布',
        detail: `版本 v${plan.flowVersion} 已锁定，之后可以随时运行。`,
      })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: '发布失败', detail: readableError(error) }),
  })

  const settingsMutation = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => {
      setNotice({ tone: 'success', title: '设置已保存', detail: '新的工作台设置已生效。' })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: '设置保存失败', detail: readableError(error) }),
  })
  const runtimeMutation = useMutation({
    mutationFn: api.testRuntime,
    onMutate: (id) => setTestingRuntimeId(id),
    onSettled: () => {
      setTestingRuntimeId(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
  })

  const currentDrafts = useMemo(() => {
    const drafts = [...(data?.flowDrafts ?? [])]
    if (draft && !drafts.some((item) => item.flowId === draft.flowId)) drafts.unshift(draft)
    return drafts.map((item) => (draft?.flowId === item.flowId ? draft : item))
  }, [data?.flowDrafts, draft])
  const latestPlan = useMemo(
    () =>
      (data?.plans ?? [])
        .filter((plan) => plan.flowId === draft?.flowId)
        .sort((a, b) => Number.parseInt(b.flowVersion, 10) - Number.parseInt(a.flowVersion, 10))[0],
    [data?.plans, draft?.flowId],
  )
  const saveStatus = draftSaveStatus({
    isPending: saveMutation.isPending,
    isError: saveMutation.isError,
    dirty,
  })
  const stopControl = runStopControl(runMode, runId)
  const cancellationRequested =
    cancelMutation.isPending || (cancelMutation.isSuccess && cancelMutation.variables === runId)

  const updateDraft = (next: FlowDraft) => {
    setDraft(next)
    setDirty(true)
    setTestState('idle')
    if (!runMode) setRunId(null)
    setPreview(null)
    setPreviewError(null)
  }
  const updateCandidateCf = (next: CFDraft) => {
    setCandidateCfs((current) => {
      const index = current.findIndex((item) => item.cfId === next.cfId)
      if (index < 0) return [...current, next]
      return current.map((item, itemIndex) => (itemIndex === index ? next : item))
    })
  }

  const openCompiler = () => {
    if (!draft) return
    setView('compiler')
    if (!preview && !compileMutation.isPending) compileMutation.mutate()
  }

  const newFlow = () => {
    if (draft && dirty && !window.confirm('当前流程还没保存。确定要新建吗？未保存的修改会丢失。'))
      return
    setDraft(null)
    setCandidateCfs([])
    setPositions({})
    setMessages([])
    setAgentMessages([])
    setGoal('')
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setDirty(false)
    setTestState('idle')
    setRunId(null)
    setRunMode(null)
    setInspectedRunId(null)
    setInspectorTab('details')
    setPreview(null)
    setView('chat')
    setSettingsOpen(false)
    localStorage.removeItem(workspaceKey)
  }

  const deleteDraft = (target: FlowDraft) => {
    if (
      !window.confirm(
        `确定删除草稿「${target.name}」吗？这只会删除未发布草稿，不会删除已发布版本。`,
      )
    )
      return
    if (draft?.flowId === target.flowId) {
      setDraft(null)
      setCandidateCfs([])
      setPositions({})
      setMessages([])
      setAgentMessages([])
      setGoal('')
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setDirty(false)
      setTestState('idle')
      setRunId(null)
      setRunMode(null)
      setInspectedRunId(null)
      setInspectorTab('details')
      setPreview(null)
      setPreviewError(null)
      setView('chat')
      localStorage.removeItem(workspaceKey)
    }
    deleteDraftMutation.mutate(target.flowId)
  }

  const selectDraft = (next: FlowDraft) => {
    setSettingsOpen(false)
    setDraft(structuredClone(next))
    setAgentMessages([])
    setCandidateCfs(
      (data?.cfDrafts ?? []).filter((cf) =>
        next.nodes.some(
          (node) =>
            node.kind === 'cf-call' &&
            node.cfRef.cfId === cf.cfId &&
            !(data?.cfs ?? []).some(
              (version) =>
                version.cfId === node.cfRef.cfId && version.version === node.cfRef.version,
            ),
        ),
      ),
    )
    setPositions({})
    setDirty(false)
    setTestState('idle')
    setRunId(null)
    setRunMode(null)
    setInspectedRunId(null)
    setInspectorTab('details')
    setPreview(null)
    setView('canvas')
  }
  const selectPlan = (plan: FlowPlan) => {
    setSettingsOpen(false)
    setDraft(planToDraft(plan))
    setAgentMessages([])
    setCandidateCfs([])
    setPositions({})
    setDirty(false)
    setTestState('published')
    setRunId(null)
    setRunMode(null)
    setInspectedRunId(null)
    setInspectorTab('details')
    setPreview({
      plan,
      programs: (data?.cfs ?? []).filter((cf) =>
        plan.nodes.some(
          (node) =>
            node.kind === 'cf-call' &&
            node.cfRef.cfId === cf.cfId &&
            node.cfRef.version === cf.version,
        ),
      ),
    })
    setView('canvas')
  }

  const addNode = (node: FlowNode) => {
    if (!draft) return
    updateDraft({ ...draft, revision: draft.revision + 1, nodes: [...draft.nodes, node] })
    setSelectedEdgeId(null)
    setSelectedNodeId(node.id)
  }
  const addCapabilityNode = () => {
    const cfId = uniqueId('cf')
    setCandidateCfs((current) => [
      ...current,
      {
        cfId,
        revision: 1,
        name: '',
        does: '',
        input: '',
        output: '',
        process: '',
        defaultExecutor: runtimeId,
      },
    ])
    addNode({
      id: uniqueId('step'),
      kind: 'cf-call',
      cfRef: { cfId, version: '1.0.0' },
      executor: runtimeId,
    })
  }

  const submitGoal = (event: React.FormEvent) => {
    event.preventDefault()
    const objective = goal.trim()
    if (!objective) return
    setMessages((current) => [
      ...current,
      { id: uniqueId('message'), role: 'user', body: objective },
    ])
    setGoal('')
    proposalMutation.mutate({ objective, runtime: runtimeId })
  }

  const applyAgentAction = (action: AgentChatAction) => {
    if (action.type === 'open-activity') {
      setInspectorTab('activity')
      return
    }
    if (action.type === 'select-node') {
      if (!action.nodeId) return
      setSelectedEdgeId(null)
      setSelectedNodeId(action.nodeId)
      setView('canvas')
      return
    }
    if (action.type === 'update-binding') {
      const binding = action.binding
      if (!draft || !binding?.from || !binding.to) return
      if (testState === 'published') {
        setNotice({
          tone: 'error',
          title: '已发布版本不能修改',
          detail: '请从草稿开始调整，已发布版本会保持不变。',
        })
        return
      }
      const nodeIds = new Set(draft.nodes.map((node) => node.id))
      const rootOf = (value: string) => value.split('.')[0]
      const validFrom = binding.from.startsWith('$user.') || nodeIds.has(rootOf(binding.from))
      const validTo = nodeIds.has(rootOf(binding.to)) || rootOf(binding.to) === 'output'
      if (!validFrom || !validTo) {
        setNotice({
          tone: 'error',
          title: '绑定目标无效',
          detail: '助手建议的输入或输出字段不在当前流程中，请先让助手重新核对节点编号。',
        })
        return
      }
      const existing = (draft.bindings ?? []).find(
        (item) => item.id === binding.id || item.to === binding.to,
      )
      const nextBinding = {
        id: existing?.id ?? binding.id ?? uniqueId('binding'),
        from: binding.from,
        to: binding.to,
        ...(binding.required === undefined ? {} : { required: binding.required }),
      }
      updateDraft({
        ...draft,
        revision: draft.revision + 1,
        bindings: [
          ...(draft.bindings ?? []).filter(
            (item) => item.id !== existing?.id && item.to !== binding.to,
          ),
          nextBinding,
        ],
      })
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setView('canvas')
      setNotice({
        tone: 'success',
        title: '已应用输入输出绑定',
        detail: `已将 ${binding.from} 连接到 ${binding.to}，请重新检查并测试流程。`,
      })
      return
    }
    if (!draft || !action.nodeId) return
    const node = draft.nodes.find((item) => item.id === action.nodeId)
    if (!node || node.kind !== 'cf-call') return
    if (testState === 'published') {
      setNotice({
        tone: 'error',
        title: '已发布版本不能修改',
        detail: '请从草稿开始调整，已发布版本会保持不变。',
      })
      return
    }
    const nextPatch =
      action.type === 'retry-node'
        ? {
            onError: {
              action: 'retry' as const,
              maxAttempts:
                node.onError?.action === 'retry'
                  ? Math.max(2, (node.onError.maxAttempts ?? 1) + 1)
                  : 2,
            },
          }
        : action.patch
    if (!nextPatch) return
    if (nextPatch.executor) {
      const runtime = (data?.runtimes ?? []).find((item) => item.id === nextPatch.executor)
      if (!runtime || !runtime.enabled || runtime.health?.status !== 'available') {
        setNotice({
          tone: 'error',
          title: '执行器不可用',
          detail: '助手建议的执行器当前不可用，请先在设置中检查 Runtime。',
        })
        return
      }
    }
    const nextNode = { ...node, ...nextPatch }
    updateDraft({
      ...draft,
      revision: draft.revision + 1,
      nodes: draft.nodes.map((item) => (item.id === node.id ? nextNode : item)),
    })
    setSelectedEdgeId(null)
    setSelectedNodeId(node.id)
    setView('canvas')
    setNotice({
      tone: 'success',
      title: '已应用助手建议',
      detail:
        nextPatch.onError?.action === 'retry'
          ? `「${node.id}」失败时将最多重试 ${nextPatch.onError.maxAttempts ?? 2} 次，请重新检查并测试流程。`
          : nextPatch.executor
            ? `「${node.id}」将改由 ${nextPatch.executor} 执行，请重新检查并测试流程。`
            : `已更新「${node.id}」的流程配置，请重新检查并测试。`,
    })
  }

  if (bootstrap.isPending && !data)
    return (
      <div className="boot-screen">
        <span className="brand-mark">CF</span>
        <LoaderCircle className="spin" size={20} />
        <p>正在连接本地工作台…</p>
      </div>
    )
  if (bootstrap.isError && !data)
    return (
      <div className="boot-screen error">
        <strong>无法打开工作台</strong>
        <p>{readableError(bootstrap.error)}</p>
        <button className="button" onClick={() => bootstrap.refetch()}>
          重试
        </button>
      </div>
    )

  const runtimes = data?.runtimes ?? []
  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId)

  return (
    <div
      className={`app-shell${leftCollapsed ? ' left-collapsed' : ''}${rightCollapsed ? ' right-collapsed' : ''}${settingsOpen ? ' settings-open' : ''}`}
    >
      <FlowSidebar
        collapsed={leftCollapsed}
        currentFlowId={draft?.flowId ?? null}
        drafts={currentDrafts}
        plans={data?.plans ?? []}
        isRefreshing={bootstrap.isFetching}
        onToggle={() => setLeftCollapsed((value) => !value)}
        onNew={newFlow}
        onSelectDraft={selectDraft}
        onSelectPlan={selectPlan}
        onDeleteDraft={deleteDraft}
        deletingDraftId={deleteDraftMutation.variables ?? null}
        onRefresh={() => bootstrap.refetch()}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-title">
            <span className={`route-state is-${testState}`} />
            <div>
              <h1>{draft?.name ?? '未命名流程'}</h1>
              <p>
                {draft
                  ? `第 ${draft.revision} 稿 · ${draft.nodes.length} 个步骤 · ${testStateLabel(testState)}`
                  : '先写下你想完成的事'}
              </p>
            </div>
          </div>
          <nav className="view-tabs" aria-label="工作区视图">
            <button
              type="button"
              className={view === 'chat' ? 'is-active' : ''}
              onClick={() => setView('chat')}
            >
              <MessageSquareText size={15} />
              目标
            </button>
            <button
              type="button"
              className={view === 'canvas' ? 'is-active' : ''}
              onClick={() => draft && setView('canvas')}
              disabled={!draft}
            >
              <GitBranch size={15} />
              画布
            </button>
            <button
              type="button"
              className={view === 'compiler' ? 'is-active' : ''}
              onClick={openCompiler}
              disabled={!draft}
            >
              <ListChecks size={15} />
              检查 DSL
            </button>
          </nav>
          <div className="workspace-actions">
            {saveStatus && (
              <span
                className={`save-state${dirty ? ' is-dirty' : ''}${saveMutation.isError ? ' is-error' : ''}`}
              >
                {saveMutation.isPending ? (
                  <LoaderCircle className="spin" size={13} />
                ) : (
                  <Save size={13} />
                )}
                {saveStatus}
              </span>
            )}
            {runMode === 'test' && stopControl ? (
              <button
                className="button danger"
                type="button"
                disabled={stopControl.disabled || cancellationRequested}
                onClick={() => runId && cancelMutation.mutate(runId)}
              >
                <CircleStop size={15} />
                {cancellationRequested ? '正在停止' : stopControl.label}
              </button>
            ) : (
              <button
                className="button"
                type="button"
                disabled={!draft || isRunning || testMutation.isPending}
                title="会自动编译成 DSL 并保存后再测试"
                onClick={() => testMutation.mutate()}
              >
                <CirclePlay size={15} />
                测试
              </button>
            )}
            {runMode === 'live' && stopControl ? (
              <button
                className="button danger"
                type="button"
                disabled={stopControl.disabled || cancellationRequested}
                onClick={() => runId && cancelMutation.mutate(runId)}
              >
                <CircleStop size={15} />
                {cancellationRequested ? '正在停止' : stopControl.label}
              </button>
            ) : (
              <button
                className="button"
                type="button"
                disabled={!latestPlan || isRunning || liveRunMutation.isPending}
                onClick={() => {
                  if (!latestPlan) return
                  const writes = latestPlan.nodes.some((node) => {
                    if (node.kind !== 'cf-call') return false
                    const capability = ([...(data?.cfs ?? []), ...candidateCfs] as any[]).find(
                      (cf: any) =>
                        cf.cfId === node.cfRef.cfId &&
                        `${cf.revision ?? cf.draft?.revision}.0.0` === node.cfRef.version,
                    )
                    return (
                      (capability as any)?.effects?.some(
                        (effect: any) => effect.type === 'file-write',
                      ) ||
                      (capability as any)?.draft?.effects?.some(
                        (effect: any) => effect.type === 'file-write',
                      )
                    )
                  })
                  if (
                    writes &&
                    !window.confirm(
                      '这条流程会修改工作区内的文件。修改范围：用户工作区。继续运行吗？',
                    )
                  )
                    return
                  liveRunMutation.mutate(latestPlan)
                }}
              >
                <CirclePlay size={15} />
                运行已发布版本
              </button>
            )}
            <button
              className="button publish"
              type="button"
              disabled={!draft || testState !== 'passed' || publishMutation.isPending}
              onClick={() =>
                window.confirm('发布后，当前流程会被锁定，不能再修改。确定发布吗？') &&
                publishMutation.mutate()
              }
            >
              <Upload size={15} />
              发布
            </button>
            <button
              className="icon-button"
              type="button"
              title={rightCollapsed ? '展开详情' : '收起详情'}
              onClick={() => setRightCollapsed((value) => !value)}
            >
              {rightCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </button>
          </div>
        </header>
        {notice && (
          <div className={`operation-notice ${notice.tone}`} role="status">
            <span className="status-lamp" />
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.detail}</p>
            </div>
            <button type="button" aria-label="关闭通知" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}
        {runMode === 'live' &&
          liveRunQuery.data?.run.status === 'waiting-approval' &&
          waitingApprovalNode != null && (
            <div className="approval-notice" role="status">
              <span className="status-lamp" />
              <div>
                <strong>运行需要你确认</strong>
                <p>有一个步骤正在等待批准。通过后流程会继续，拒绝后会按拒绝线路走。</p>
              </div>
              <div>
                <button
                  className="button publish"
                  type="button"
                  disabled={approvalMutation.isPending}
                  onClick={() => approvalMutation.mutate('approved')}
                >
                  批准继续
                </button>
                <button
                  className="button danger"
                  type="button"
                  disabled={approvalMutation.isPending}
                  onClick={() => approvalMutation.mutate('rejected')}
                >
                  拒绝
                </button>
              </div>
            </div>
          )}
        <div className={`workspace-body${draft ? ' has-canvas' : ''}`}>
          {view === 'chat' && (
            <section className="conversation-view">
              <div className="conversation-scroll">
                {!messages.length && (
                  <div className="conversation-intro">
                    <div className="signal-emblem">
                      <Split size={24} />
                    </div>
                    <span className="view-kicker">从一句话开始</span>
                    <h2>先说你想完成什么</h2>
                    <p>
                      本机助手会把目标拆成可调整的步骤。你在画布上改好后，再检查、测试，最后发布。
                    </p>
                  </div>
                )}
                <div className="messages">
                  {messages.map((message) => (
                    <article className={`message is-${message.role}`} key={message.id}>
                      <span className="message-avatar">
                        {message.role === 'user' ? '你' : 'CF'}
                      </span>
                      <div>
                        <strong>{message.role === 'user' ? '目标' : '助手'}</strong>
                        <p>{message.body}</p>
                        {message.meta && <small>{message.meta}</small>}
                      </div>
                    </article>
                  ))}
                  {proposalMutation.isPending && (
                    <article className="message is-assistant">
                      <span className="message-avatar">CF</span>
                      <div>
                        <strong>助手</strong>
                        <p className="thinking">
                          <LoaderCircle className="spin" size={14} />
                          正在根据你的目标挑选步骤…
                        </p>
                      </div>
                    </article>
                  )}
                </div>
              </div>
              <form className="goal-composer" onSubmit={submitGoal}>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  placeholder="例如：审核代码变更，运行测试，整理风险，并在合并前请人确认"
                  aria-label="你想完成的目标"
                />
                <div className="composer-footer">
                  <label
                    className={`runtime-select is-${selectedRuntime ? runtimeStatus(selectedRuntime) : 'checking'}`}
                  >
                    <span className="status-lamp" />
                    <select
                      value={runtimeId}
                      onChange={(event) => setRuntimeId(event.target.value)}
                    >
                      {runtimes.map((runtime) => (
                        <option
                          key={runtime.id}
                          value={runtime.id}
                          disabled={runtimeStatus(runtime) !== 'available'}
                        >
                          {runtime.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    {selectedRuntime?.health?.status === 'available'
                      ? `${selectedRuntime.name} 可以使用`
                      : '请选择一个可用的助手'}
                  </span>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={!goal.trim() || proposalMutation.isPending}
                    aria-label="根据目标生成流程"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </form>
            </section>
          )}
          {draft && (
            <section className={`canvas-view${view === 'canvas' ? '' : ' is-idle'}`}>
              <div className="canvas-toolbar">
                <button
                  type="button"
                  className={`button${libraryOpen ? ' is-active' : ''}`}
                  onClick={() => setLibraryOpen((value) => !value)}
                  title={libraryOpen ? '收起能力库' : '展开能力库'}
                >
                  <Library size={15} />
                  能力库{' '}
                  <span className="count">{(data?.cfs.length ?? 0) + candidateCfs.length}</span>
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={addCapabilityNode}
                  title="添加空能力节点"
                >
                  <Workflow size={15} />
                  能力
                </button>
                <span className="toolbar-divider" />
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    addNode({ id: uniqueId('approval'), kind: 'approval', policyRef: 'manual' })
                  }
                >
                  <ShieldCheck size={15} />
                  审批
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    addNode({
                      id: uniqueId('branch'),
                      kind: 'branch',
                      cond: { $get: 'route' },
                      cases: ['case-1', 'case-2'],
                      caseConditions: {
                        'case-1': '',
                        'case-2': '',
                      },
                    })
                  }
                >
                  <GitBranch size={15} />
                  分支
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => addNode({ id: uniqueId('join'), kind: 'join', mode: 'all' })}
                >
                  <GitMerge size={15} />
                  汇合
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    addNode({ id: uniqueId('output'), kind: 'output', outputId: 'result' })
                  }
                >
                  <Plus size={15} />
                  输出
                </button>
                <span className="canvas-help">从圆点拖出连线；选中后可改接，或按 Delete 删除</span>
              </div>
              <div className="canvas-workspace">
                <CapabilityLibrary
                  published={data?.cfs ?? []}
                  candidates={candidateCfs}
                  open={libraryOpen}
                  onToggle={() => setLibraryOpen((value) => !value)}
                  onAddPublished={(version) =>
                    addNode({
                      id: uniqueId('step'),
                      kind: 'cf-call',
                      cfRef: { cfId: version.cfId, version: version.version },
                      executor: version.draft.defaultExecutor,
                    })
                  }
                  onAddCandidate={(cf) =>
                    addNode({
                      id: uniqueId('step'),
                      kind: 'cf-call',
                      cfRef: { cfId: cf.cfId, version: '1.0.0' },
                      executor: cf.defaultExecutor,
                    })
                  }
                />
                <FlowCanvas
                  draft={draft}
                  positions={positions}
                  cfs={data?.cfs ?? []}
                  candidateCfs={candidateCfs}
                  flowState={testState === 'published' ? 'published' : 'draft'}
                  nodeRunStates={nodeRunStateRecord}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onDraftChange={updateDraft}
                  onPositionsChange={setPositions}
                  onSelectNode={setSelectedNodeId}
                  onSelectEdge={setSelectedEdgeId}
                />
              </div>
            </section>
          )}
          {view === 'compiler' && draft && (
            <CompilerPreviewView
              draft={draft}
              preview={preview}
              error={previewError}
              isPending={compileMutation.isPending}
              runtimes={data?.runtimes ?? []}
              runtimeId={compileRuntimeId}
              onRuntimeChange={(id) => {
                setCompileRuntimeId(id)
                setPreview(null)
                setPreviewError(null)
              }}
              onCompile={() => compileMutation.mutate()}
            />
          )}
        </div>
      </main>
      <aside className={`inspector${rightCollapsed ? ' is-collapsed' : ''}`} aria-label="详情">
        {rightCollapsed ? (
          <button
            className="inspector-rail-button"
            type="button"
            onClick={() => setRightCollapsed(false)}
            title="展开详情"
          >
            <ChevronLeft size={16} />
            <span>详情</span>
          </button>
        ) : (
          <>
            <button
              className="inspector-collapse"
              type="button"
              title="收起详情"
              onClick={() => setRightCollapsed(true)}
            >
              <ChevronRight size={16} />
            </button>
            <Inspector
              draft={draft}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              runs={data?.runs ?? []}
              runDetail={viewedRun}
              selectedRunId={inspectedRunId}
              preview={preview}
              cfs={data?.cfs ?? []}
              candidateCfs={candidateCfs}
              runtimes={data?.runtimes ?? []}
              tab={inspectorTab}
              agentMessages={agentMessages}
              runtimeId={runtimeId}
              onDraftChange={updateDraft}
              onCandidateCfChange={updateCandidateCf}
              onTabChange={setInspectorTab}
              onAgentMessagesChange={setAgentMessages}
              onApplyAgentAction={applyAgentAction}
              onSelectNode={setSelectedNodeId}
              onSelectEdge={setSelectedEdgeId}
              onSelectRun={(id) => {
                setInspectedRunId(id)
                setInspectorTab('activity')
              }}
              onOpenCompiler={openCompiler}
            />
          </>
        )}
      </aside>
      {settingsOpen && data && (
        <div className="settings-layer">
          <SettingsView
            settings={data.settings}
            runtimes={data.runtimes}
            isSaving={settingsMutation.isPending}
            testingRuntimeId={testingRuntimeId}
            onSave={(settings) => settingsMutation.mutate(settings)}
            onTestRuntime={(id) => runtimeMutation.mutate(id)}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
