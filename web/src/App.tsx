import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CirclePlay,
  CircleStop,
  ListOrdered,
  GitBranch,
  GitMerge,
  Library,
  ListChecks,
  LoaderCircle,
  Plus,
  ScrollText,
  Upload,
  Workflow,
} from 'lucide-react'
import { api, readableError } from './api'
import { BottomDrawer } from './components/BottomDrawer'
import { CapabilityLibrary } from './components/CapabilityLibrary'
import { CheckPanel } from './components/CheckPanel'
import { DetailPanel } from './components/DetailPanel'
import { FlowAgentChat } from './components/FlowAgentChat'
import { FlowCanvas } from './components/FlowCanvas'
import { GoalComposer } from './components/GoalComposer'
import { PanelResizeHandle } from './components/PanelResizeHandle'
import { RunLogPanel } from './components/RunLogPanel'
import { SettingsView } from './components/SettingsView'
import { Notice, type NoticeValue } from './components/Notice'
import { TopBar } from './components/TopBar'
import { runtimeHealthErrorSummary } from './copy'
import { format, messagesFor, normalizeLocale, type Locale } from './i18n'
import { LocaleProvider } from './locale-context'
import type { FlowListRow } from './flow-list'
import { deriveNodeRunStates, type NodeRunState } from './run'
import {
  draftSaveStatus,
  flowTestCounts,
  mergeAttachments,
  arrangeCanvasPositions,
  AGENT_PANEL_DEFAULT_WIDTH,
  constrainPanelWidths,
  DETAIL_PANEL_DEFAULT_WIDTH,
  nextSignalAction,
  persistedDraftRevision,
  reconcileRestoredDraft,
  runStopControl,
  type DrawerTab,
  type TestState,
} from './workbench-ui'
import type {
  CanvasPosition,
  CFDraft,
  CompilationPreview,
  DraftBundle,
  FlowCompilationSnapshot,
  FlowDraft,
  FlowNode,
  FlowPlan,
  RunDetail,
  AgentChatMessage,
  BootstrapData,
  ProjectAgentConfig,
  ProjectAgentMutationResult,
} from './types'

const workspaceKeyPrefix = 'cf-platform-react-workbench-v3:'
const legacyWorkspaceKeys = ['cf-platform-react-workbench-v1', 'cf-platform-react-workbench-v2']

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
  leftPanelWidth?: number
  rightPanelWidth?: number
  dirty?: boolean
}

type AgentUndo = {
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
  appliedFlowId: string
  appliedRevision: number
  messageId: string
}

type RetryGoal = {
  objective: string
  attachments: File[]
  messageId: string
}

function workspaceStorageKey(root: string) {
  return `${workspaceKeyPrefix}${root}`
}

function readStoredWorkspace(root: string): StoredWorkspace {
  // v1 stored the goal transcript and the assistant transcript as two arrays
  // with no timestamps, so they cannot be interleaved faithfully. Rather than
  // invent an order, the workspace-scoped cache starts clean; drafts are autosaved server-side.
  for (const key of legacyWorkspaceKeys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Private-mode storage can throw; nothing to recover here.
    }
  }
  try {
    const value = localStorage.getItem(workspaceStorageKey(root))
    if (!value) return {}
    const parsed = JSON.parse(value) as StoredWorkspace
    return parsed?.version === 3 ? parsed : {}
  } catch {
    return {}
  }
}

