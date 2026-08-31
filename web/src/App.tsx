import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CirclePlay,
  CircleStop,
  GitBranch,
  GitMerge,
  Library,
  ListChecks,
  LoaderCircle,
  Plus,
  ScrollText,
  ShieldCheck,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import { api, readableError } from './api'
import { BottomDrawer } from './components/BottomDrawer'
import { CapabilityLibrary } from './components/CapabilityLibrary'
import { CheckPanel } from './components/CheckPanel'
import { DetailPanel } from './components/DetailPanel'
import { DirectoryPicker } from './components/DirectoryPicker'
import { FlowAgentChat } from './components/FlowAgentChat'
import { FlowCanvas } from './components/FlowCanvas'
import { GoalComposer } from './components/GoalComposer'
import { RunLogPanel } from './components/RunLogPanel'
import { SettingsView } from './components/SettingsView'
import { TopBar } from './components/TopBar'
import type { FlowListRow } from './flow-list'
import { deriveNodeRunStates, type NodeRunState } from './run'
import {
  draftSaveStatus,
  mergeAttachments,
  nextSignalAction,
  runStopControl,
  type DrawerTab,
  type TestState,
} from './workbench-ui'
import type {
  CanvasPosition,
  CFDraft,
  CompilationPreview,
  RunDetail,
  FlowDraft,
  FlowNode,
  FlowPlan,
  AgentChatMessage,
  BootstrapData,
} from './types'

const workspaceKey = 'cf-platform-react-workbench-v2'
const legacyWorkspaceKeys = ['cf-platform-react-workbench-v1']

type StoredWorkspace = {
  version?: number
  draft?: FlowDraft | null
  positions?: Record<string, CanvasPosition>
  candidateCfs?: CFDraft[]
  conversation?: AgentChatMessage[]
  runId?: string | null
  runMode?: 'test' | 'live' | null
  inspectedRunId?: string | null
  drawerTab?: DrawerTab | null
  leftCollapsed?: boolean
  rightCollapsed?: boolean
}

type AgentUndo = {
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
  appliedFlowId: string
  appliedRevision: number
  messageId: string
}

function readStoredWorkspace(): StoredWorkspace {
  // v1 stored the goal transcript and the assistant transcript as two arrays
  // with no timestamps, so they cannot be interleaved faithfully. Rather than
  // invent an order, v2 starts clean; drafts are autosaved server-side.
  for (const key of legacyWorkspaceKeys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Private-mode storage can throw; nothing to recover here.
    }
  }
  try {
    const value = localStorage.getItem(workspaceKey)
    if (!value) return {}
    const parsed = JSON.parse(value) as StoredWorkspace
    return parsed?.version === 2 ? parsed : {}
  } catch {
    return {}
  }
}

const initialStoredWorkspace = readStoredWorkspace()