function planToDraft(plan: FlowPlan, draftRevision: number): FlowDraft {
  const idByIndex = new Map(plan.nodes.map((node) => [node.index, node.id]))
  return {
    flowId: plan.flowId,
    revision: draftRevision,
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

function draftBundleSignature(flowDraft: FlowDraft, cfDrafts: CFDraft[]) {
  return JSON.stringify([flowDraft, cfDrafts])
}

function candidateDraftsForFlow(draft: FlowDraft, data: Pick<BootstrapData, 'cfs' | 'cfDrafts'>) {
  return data.cfDrafts.filter((cf) =>
    draft.nodes.some(
      (node) =>
        node.kind === 'cf-call' &&
        node.cfRef.cfId === cf.cfId &&
        !data.cfs.some(
          (version) => version.cfId === node.cfRef.cfId && version.version === node.cfRef.version,
        ),
    ),
  )
}

export function App() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<FlowDraft | null>(null)
  const [positions, setPositions] = useState<Record<string, CanvasPosition>>({})
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [candidateCfs, setCandidateCfs] = useState<CFDraft[]>([])
  // One transcript: the goal turn is simply the first turn of the same chat.
  const [conversation, setConversation] = useState<AgentChatMessage[]>([])
  const [agentUndo, setAgentUndo] = useState<AgentUndo | null>(null)
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [panelWidths, setPanelWidths] = useState({
    left: DETAIL_PANEL_DEFAULT_WIDTH,
    right: AGENT_PANEL_DEFAULT_WIDTH,
  })
  const [resizingPanel, setResizingPanel] = useState<'left' | 'right' | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [runId, setRunId] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<'test' | 'live' | null>(null)
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null)
  const [preview, setPreview] = useState<CompilationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeValue | null>(null)
  const [goal, setGoal] = useState('')
  const [skillAttachments, setSkillAttachments] = useState<File[]>([])
  const [retryGoal, setRetryGoal] = useState<RetryGoal | null>(null)
  const [proposalInvocationId, setProposalInvocationId] = useState<string | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const workbenchRef = useRef<HTMLDivElement>(null)
  const [runtimeId, setRuntimeId] = useState('')
  const [runInputs, setRunInputs] = useState<Record<string, string>>({})
  const runInputText = draft ? (runInputs[draft.flowId] ?? '{}') : '{}'
  const [flowAgentRuntimeId, setFlowAgentRuntimeId] = useState('')
  const [compileRuntimeId, setCompileRuntimeId] = useState('')
  const [testingRuntimeId, setTestingRuntimeId] = useState<string | null>(null)
  const hydratedWorkspaceRef = useRef<string | null>(null)
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false)
  const latestDraftRef = useRef({ draft, candidateCfs })
  const demoCreationRef = useRef(false)
  latestDraftRef.current = { draft, candidateCfs }

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap })
  const data = bootstrap.data
  const locale = normalizeLocale(data?.settings.locale)
  const m = messagesFor(locale)
  const workspaceAvailable = Boolean(data?.workspace.root)
  const parseRunInput = () => {
    try {
      return JSON.parse(runInputText)
    } catch {
      throw new Error(m.errors.invalidJson)
    }
  }
  const handledRunStateRef = useRef<string | null>(null)

  useEffect(() => {
    const root = data?.workspace.root
    if (!root || hydratedWorkspaceRef.current === root) return
    const stored = readStoredWorkspace(root)
    const storedDraft = stored.draft ? { ...stored.draft, workspaceRoot: root } : null
    const restored = reconcileRestoredDraft(
      storedDraft,
      stored.dirty ?? Boolean(storedDraft),
      data.flowDrafts,
    )
    setDraft(restored.draft)
    setPositions(stored.positions ?? {})
    setCandidateCfs(
      restored.source === 'server' && restored.draft
        ? candidateDraftsForFlow(restored.draft, data)
        : (stored.candidateCfs ?? []),
    )
    setConversation(stored.conversation ?? [])
    setRunId(stored.runId ?? null)
    setRunMode(stored.runMode ?? null)
    setInspectedRunId(stored.inspectedRunId ?? stored.runId ?? null)
    setDrawerTab(stored.drawerTab ?? null)
    setLeftCollapsed(stored.leftCollapsed ?? false)
    setRightCollapsed(stored.rightCollapsed ?? false)
    setPanelWidths(
      constrainPanelWidths(
        {
          left: stored.leftPanelWidth ?? DETAIL_PANEL_DEFAULT_WIDTH,
          right: stored.rightPanelWidth ?? AGENT_PANEL_DEFAULT_WIDTH,
        },
        workbenchRef.current?.getBoundingClientRect().width ?? window.innerWidth,
      ),
    )
    setDirty(restored.dirty)
    hydratedWorkspaceRef.current = root
    setWorkspaceHydrated(true)
  }, [data?.workspace.root])

  useEffect(() => {
    if (data?.settings.defaultRuntimeId && !runtimeId) setRuntimeId(data.settings.defaultRuntimeId)
  }, [data?.settings.defaultRuntimeId, runtimeId])
  useEffect(() => {
    if (data?.settings.defaultRuntimeId && !flowAgentRuntimeId)
      setFlowAgentRuntimeId(data.settings.defaultRuntimeId)
  }, [data?.settings.defaultRuntimeId, flowAgentRuntimeId])
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
    const root = data?.workspace.root
    if (!root || !workspaceHydrated || hydratedWorkspaceRef.current !== root) return
    try {
      localStorage.setItem(
        workspaceStorageKey(root),
        JSON.stringify({
          version: 3,
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
          leftPanelWidth: panelWidths.left,
          rightPanelWidth: panelWidths.right,
          dirty,
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
    dirty,
    inspectedRunId,
    leftCollapsed,
    panelWidths.left,
    panelWidths.right,
    positions,
    rightCollapsed,
    runId,
    runMode,
    data?.workspace.root,
    workspaceHydrated,
  ])

  useEffect(() => {
    const workbench = workbenchRef.current
    if (!workbench) return
    const constrain = () => {
      const containerWidth = workbench.getBoundingClientRect().width
      setPanelWidths((current) => {
        const next = constrainPanelWidths(current, containerWidth)
        return next.left === current.left && next.right === current.right ? current : next
      })
    }
    const observer = new ResizeObserver(constrain)
    observer.observe(workbench)
    return () => observer.disconnect()
  }, [draft?.flowId])

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
      return { plan: snapshot.plan, programs: snapshot.programs, warnings: snapshot.warnings ?? [] }
    })
  }, [data?.flowCompilations, draft?.flowId, draft?.revision])

  const clearWorkspace = () => {
    setDraft(null)
    setCandidateCfs([])
    setPositions({})
    setConversation([])
    setAgentUndo(null)
    setGoal('')
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
    if (data?.workspace.root) localStorage.removeItem(workspaceStorageKey(data.workspace.root))
  }

  const saveMutation = useMutation({
    scope: { id: 'flow-draft-autosave' },
    mutationFn: (snapshot: { flowDraft: FlowDraft; cfDrafts: CFDraft[]; signature: string }) =>
      api.saveDraft(snapshot.flowDraft, snapshot.cfDrafts),
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) => {
        if (!current) return current
        const cfById = new Map(current.cfDrafts.map((cf) => [cf.cfId, cf]))
        for (const cf of saved.cfDrafts) cfById.set(cf.cfId, cf)
        const flowDrafts = current.flowDrafts.some((item) => item.flowId === saved.flowDraft.flowId)
          ? current.flowDrafts.map((item) =>
              item.flowId === saved.flowDraft.flowId ? saved.flowDraft : item,
            )
          : [saved.flowDraft, ...current.flowDrafts]
        return { ...current, flowDrafts, cfDrafts: [...cfById.values()] }
      })
      const current = latestDraftRef.current
      if (
        current.draft?.flowId === saved.flowDraft.flowId &&
        draftBundleSignature(current.draft, current.candidateCfs) === variables.signature
      )
        setDirty(false)
    },
    onError: (error, variables) => {
      const current = latestDraftRef.current
      if (
        current.draft &&
        draftBundleSignature(current.draft, current.candidateCfs) !== variables.signature
      )
        return
      setNotice({
        tone: 'error',
        title: m.notices.autoSaveFailed.title,
        detail: readableError(error, locale),
      })
    },
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
        title: m.notices.draftDeleted.title,
        detail: m.notices.draftDeleted.detail,
      })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.deleteFailed.title,
        detail: readableError(error, locale),
      }),
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
        title: m.notices.publishedDeleted.title,
        detail: format(m.notices.publishedDeleted.detail, { version: target.flowVersion }),
      })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.deleteFailed.title,
        detail: readableError(error, locale),
      }),
  })
  useEffect(() => {
    if (!dirty || !draft) return
    const snapshot = {
      flowDraft: structuredClone(draft),
      cfDrafts: structuredClone(candidateCfs),
      signature: draftBundleSignature(draft, candidateCfs),
    }
    const timer = window.setTimeout(() => saveMutation.mutate(snapshot), 900)
    return () => window.clearTimeout(timer)
  }, [candidateCfs, dirty, draft])

  const compileMutation = useMutation({
    mutationFn: () => api.compile(draft!, candidateCfs, compileRuntimeId),
    onMutate: () => setPreviewError(null),
    onSuccess: (result) => {
      setPreview(result)
      setNotice({
        tone: 'success',
        title: m.notices.checkOk.title,
        detail: format(m.notices.checkOk.detail, { count: result.plan.nodes.length }),
      })
    },
    onError: (error) => {
      const detail = readableError(error, locale)
      setPreview(null)
      setPreviewError(detail)
      // 检查视图已经内联显示这条错误，顶部横幅只在别的视图里补充提示。
      if (drawerTab !== 'check')
        setNotice({ tone: 'error', title: m.notices.checkFailed.title, detail })
    },
  })
  const isRunning = Boolean(runMode)

  const proposalMutation = useMutation({
    mutationFn: ({
      objective,
      runtime,
      attachments,
      invocationId,
    }: {
      objective: string
      runtime: string
      attachments: File[]
      invocationId: string
    }) => api.propose(objective, runtime, attachments, invocationId),
    onSuccess: (proposal, variables) => {
      setProposalInvocationId(undefined)
      if (!proposal.flowDraft) {
        setConversation((current) => [
          ...current,
          {
            id: uniqueId('message'),
            role: 'assistant',
            body: m.notices.noCapabilities,
          },
        ])
        return
      }
      setDraft(proposal.flowDraft)
      setCandidateCfs(proposal.cfDrafts ?? [])
      setAgentUndo(null)
      setSkillAttachments([])
      setRetryGoal(null)
      setPositions({})
      setConversation((current) => [
        ...current,
        {
          id: uniqueId('message'),
          role: 'assistant',
          body: proposal.attachmentSummary
            ? format(m.notices.attachmentSummary, {
                message: proposal.assistantMessage ?? m.notices.draftReady,
                files: proposal.attachmentSummary.fileCount,
                skipped: proposal.attachmentSummary.skippedCount
                  ? format(m.notices.skippedFiles, {
                      count: proposal.attachmentSummary.skippedCount,
                    })
                  : '',
                archive: proposal.attachmentSummary.archivePath,
              })
            : (proposal.assistantMessage ?? m.notices.draftReady),
          meta: variables.runtime,
          invocationId: proposal.invocationId,
        },
      ])
      setDirty(true)
      setTestState('idle')
      setPreview(null)
    },
    onError: (error, variables) => {
      setProposalInvocationId(undefined)
      const detail = readableError(error, locale)
      const messageId = uniqueId('message')
      setRetryGoal({
        objective: variables.objective,
        attachments: variables.attachments,
        messageId,
      })
      setConversation((current) => [
        ...current,
        {
          id: messageId,
          role: 'assistant',
          body: format(m.notices.generateFailed.body, { detail }),
          meta: m.notices.generateFailed.meta,
          invocationId: variables.invocationId,
        },
      ])
      setNotice({ tone: 'error', title: m.notices.generateFailed.title, detail })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      const testedDraft = structuredClone(draft!)
      const result = await api.test(
        testedDraft,
        candidateCfs,
        data?.settings.defaultResourceProfileId,
        compileRuntimeId,
        parseRunInput(),
      )
      return { ...result, testedDraft }
    },
    onMutate: () => {
      setRunMode('test')
      setTestState('running')
      setNotice({
        tone: 'info',
        title: m.notices.testing.title,
        detail: m.notices.testing.detail,
      })
    },
    onSuccess: (result) => {
      setRunId(result.runId)
      setInspectedRunId(result.runId)
      setPreview({ plan: result.plan, programs: result.programs, warnings: [] })
      const snapshot: FlowCompilationSnapshot = {
        id: `test:${result.runId}`,
        flowId: result.testedDraft.flowId,
        flowRevision: result.testedDraft.revision,
        mode: 'test',
        flowDraft: result.testedDraft,
        plan: result.plan,
        programs: result.programs,
        runId: result.runId,
        createdAt: new Date().toISOString(),
      }
      queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) =>
        current
          ? {
              ...current,
              flowCompilations: [
                snapshot,
                ...current.flowCompilations.filter((item) => item.id !== snapshot.id),
              ],
            }
          : current,
      )
    },
    onError: (error) => {
      const detail = readableError(error, locale)
      setTestState('failed')
      setRunMode(null)
      setNotice({ tone: 'error', title: m.notices.testFailed.title, detail })
    },
  })
  const liveRunMutation = useMutation({
    mutationFn: (plan: FlowPlan) =>
      api.run(
        plan.flowId,
        plan.flowVersion,
        data?.settings.defaultResourceProfileId,
        parseRunInput(),
      ),
    onMutate: () => {
      setRunMode('live')
      setNotice({
        tone: 'info',
        title: m.notices.liveStarted.title,
        detail: m.notices.liveStarted.detail,
      })
    },
    onSuccess: (result) => {
      setRunId(result.runId)
      setInspectedRunId(result.runId)
    },
    onError: (error) => {
      setRunMode(null)
      setNotice({
        tone: 'error',
        title: m.notices.liveFailed.title,
        detail: readableError(error, locale),
      })
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
  const cancelMutation = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: () =>
      setNotice({
        tone: 'info',
        title: m.notices.stopping.title,
        detail: m.notices.stopping.detail,
      }),
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.cancelFailed.title,
        detail: readableError(error, locale),
      }),
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
    if (status === 'completed') {
      handledRunStateRef.current = runStateKey
      if (runMode === 'test') {
        setTestState('passed')
        setNotice({
          tone: 'success',
          title: m.notices.testPassed.title,
          detail: m.notices.testPassed.detail,
        })
      } else {
        setNotice({
          tone: 'success',
          title: m.notices.runFinished.title,
          detail: m.notices.runFinished.detail,
        })
      }
      setRunMode(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    } else if (status === 'cancelled') {
      handledRunStateRef.current = runStateKey
      if (runMode === 'test') setTestState('cancelled')
      setNotice({
        tone: 'info',
        title: runMode === 'test' ? m.notices.testStopped.title : m.notices.runStopped.title,
        detail: m.notices.runStopped.detail,
      })
      setRunMode(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    } else if (status === 'failed') {
      handledRunStateRef.current = runStateKey
      if (runMode === 'test') setTestState('failed')
      setNotice({
        tone: 'error',
        title:
          runMode === 'test' ? m.notices.testDidNotPass.title : m.notices.runDidNotFinish.title,
        detail: m.notices.runDidNotFinish.detail,
      })
      setRunMode(null)
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    }
  }, [queryClient, runMode, liveRunQuery.data?.run.id, liveRunQuery.data?.run.status])

  const publishMutation = useMutation({
    mutationFn: () => api.publish(draft!, candidateCfs),
    onSuccess: (plan) => {
      setTestState('published')
      setCandidateCfs([])
      setDirty(false)
      setNotice({
        tone: 'success',
        title: m.notices.published.title,
        detail: format(m.notices.published.detail, { version: plan.flowVersion }),
      })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.publishFailed.title,
        detail: readableError(error, locale),
      }),
  })

  const settingsMutation = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => {
      setNotice({
        tone: 'success',
        title: m.notices.settingsSaved.title,
        detail: m.notices.settingsSaved.detail,
      })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.settingsFailed.title,
        detail: readableError(error, locale),
      }),
  })
  const runtimeMutation = useMutation({
    mutationFn: api.testRuntime,
    onMutate: (id) => setTestingRuntimeId(id),
    onSuccess: (health, id) => {
      const runtime = data?.runtimes.find((item) => item.id === id)
      queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) =>
        current
          ? {
              ...current,
              runtimes: current.runtimes.map((item) =>
                item.id === id ? { ...item, health } : item,
              ),
            }
          : current,
      )
      setNotice(
        health?.status === 'available'
          ? {
              tone: 'success',
              title: m.notices.runtimeOk.title,
              detail: format(m.notices.runtimeOk.detail, {
                name: runtime?.name ?? m.notices.assistant,
              }),
            }
          : {
              tone: 'error',
              title: m.notices.runtimeFail.title,
              detail: runtimeHealthErrorSummary(health?.error),
            },
      )
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.runtimeError.title,
        detail: readableError(error, locale),
      }),
    onSettled: () => setTestingRuntimeId(null),
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
        title: m.notices.discoverOk.title,
        detail: format(m.notices.discoverOk.detail, {
          count: result.runtimes.filter((runtime) => runtime.health?.status === 'available').length,
          skipped: result.warnings.length
            ? format(m.notices.skippedManifests, { count: result.warnings.length })
            : '',
        }),
      })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.discoverFail.title,
        detail: readableError(error, locale),
      }),
  })
  const applyProjectAgentResult = (result: ProjectAgentMutationResult) => {
    queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) =>
      current
        ? {
            ...current,
            projectAgents: result.projectAgents,
            runtimes: result.runtimes,
            runtimeDiscoveryWarnings: result.warnings,
          }
        : current,
    )
  }
  const projectAgentMutation = useMutation({
    mutationFn: ({ config, editing }: { config: ProjectAgentConfig; editing: boolean }) =>
      editing ? api.updateProjectAgent(config) : api.createProjectAgent(config),
    onSuccess: (result, { config, editing }) => {
      applyProjectAgentResult(result)
      const runtime = result.runtimes.find((item) => item.id === config.id)
      const connected = runtime?.health?.status === 'available'
      setNotice(
        connected
          ? {
              tone: 'success',
              title: editing ? m.notices.projectUpdated.title : m.notices.projectAdded.title,
              detail: format(m.notices.projectAdded.detail, { name: config.name }),
            }
          : {
              tone: 'error',
              title: m.notices.projectSavedUnhealthy.title,
              detail: format(m.notices.projectSavedUnhealthy.detail, {
                summary: runtimeHealthErrorSummary(runtime?.health?.error, locale),
              }),
            },
      )
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.projectSaveFailed.title,
        detail: readableError(error, locale),
      }),
  })
  const deleteProjectAgentMutation = useMutation({
    mutationFn: api.deleteProjectAgent,
    onSuccess: (result, id) => {
      const restoredPreset = data?.projectAgents.find((agent) => agent.id === id)?.preset
      applyProjectAgentResult(result)
      setNotice({
        tone: 'success',
        title: restoredPreset ? m.notices.presetRestored.title : m.notices.projectDeleted.title,
        detail: restoredPreset ? m.notices.presetRestored.detail : m.notices.projectDeleted.detail,
      })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.projectDeleteFailed.title,
        detail: readableError(error, locale),
      }),
  })

  const currentDrafts = useMemo(() => {
    const drafts = [...(data?.flowDrafts ?? [])]
    if (draft && testState !== 'published' && !drafts.some((item) => item.flowId === draft.flowId))
      drafts.unshift(draft)
    return drafts.map((item) =>
      testState !== 'published' && draft?.flowId === item.flowId ? draft : item,
    )
  }, [data?.flowDrafts, draft, testState])
  const testCounts = useMemo(
    () => flowTestCounts(data?.flowCompilations ?? []),
    [data?.flowCompilations],
  )
  const currentTestCount = draft ? (testCounts[draft.flowId] ?? 0) : 0
  const latestPlan = useMemo(
    () =>
      (data?.plans ?? [])
        .filter((plan) => plan.flowId === draft?.flowId)
        .sort((a, b) => Number.parseInt(b.flowVersion, 10) - Number.parseInt(a.flowVersion, 10))[0],
    [data?.plans, draft?.flowId],
  )
  const saveStatus = draftSaveStatus(
    {
      isPending: saveMutation.isPending,
      isError: saveMutation.isError,
      dirty,
    },
    locale,
  )
  const stopControl = runStopControl(runMode, runId, locale)
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
    setDirty(true)
    setCandidateCfs((current) => {
      const index = current.findIndex((item) => item.cfId === next.cfId)
      if (index < 0) return [...current, next]
      return current.map((item, itemIndex) => (itemIndex === index ? next : item))
    })
  }

  const persistCurrentDraft = async () => {
    const current = latestDraftRef.current
    if (!dirty || !current.draft) return true
    const snapshot = {
      flowDraft: structuredClone(current.draft),
      cfDrafts: structuredClone(current.candidateCfs),
      signature: draftBundleSignature(current.draft, current.candidateCfs),
    }
    try {
      await saveMutation.mutateAsync(snapshot)
      return true
    } catch {
      return false
    }
  }

  const openCheck = () => {
    if (!draft) return
    setDrawerTab('check')
    if (!preview && !compileMutation.isPending) compileMutation.mutate()
  }

  const newFlow = async () => {
    if (!(await persistCurrentDraft())) return
    clearWorkspace()
  }
  const createBlankFlow = () => {
    if (!data?.workspace.root || !workspaceAvailable) return
    clearWorkspace()
    updateDraft({
      flowId: uniqueId('flow'),
      revision: 1,
      name: m.blank.name,
      objective: m.blank.objective,
      workspaceRoot: data.workspace.root,
      nodes: [{ id: 'output', kind: 'output', outputId: 'result' }],
      edges: [],
    })
    setLibraryOpen(true)
  }

  const createDemoMutation = useMutation({
    mutationFn: api.createDemoFlow,
    onSuccess: (bundle: DraftBundle) => {
      queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) => {
        if (!current) return current
        const cfById = new Map(current.cfDrafts.map((cf) => [cf.cfId, cf]))
        for (const cf of bundle.cfDrafts) cfById.set(cf.cfId, cf)
        const flowDrafts = current.flowDrafts.some(
          (item) => item.flowId === bundle.flowDraft.flowId,
        )
          ? current.flowDrafts.map((item) =>
              item.flowId === bundle.flowDraft.flowId ? bundle.flowDraft : item,
            )
          : [bundle.flowDraft, ...current.flowDrafts]
        return { ...current, flowDrafts, cfDrafts: [...cfById.values()] }
      })
      setSettingsOpen(false)
      setDraft(structuredClone(bundle.flowDraft))
      setConversation([])
      setAgentUndo(null)
      setCandidateCfs(structuredClone(bundle.cfDrafts))
      setPositions({})
      setDirty(false)
      setTestState('idle')
      setRunId(null)
      setRunMode(null)
      setInspectedRunId(null)
      setDrawerTab(null)
      setPreview(null)
      setPreviewError(null)
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setNotice({
        tone: 'success',
        title: m.notices.demoAdded.title,
        detail: m.notices.demoAdded.detail,
      })
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        title: m.notices.demoFailed.title,
        detail: readableError(error, locale),
      }),
  })

  const addDemoFlow = async () => {
    if (
      demoCreationRef.current ||
      saveMutation.isPending ||
      createDemoMutation.isPending ||
      proposalMutation.isPending ||
      compileMutation.isPending ||
      publishMutation.isPending ||
      isRunning
    )
      return
    demoCreationRef.current = true
    try {
      if (!(await persistCurrentDraft())) return
      await createDemoMutation.mutateAsync()
    } catch {
      // The mutation error handler presents the failure without leaving an unhandled rejection.
    } finally {
      demoCreationRef.current = false
    }
  }

  const deleteDraft = (target: FlowDraft) => {
    if (!window.confirm(format(m.confirms.deleteDraft, { name: target.name }))) return
    if (draft?.flowId === target.flowId) {
      clearWorkspace()
    }
    deleteDraftMutation.mutate(target.flowId)
  }

  const deletePlan = (target: FlowPlan) => {
    if (
      !window.confirm(
        format(m.confirms.deletePublished, { version: target.flowVersion, name: target.objective }),
      )
    )
      return
    deletePlanMutation.mutate({ flowId: target.flowId, flowVersion: target.flowVersion })
  }

  const selectDraft = (next: FlowDraft) => {
    setSettingsOpen(false)
    setDraft(structuredClone(next))
    setConversation([])
    setAgentUndo(null)
    setCandidateCfs(data ? candidateDraftsForFlow(next, data) : [])
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
    setDraft(planToDraft(plan, persistedDraftRevision(plan.flowId, data?.flowDrafts ?? [])))
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
      warnings: [],
    })
    setDrawerTab(null)
  }

  const addNode = (node: FlowNode) => {
    if (!draft) return
    const firstStep =
      node.kind === 'cf-call' &&
      draft.nodes.length === 1 &&
      draft.nodes[0].kind === 'output' &&
      draft.edges.length === 0
    updateDraft({
      ...draft,
      revision: draft.revision + 1,
      nodes: firstStep ? [node, ...draft.nodes] : [...draft.nodes, node],
      edges: firstStep
        ? [
            { id: uniqueId('edge'), from: '$entry', to: node.id },
            { id: uniqueId('edge'), from: node.id, to: draft.nodes[0].id },
          ]
        : draft.edges,
    })
    if (firstStep) {
      setPositions({})
      setLayoutRevision((value) => value + 1)
    }
    setSelectedEdgeId(null)
    setSelectedNodeId(node.id)
  }
  const arrangeLayout = () => {
    if (!draft) return
    setPositions(
      arrangeCanvasPositions(
        draft.nodes.map((node) => node.id),
        draft.edges,
      ),
    )
    setLayoutRevision((revision) => revision + 1)
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
    if (!objective || !workspaceAvailable) return
    setConversation((current) => [
      ...current,
      { id: uniqueId('message'), role: 'user', body: objective },
    ])
    setGoal('')
    setRetryGoal(null)
    const invocationId = uniqueId('agent')
    setProposalInvocationId(invocationId)
    proposalMutation.mutate({
      objective,
      runtime: runtimeId,
      attachments: skillAttachments,
      invocationId,
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
        body: m.notices.undoChat.body,
        meta: m.notices.undoChat.meta,
      },
    ])
    setNotice({
      tone: 'success',
      title: m.notices.undoNotice.title,
      detail: m.notices.undoNotice.detail,
    })
  }

  if ((bootstrap.isPending && !data) || (data && !workspaceHydrated))
    return (
      <LocaleProvider locale={locale}>
        <div className="boot-screen">
          <img className="brand-mark" src="/cflow-mark.svg" alt="CFlow" draggable={false} />
          <LoaderCircle className="spin" size={20} />
          <p>{m.boot.connecting}</p>
        </div>
      </LocaleProvider>
    )
  if (bootstrap.isError && !data)
    return (
      <LocaleProvider locale={locale}>
        <div className="boot-screen error">
          <strong>{m.boot.failed}</strong>
          <p>{readableError(bootstrap.error, locale)}</p>
          <button className="button" onClick={() => bootstrap.refetch()}>
            {m.boot.retry}
          </button>
        </div>
      </LocaleProvider>
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

  const selectFlowRow = async (row: FlowListRow) => {
    if (!(await persistCurrentDraft())) return
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
    if (writes && !window.confirm(m.confirms.writeFiles)) return
    liveRunMutation.mutate(latestPlan)
  }

  const changeLocale = (next: Locale) => {
    if (next === locale) return
    queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) =>
      current ? { ...current, settings: { ...current.settings, locale: next } } : current,
    )
    void api.saveSettings({ locale: next }).then(
      (settings) => {
        queryClient.setQueryData<BootstrapData>(['bootstrap'], (current) =>
          current ? { ...current, settings } : current,
        )
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      },
    )
  }

  return (
    <LocaleProvider locale={locale}>
      <div className={`app-frame${settingsOpen ? ' settings-open' : ''}`}>
        <TopBar
          drafts={currentDrafts}
          plans={data?.plans ?? []}
          draft={draft}
          testCount={currentTestCount}
          testCounts={testCounts}
          testState={testState}
          saveStatus={saveStatus}
          isSaving={saveMutation.isPending}
          saveFailed={saveMutation.isError}
          isRefreshing={bootstrap.isFetching}
          deletingKey={deletingKey}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          locale={locale}
          onLocaleChange={changeLocale}
          onSelectFlow={selectFlowRow}
          onDeleteFlow={deleteFlowRow}
          onNewFlow={newFlow}
          onAddDemo={addDemoFlow}
          isAddingDemo={createDemoMutation.isPending}
          isDemoDisabled={
            createDemoMutation.isPending ||
            saveMutation.isPending ||
            proposalMutation.isPending ||
            compileMutation.isPending ||
            publishMutation.isPending ||
            isRunning
          }
          onRefresh={() => bootstrap.refetch()}
          onSettings={() => setSettingsOpen(true)}
          onToggleLeft={() => setLeftCollapsed((value) => !value)}
          onToggleRight={() => setRightCollapsed((value) => !value)}
        />

        <div
          ref={workbenchRef}
          className={`workbench${leftCollapsed ? ' left-collapsed' : ''}${rightCollapsed ? ' right-collapsed' : ''}${resizingPanel ? ' is-resizing' : ''}${draft ? '' : ' is-empty'}`}
          style={
            {
              '--detail-width': `${panelWidths.left}px`,
              '--agent-width': `${panelWidths.right}px`,
            } as CSSProperties
          }
        >
          {draft && (
            <aside className="detail-panel" aria-label={m.detail.panelAria}>
              {leftCollapsed ? (
                <button
                  className="panel-rail"
                  type="button"
                  onClick={() => setLeftCollapsed(false)}
                  aria-label={m.topBar.expandDetail}
                  title={m.topBar.expandDetail}
                >
                  <span>{m.canvas.detail}</span>
                </button>
              ) : (
                <DetailPanel
                  draft={draft}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  preview={preview}
                  testCount={currentTestCount}
                  cfs={data?.cfs ?? []}
                  candidateCfs={candidateCfs}
                  runtimes={runtimes}
                  onDraftChange={updateDraft}
                  onCandidateCfChange={updateCandidateCf}
                  onSelectNode={setSelectedNodeId}
                  onSelectEdge={setSelectedEdgeId}
                  onOpenCheck={openCheck}
                />
              )}
            </aside>
          )}

          {draft && !leftCollapsed && (
            <PanelResizeHandle
              side="left"
              width={panelWidths.left}
              oppositeWidth={rightCollapsed ? 50 : panelWidths.right}
              defaultWidth={DETAIL_PANEL_DEFAULT_WIDTH}
              onResize={(left) => setPanelWidths((current) => ({ ...current, left }))}
              onResizeStateChange={(resizing) => setResizingPanel(resizing ? 'left' : null)}
            />
          )}

          <main className="center-column">
            {!draft ? (
              <GoalComposer
                messages={conversation}
                isPending={proposalMutation.isPending}
                goal={goal}
                attachments={skillAttachments}
                runtimes={runtimes}
                runtimeId={runtimeId}
                canSubmit={Boolean(goal.trim() && workspaceAvailable)}
                onGoalChange={setGoal}
                onAttachmentsChange={setSkillAttachments}
                onRuntimeChange={setRuntimeId}
                onSubmit={submitGoal}
                retryMessageId={retryGoal?.messageId}
                pendingInvocationId={proposalInvocationId}
                onAddDemo={addDemoFlow}
                onCreateBlank={createBlankFlow}
                isAddingDemo={createDemoMutation.isPending}
                onRetry={() => {
                  if (!retryGoal) return
                  setGoal(retryGoal.objective)
                  setSkillAttachments(retryGoal.attachments)
                }}
              />
            ) : (
              <>
                <div className="canvas-toolbar">
                  <button
                    type="button"
                    className={`button${libraryOpen ? ' is-active' : ''}`}
                    onClick={() => setLibraryOpen((value) => !value)}
                    title={libraryOpen ? m.canvas.collapseLibrary : m.canvas.expandLibrary}
                  >
                    <Library size={15} />
                    {m.canvas.library}{' '}
                    <span className="count">{(data?.cfs.length ?? 0) + candidateCfs.length}</span>
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={addCapabilityNode}
                    title={m.canvas.addStep}
                  >
                    <Workflow size={15} />
                    {m.canvas.capability}
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={arrangeLayout}
                    title={m.canvas.arrangeTitle}
                  >
                    <ListOrdered size={15} />
                    {m.canvas.arrange}
                  </button>
                  <span className="toolbar-divider" />
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
                    title={m.canvas.addBranch}
                    aria-label={m.canvas.addBranch}
                  >
                    <GitBranch size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => addNode({ id: uniqueId('join'), kind: 'join', mode: 'all' })}
                    className="button is-icon"
                    title={m.canvas.addJoin}
                    aria-label={m.canvas.addJoin}
                  >
                    <GitMerge size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      addNode({ id: uniqueId('output'), kind: 'output', outputId: 'result' })
                    }
                    className="button is-icon"
                    title={m.canvas.addOutput}
                    aria-label={m.canvas.addOutput}
                  >
                    <Plus size={15} />
                  </button>
                  <span className="toolbar-spacer" />
                  <button
                    className={`button${drawerTab === 'log' ? ' is-active' : ''}`}
                    type="button"
                    onClick={() => setDrawerTab(drawerTab === 'log' ? null : 'log')}
                    title={m.canvas.logTitle}
                  >
                    <ScrollText size={15} />
                    {m.canvas.log}
                  </button>
                  <button
                    className={`button${signal === 'check' && drawerTab !== 'check' ? ' signal' : ''}${
                      drawerTab === 'check' ? ' is-active' : ''
                    }`}
                    type="button"
                    onClick={openCheck}
                  >
                    <ListChecks size={15} />
                    {m.canvas.check}
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
                      {cancellationRequested ? m.canvas.stopping : stopControl.label}
                    </button>
                  ) : (
                    <button
                      className={`button${signal === 'test' ? ' signal' : ''}`}
                      type="button"
                      disabled={!workspaceAvailable || isRunning || testMutation.isPending}
                      title={m.canvas.testTitle}
                      onClick={() => testMutation.mutate()}
                    >
                      <CirclePlay size={15} />
                      {m.canvas.test}
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
                      {cancellationRequested ? m.canvas.stopping : stopControl.label}
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
                      {m.canvas.run}
                    </button>
                  )}
                  <button
                    className={`button publish${signal === 'publish' ? ' signal' : ''}`}
                    type="button"
                    disabled={
                      !workspaceAvailable || testState !== 'passed' || publishMutation.isPending
                    }
                    onClick={() => window.confirm(m.confirms.publish) && publishMutation.mutate()}
                  >
                    <Upload size={15} />
                    {m.canvas.publish}
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
                        ...(version.draft.execution?.kind === 'builtin'
                          ? { toolInput: { source: { kind: 'files' as const, paths: [] } } }
                          : {}),
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
                    layoutRevision={layoutRevision}
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
                        runInput={runInputText}
                        onRunInputChange={(value) =>
                          setRunInputs((current) => ({ ...current, [draft.flowId]: value }))
                        }
                      />
                    )}
                  </BottomDrawer>
                )}
              </>
            )}
          </main>

          {draft && !rightCollapsed && (
            <PanelResizeHandle
              side="right"
              width={panelWidths.right}
              oppositeWidth={leftCollapsed ? 50 : panelWidths.left}
              defaultWidth={AGENT_PANEL_DEFAULT_WIDTH}
              onResize={(right) => setPanelWidths((current) => ({ ...current, right }))}
              onResizeStateChange={(resizing) => setResizingPanel(resizing ? 'right' : null)}
            />
          )}

          {draft && (
            <aside className="agent-panel" aria-label={m.agent.panelAria}>
              {rightCollapsed ? (
                <button
                  className="panel-rail"
                  type="button"
                  onClick={() => setRightCollapsed(false)}
                  aria-label={m.topBar.expandAgent}
                  title={m.topBar.expandAgent}
                >
                  <span>{m.canvas.agent}</span>
                </button>
              ) : (
                <FlowAgentChat
                  draft={draft}
                  cfDrafts={candidateCfs}
                  runDetail={viewedRun}
                  messages={conversation}
                  runtimes={runtimes}
                  runtimeId={flowAgentRuntimeId}
                  testCount={currentTestCount}
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
                  onRuntimeChange={setFlowAgentRuntimeId}
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
                      title: m.notices.agentUpdated.title,
                      detail: m.notices.agentUpdated.detail,
                    })
                    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
                  }}
                  onUndoRevision={undoAgentRevision}
                />
              )}
            </aside>
          )}
        </div>

        <Notice notice={notice} onClose={() => setNotice(null)} />

        {settingsOpen && data && (
          <div
            className="settings-layer"
            role="dialog"
            aria-modal="true"
            aria-label={m.settings.title}
          >
            <SettingsView
              workspaceRoot={data.workspace.root}
              settings={data.settings}
              runtimes={runtimes}
              projectAgents={data.projectAgents}
              discoveryWarnings={data.runtimeDiscoveryWarnings ?? []}
              isSaving={settingsMutation.isPending}
              isDiscovering={runtimeDiscoveryMutation.isPending}
              testingRuntimeId={testingRuntimeId}
              isSavingProjectAgent={projectAgentMutation.isPending}
              deletingProjectAgentId={
                deleteProjectAgentMutation.isPending
                  ? (deleteProjectAgentMutation.variables ?? null)
                  : null
              }
              onClose={() => setSettingsOpen(false)}
              onSave={(next) => settingsMutation.mutate(next)}
              onLocaleChange={changeLocale}
              onTestRuntime={(id) => {
                setTestingRuntimeId(id)
                runtimeMutation.mutate(id)
              }}
              onDiscoverRuntimes={() => runtimeDiscoveryMutation.mutate()}
              onSaveProjectAgent={(config, editing) =>
                projectAgentMutation.mutateAsync({ config, editing }).then(() => undefined)
              }
              onDeleteProjectAgent={(id) =>
                deleteProjectAgentMutation.mutateAsync(id).then(() => undefined)
              }
            />
          </div>
        )}
      </div>
    </LocaleProvider>
  )
}