function planToDraft(plan: FlowPlan): FlowDraft {
  const idByIndex = new Map(plan.nodes.map((node) => [node.index, node.id]))
  return {
    flowId: plan.flowId,
    revision: Number.parseInt(plan.flowVersion, 10),
    name: plan.objective,
    objective: plan.objective,
    workspaceRoot: plan.workspaceRoot,
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

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function App() {
  const queryClient = useQueryClient()
  const stored = useRef(initialStoredWorkspace).current
  const supportedStoredDraft = stored.draft?.workspaceRoot ? stored.draft : undefined
  const [draft, setDraft] = useState<FlowDraft | null>(supportedStoredDraft ?? null)
  const [positions, setPositions] = useState<Record<string, CanvasPosition>>(stored.positions ?? {})
  const [candidateCfs, setCandidateCfs] = useState<CFDraft[]>(stored.candidateCfs ?? [])
  // One transcript: the goal turn is simply the first turn of the same chat.
  const [conversation, setConversation] = useState<AgentChatMessage[]>(stored.conversation ?? [])
  const [agentUndo, setAgentUndo] = useState<AgentUndo | null>(null)
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(stored.drawerTab ?? null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(stored.leftCollapsed ?? false)
  const [rightCollapsed, setRightCollapsed] = useState(stored.rightCollapsed ?? false)
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
  const [newWorkspaceRoot, setNewWorkspaceRoot] = useState<string | null>(
    supportedStoredDraft?.workspaceRoot ?? null,
  )
  const [skillAttachments, setSkillAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [runtimeId, setRuntimeId] = useState('')
  const [compileRuntimeId, setCompileRuntimeId] = useState('')
  const [testingRuntimeId, setTestingRuntimeId] = useState<string | null>(null)

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap })
  const data = bootstrap.data
  const workspaceStatus = useQuery({
    queryKey: ['workspace-status', draft?.workspaceRoot],
    queryFn: () => api.validateDirectory(draft!.workspaceRoot),
    enabled: Boolean(draft?.workspaceRoot),
    retry: false,
    refetchInterval: 10_000,
  })
  const workspaceAvailable = Boolean(draft?.workspaceRoot) && workspaceStatus.isSuccess
  const handledRunStateRef = useRef<string | null>(null)

  useEffect(() => {
    if (data?.settings.defaultRuntimeId && !runtimeId) setRuntimeId(data.settings.defaultRuntimeId)
  }, [data?.settings.defaultRuntimeId, runtimeId])
  useEffect(() => {
    if (data?.settings.defaultRuntimeId && !compileRuntimeId)
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
    try {
      localStorage.setItem(
        workspaceKey,
        JSON.stringify({
          version: 2,
          draft,
          positions,
          candidateCfs,
          conversation,
          runId,
          runMode,
          inspectedRunId,
          drawerTab,
          leftCollapsed,
          rightCollapsed,
        } satisfies StoredWorkspace),
      )
    } catch {
      // Storage can be unavailable (private mode, quota); the app still works.
    }
  }, [
    candidateCfs,
    conversation,
    draft,
    drawerTab,
    inspectedRunId,
    leftCollapsed,
    positions,
    rightCollapsed,
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

  const clearWorkspace = () => {
    setDraft(null)
    setCandidateCfs([])
    setPositions({})
    setConversation([])
    setAgentUndo(null)
    setGoal('')
    setNewWorkspaceRoot(null)
    setSkillAttachments([])
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setDirty(false)
    setTestState('idle')
    setRunId(null)
    setRunMode(null)
    setInspectedRunId(null)
    setDrawerTab(null)
    setPreview(null)
    setPreviewError(null)
    setSettingsOpen(false)
    localStorage.removeItem(workspaceKey)
  }

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
  const deletePlanMutation = useMutation({
    mutationFn: ({ flowId, flowVersion }: { flowId: string; flowVersion: string }) =>
      api.deletePublishedFlow(flowId, flowVersion),
    onSuccess: (_, target) => {
      queryClient.setQueryData<typeof data>(['bootstrap'], (current) =>
        current
          ? {
              ...current,
              plans: current.plans.filter(
                (item) =>
                  !(item.flowId === target.flowId && item.flowVersion === target.flowVersion),
              ),
            }
          : current,
      )
      if (
        testState === 'published' &&
        preview?.plan.flowId === target.flowId &&
        preview.plan.flowVersion === target.flowVersion
      )
        clearWorkspace()
      setNotice({
        tone: 'success',
        title: '已发布版本已删除',
        detail: `版本 v${target.flowVersion} 已从工作台移除。`,
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
      // 检查视图已经内联显示这条错误，顶部横幅只在别的视图里补充提示。
      if (drawerTab !== 'check') setNotice({ tone: 'error', title: '检查未通过', detail })
    },
  })
  const isRunning = Boolean(runMode)

  const proposalMutation = useMutation({
    mutationFn: ({
      objective,
      runtime,
      workspaceRoot,
      attachments,
    }: {
      objective: string
      runtime: string
      workspaceRoot: string
      attachments: File[]
    }) => api.propose(objective, runtime, workspaceRoot, attachments),
    onSuccess: (proposal, variables) => {
      if (!proposal.flowDraft) {
        setConversation((current) => [
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
      setNewWorkspaceRoot(proposal.flowDraft.workspaceRoot)
      setCandidateCfs(proposal.cfDrafts ?? [])
      setAgentUndo(null)
      setSkillAttachments([])
      setPositions({})
      setConversation((current) => [
        ...current,
        {
          id: uniqueId('message'),
          role: 'assistant',
          body: proposal.attachmentSummary
            ? `${proposal.assistantMessage ?? '已经生成一份可以调整的流程草案。'} 已只读分析 ${proposal.attachmentSummary.fileCount} 个附件${proposal.attachmentSummary.skippedCount ? `，跳过 ${proposal.attachmentSummary.skippedCount} 个不支持的文件` : ''}，并归档到 ${proposal.attachmentSummary.archivePath}。`
            : (proposal.assistantMessage ?? '已经生成一份可以调整的流程草案。'),
          meta: variables.runtime,
        },
      ])
      setDirty(true)
      setTestState('idle')
      setPreview(null)
    },
    onError: (error) => {
      const detail = readableError(error)
      setConversation((current) => [
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
      setNotice({
        tone: 'error',
        title: runMode === 'test' ? '测试未通过' : '运行失败',
        detail: '这次运行没有完成。打开画布下方的「日志」可以按步骤查看原因。',
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
  const runtimeDiscoveryMutation = useMutation({
    mutationFn: api.discoverRuntimes,
    onSuccess: (result) => {
      queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) =>
        current
          ? {
              ...current,
              runtimes: result.runtimes,
              runtimeDiscoveryWarnings: result.warnings,
            }
          : current,
      )
      setNotice({
        tone: 'success',
        title: '识别完成',
        detail: `发现 ${result.runtimes.filter((runtime) => runtime.health?.status === 'available').length} 个可用助手${result.warnings.length ? `，跳过 ${result.warnings.length} 个无效 manifest` : ''}。`,
      })
    },
    onError: (error) =>
      setNotice({ tone: 'error', title: '识别失败', detail: readableError(error) }),
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

  const openCheck = () => {
    if (!draft) return
    setDrawerTab('check')
    if (!preview && !compileMutation.isPending) compileMutation.mutate()
  }

  const newFlow = () => {
    if (draft && dirty && !window.confirm('当前流程还没保存。确定要新建吗？未保存的修改会丢失。'))
      return
    clearWorkspace()
  }

  const deleteDraft = (target: FlowDraft) => {
    if (
      !window.confirm(
        `确定删除草稿「${target.name}」吗？这只会删除未发布草稿，不会删除已发布版本。`,
      )
    )
      return
    if (draft?.flowId === target.flowId) {
      clearWorkspace()
    }
    deleteDraftMutation.mutate(target.flowId)
  }

  const deletePlan = (target: FlowPlan) => {
    if (!window.confirm(`确定删除已发布版本 v${target.flowVersion}「${target.objective}」吗？`))
      return
    deletePlanMutation.mutate({ flowId: target.flowId, flowVersion: target.flowVersion })
  }

  const selectDraft = (next: FlowDraft) => {
    setSettingsOpen(false)
    setDraft(structuredClone(next))
    setNewWorkspaceRoot(next.workspaceRoot)
    setConversation([])
    setAgentUndo(null)
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
    setDrawerTab(null)
    setPreview(null)
  }
  const selectPlan = (plan: FlowPlan) => {
    setSettingsOpen(false)
    setDraft(planToDraft(plan))
    setNewWorkspaceRoot(plan.workspaceRoot)
    setConversation([])
    setAgentUndo(null)
    setCandidateCfs([])
    setPositions({})
    setDirty(false)
    setTestState('published')
    setRunId(null)
    setRunMode(null)
    setInspectedRunId(null)
    setDrawerTab(null)
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
    setDrawerTab(null)
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

  const submitGoal = () => {
    const objective = goal.trim()
    if (!objective || !newWorkspaceRoot) return
    setConversation((current) => [
      ...current,
      { id: uniqueId('message'), role: 'user', body: objective },
    ])
    setGoal('')
    proposalMutation.mutate({
      objective,
      runtime: runtimeId,
      workspaceRoot: newWorkspaceRoot,
      attachments: skillAttachments,
    })
  }

  const undoAgentRevision = () => {
    if (
      !agentUndo ||
      draft?.flowId !== agentUndo.appliedFlowId ||
      draft.revision !== agentUndo.appliedRevision
    )
      return
    updateDraft(structuredClone(agentUndo.flowDraft))
    setCandidateCfs(structuredClone(agentUndo.cfDrafts))
    setAgentUndo(null)
    setConversation((current) => [
      ...current,
      {
        id: uniqueId('message'),
        role: 'assistant',
        body: '已撤销上次助手修改，当前草稿已恢复到修改前。',
        meta: '当前草稿',
      },
    ])
    setNotice({
      tone: 'success',
      title: '已撤销助手修改',
      detail: '画布和候选能力已恢复到上一次助手修订前。',
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
  const signal = nextSignalAction({
    hasDraft: Boolean(draft),
    workspaceAvailable,
    isRunning,
    hasPreview: Boolean(preview),
    testState,
    hasPublishedPlan: Boolean(latestPlan),
  })
  const deletingKey = deleteDraftMutation.variables
    ? deleteDraftMutation.variables
    : deletePlanMutation.variables
      ? `${deletePlanMutation.variables.flowId}@${deletePlanMutation.variables.flowVersion}`
      : null

  const selectFlowRow = (row: FlowListRow) => {
    if (row.kind === 'draft') {
      const target = currentDrafts.find((item) => item.flowId === row.flowId)
      if (target) selectDraft(target)
      return
    }
    const target = (data?.plans ?? []).find(
      (plan) => plan.flowId === row.flowId && plan.flowVersion === row.flowVersion,
    )
    if (target) selectPlan(target)
  }
  const deleteFlowRow = (row: FlowListRow) => {
    if (row.kind === 'draft') {
      const target = currentDrafts.find((item) => item.flowId === row.flowId)
      if (target) deleteDraft(target)
      return
    }
    const target = (data?.plans ?? []).find(
      (plan) => plan.flowId === row.flowId && plan.flowVersion === row.flowVersion,
    )
    if (target) deletePlan(target)
  }

  const runLive = () => {
    if (!latestPlan) return
    const writes = latestPlan.nodes.some((node) => {
      if (node.kind !== 'cf-call') return false
      const capability = ([...(data?.cfs ?? []), ...candidateCfs] as any[]).find(
        (cf: any) =>
          cf.cfId === node.cfRef.cfId &&
          `${cf.revision ?? cf.draft?.revision}.0.0` === node.cfRef.version,
      )
      return (
        capability?.effects?.some((effect: any) => effect.type === 'file-write') ||
        capability?.draft?.effects?.some((effect: any) => effect.type === 'file-write')
      )
    })
    if (
      writes &&
      !window.confirm('这条流程会修改工作区内的文件。修改范围：用户工作区。继续运行吗？')
    )
      return
    liveRunMutation.mutate(latestPlan)
  }

  return (
    <div className={`app-frame${settingsOpen ? ' settings-open' : ''}`}>
      <TopBar
        drafts={currentDrafts}
        plans={data?.plans ?? []}
        draft={draft}
        testState={testState}
        saveStatus={saveStatus}
        isSaving={saveMutation.isPending}
        saveFailed={saveMutation.isError}
        isRefreshing={bootstrap.isFetching}
        deletingKey={deletingKey}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onSelectFlow={selectFlowRow}
        onDeleteFlow={deleteFlowRow}
        onNewFlow={newFlow}
        onRefresh={() => bootstrap.refetch()}
        onSettings={() => setSettingsOpen(true)}
        onToggleLeft={() => setLeftCollapsed((value) => !value)}
        onToggleRight={() => setRightCollapsed((value) => !value)}
      />

      <div className="notice-stack">
        {notice && (
          <div className={`operation-notice ${notice.tone}`} role="status">
            <span className="status-lamp" />
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.detail}</p>
            </div>
            <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        )}
        {draft && workspaceStatus.isError && (
          <div className="workspace-unavailable-notice" role="alert">
            <span className="status-lamp" />
            <div>
              <strong>工作目录当前不可用</strong>
              <p>请恢复原路径及读写权限。草稿仍可编辑保存，但助手、测试、发布和运行已暂停。</p>
            </div>
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
                  className="button signal"
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
      </div>

      <div
        className={`workbench${leftCollapsed ? ' left-collapsed' : ''}${rightCollapsed ? ' right-collapsed' : ''}${draft ? '' : ' is-empty'}`}
      >
        {draft && (
          <aside className="detail-panel" aria-label="详情">
            {leftCollapsed ? (
              <button
                className="panel-rail"
                type="button"
                onClick={() => setLeftCollapsed(false)}
                aria-label="展开详情"
                title="展开详情"
              >
                <span>详情</span>
              </button>
            ) : (
              <DetailPanel
                draft={draft}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                preview={preview}
                cfs={data?.cfs ?? []}
                candidateCfs={candidateCfs}
                runtimes={runtimes}
                workspaceAvailable={workspaceAvailable}
                onDraftChange={updateDraft}
                onCandidateCfChange={updateCandidateCf}
                onSelectNode={setSelectedNodeId}
                onSelectEdge={setSelectedEdgeId}
                onOpenCheck={openCheck}
              />
            )}
          </aside>
        )}

        <main className="center-column">
          {!draft ? (
            !newWorkspaceRoot ? (
              <DirectoryPicker onConfirm={setNewWorkspaceRoot} />
            ) : (
              <GoalComposer
                messages={conversation}
                isPending={proposalMutation.isPending}
                goal={goal}
                attachments={skillAttachments}
                runtimes={runtimes}
                runtimeId={runtimeId}
                canSubmit={Boolean(goal.trim() && newWorkspaceRoot)}
                onGoalChange={setGoal}
                onAttachmentsChange={setSkillAttachments}
                onRuntimeChange={setRuntimeId}
                onSubmit={submitGoal}
              />
            )
          ) : (
            <>
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
                  title="添加一个空步骤"
                >
                  <Workflow size={15} />
                  能力
                </button>
                <span className="toolbar-divider" />
                <button
                  type="button"
                  onClick={() =>
                    addNode({ id: uniqueId('approval'), kind: 'approval', policyRef: 'manual' })
                  }
                  className="button is-icon"
                  title="添加审批步骤"
                  aria-label="添加审批步骤"
                >
                  <ShieldCheck size={15} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addNode({
                      id: uniqueId('branch'),
                      kind: 'branch',
                      cond: { $get: 'route' },
                      cases: ['case-1', 'case-2'],
                      caseConditions: { 'case-1': '', 'case-2': '' },
                    })
                  }
                  className="button is-icon"
                  title="添加分支步骤"
                  aria-label="添加分支步骤"
                >
                  <GitBranch size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => addNode({ id: uniqueId('join'), kind: 'join', mode: 'all' })}
                  className="button is-icon"
                  title="添加汇合步骤"
                  aria-label="添加汇合步骤"
                >
                  <GitMerge size={15} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addNode({ id: uniqueId('output'), kind: 'output', outputId: 'result' })
                  }
                  className="button is-icon"
                  title="添加输出步骤"
                  aria-label="添加输出步骤"
                >
                  <Plus size={15} />
                </button>
                <span className="toolbar-spacer" />
                <button
                  className={`button${drawerTab === 'log' ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setDrawerTab(drawerTab === 'log' ? null : 'log')}
                  title="按步骤查看这次运行发生了什么"
                >
                  <ScrollText size={15} />
                  日志
                </button>
                <button
                  className={`button${signal === 'check' && drawerTab !== 'check' ? ' signal' : ''}${
                    drawerTab === 'check' ? ' is-active' : ''
                  }`}
                  type="button"
                  onClick={openCheck}
                >
                  <ListChecks size={15} />
                  检查
                </button>
                <span className="toolbar-divider" />
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
                    className={`button${signal === 'test' ? ' signal' : ''}`}
                    type="button"
                    disabled={!workspaceAvailable || isRunning || testMutation.isPending}
                    title="会先检查并保存流程，再试运行一次"
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
                    className={`button${signal === 'run' ? ' signal' : ''}`}
                    type="button"
                    disabled={
                      !latestPlan || !workspaceAvailable || isRunning || liveRunMutation.isPending
                    }
                    onClick={runLive}
                  >
                    <CirclePlay size={15} />
                    运行
                  </button>
                )}
                <button
                  className={`button publish${signal === 'publish' ? ' signal' : ''}`}
                  type="button"
                  disabled={
                    !workspaceAvailable || testState !== 'passed' || publishMutation.isPending
                  }
                  onClick={() =>
                    window.confirm('发布后，当前流程会被锁定，不能再修改。确定发布吗？') &&
                    publishMutation.mutate()
                  }
                >
                  <Upload size={15} />
                  发布
                </button>
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
                  key={draft.flowId}
                  compact={Boolean(drawerTab)}
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

              {drawerTab && (
                <BottomDrawer
                  tab={drawerTab}
                  onTabChange={(tab) => {
                    setDrawerTab(tab)
                    if (tab === 'check' && !preview && !compileMutation.isPending)
                      compileMutation.mutate()
                  }}
                  onClose={() => setDrawerTab(null)}
                >
                  {drawerTab === 'log' ? (
                    <RunLogPanel
                      draft={draft}
                      runDetail={viewedRun}
                      runs={data?.runs ?? []}
                      selectedRunId={inspectedRunId}
                      cfs={data?.cfs ?? []}
                      candidateCfs={candidateCfs}
                      onSelectRun={setInspectedRunId}
                      onSelectNode={(id) => {
                        setSelectedEdgeId(null)
                        setSelectedNodeId(id)
                        setLeftCollapsed(false)
                      }}
                    />
                  ) : (
                    <CheckPanel
                      draft={draft}
                      preview={preview}
                      error={previewError}
                      isPending={compileMutation.isPending}
                      runtimes={runtimes}
                      runtimeId={compileRuntimeId}
                      cfs={data?.cfs ?? []}
                      candidateCfs={candidateCfs}
                      onRuntimeChange={(id) => {
                        setCompileRuntimeId(id)
                        setPreview(null)
                        setPreviewError(null)
                      }}
                      onCompile={() => compileMutation.mutate()}
                    />
                  )}
                </BottomDrawer>
              )}
            </>
          )}
        </main>

        {draft && (
          <aside className="agent-panel" aria-label="AI 助手">
            {rightCollapsed ? (
              <button
                className="panel-rail"
                type="button"
                onClick={() => setRightCollapsed(false)}
                aria-label="展开助手"
                title="展开助手"
              >
                <span>AI 助手</span>
              </button>
            ) : (
              <FlowAgentChat
                draft={draft}
                cfDrafts={candidateCfs}
                runDetail={viewedRun}
                messages={conversation}
                runtimes={runtimes}
                runtimeId={runtimeId}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                checkError={previewError}
                attachments={skillAttachments}
                undoMessageId={
                  agentUndo &&
                  agentUndo.appliedFlowId === draft.flowId &&
                  agentUndo.appliedRevision === draft.revision
                    ? agentUndo.messageId
                    : undefined
                }
                disabled={!workspaceAvailable}
                onMessagesChange={setConversation}
                onAttachmentsChange={setSkillAttachments}
                onRevision={(result) => {
                  updateDraft(result.flowDraft)
                  setCandidateCfs(result.cfDrafts)
                  setAgentUndo({
                    flowDraft: result.previousDraft,
                    cfDrafts: result.previousCfDrafts,
                    appliedFlowId: result.flowDraft.flowId,
                    appliedRevision: result.flowDraft.revision,
                    messageId: result.messageId,
                  })
                  setNotice({
                    tone: 'success',
                    title: '已按你的要求更新流程',
                    detail: `当前画布已切换到第 ${result.flowDraft.revision} 稿，可以撤销这次助手修改。`,
                  })
                  void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
                }}
                onUndoRevision={undoAgentRevision}
              />
            )}
          </aside>
        )}
      </div>

      {settingsOpen && data && (
        <div className="settings-layer" role="dialog" aria-modal="true" aria-label="工作台设置">
          <SettingsView
            settings={data.settings}
            runtimes={runtimes}
            discoveryWarnings={data.runtimeDiscoveryWarnings ?? []}
            isSaving={settingsMutation.isPending}
            isDiscovering={runtimeDiscoveryMutation.isPending}
            testingRuntimeId={testingRuntimeId}
            onClose={() => setSettingsOpen(false)}
            onSave={(next) => settingsMutation.mutate(next)}
            onTestRuntime={(id) => {
              setTestingRuntimeId(id)
              runtimeMutation.mutate(id)
            }}
            onDiscoverRuntimes={() => runtimeDiscoveryMutation.mutate()}
          />
        </div>
      )}
    </div>
  )
}
