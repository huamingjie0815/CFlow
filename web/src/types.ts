export type {
  CFDraft,
  CFVersion,
  CompilationWarning,
  FlowCompilationSnapshot,
  FlowDraft,
  FlowEdge,
  FlowNode,
  FlowPlan,
  LedgerEvent,
  ResourceProfile,
  RuntimeProfile,
  ProjectAgentConfig,
  WorkspaceInfo,
  WorkspaceSettings,
  AgentInvocation,
  AgentTraceEvent,
} from '../../src/types'

import type {
  AgentInvocation,
  AgentTraceEvent,
  CFDraft,
  CFVersion,
  CompilationWarning,
  FlowCompilationSnapshot,
  FlowDraft,
  FlowPlan,
  ResourceProfile,
  RuntimeProfile,
  ProjectAgentConfig,
  WorkspaceInfo,
  WorkspaceSettings,
} from '../../src/types'

export type RuntimeWithHealth = RuntimeProfile & {
  health?: {
    status: 'available' | 'unavailable' | 'disabled' | 'checking'
    version?: string
    error?: string
    stage?: 'installed' | 'adapter-ready' | 'protocol-ready'
    authentication?: 'unknown' | 'verified'
  }
}

export type RuntimeDiscoveryResult = {
  runtimes: RuntimeWithHealth[]
  warnings: string[]
}

export type ProjectAgentMutationResult = {
  projectAgents: ProjectAgentConfig[]
  runtimes: RuntimeWithHealth[]
  warnings: string[]
}

export type RunSummary = {
  id: string
  flow_version_id: string
  status: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

export type RunDetail = {
  run: RunSummary
  events: import('../../src/types').LedgerEvent[]
  invocations?: AgentInvocation[]
}

export type AgentChatMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  meta?: string
  /** Whether this turn came from the initial goal or from later chat. */
  source?: 'goal' | 'agent'
  at?: string
  invocationId?: string
}

export type AgentInvocationDetail = {
  invocation: AgentInvocation
  events: AgentTraceEvent[]
}

export type FlowAgentResponse = {
  message: string
  intent: 'answer' | 'revise'
  stages: Array<
    | {
        kind: 'cf-call'
        name: string
        does: string
        cfId: string | null
        input?: string
        output?: string
        process?: string
      }
    | {
        kind: 'branch'
        name: string
        cond: string
        routes: Array<{
          caseId: string
          condition: string
          endsFlow: boolean
          stages: Array<{
            kind: 'cf-call'
            name: string
            does: string
            cfId: string | null
          }>
        }>
      }
  >
  flowDraft?: FlowDraft
  cfDrafts?: CFDraft[]
  runtimeId?: string
  fallback?: boolean
  invocationId?: string
}

export type FlowProposal = {
  objective: string
  runtimeId?: string
  assistantMessage?: string
  flowDraft: FlowDraft | null
  cfDrafts?: CFDraft[]
  unresolvedSuggestions: string[]
  attachmentSummary?: {
    fileCount: number
    skippedCount: number
    entryFiles: string[]
    archivePath: string
  }
  invocationId?: string
}

export type CompilationPreview = {
  plan: FlowPlan
  programs: CFVersion[]
  warnings: CompilationWarning[]
}

export type WorkspaceFileSearchResult = {
  matches: string[]
  missing: string[]
  truncated: boolean
}

export type DraftBundle = {
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
}

export type BootstrapData = {
  workspace: WorkspaceInfo
  cfs: CFVersion[]
  plans: FlowPlan[]
  runs: RunSummary[]
  flowCompilations: FlowCompilationSnapshot[]
  resources: ResourceProfile[]
  runtimes: RuntimeWithHealth[]
  projectAgents: ProjectAgentConfig[]
  runtimeDiscoveryWarnings: string[]
  settings: WorkspaceSettings
  flowDrafts: FlowDraft[]
  cfDrafts: CFDraft[]
}

export type CanvasPosition = { x: number; y: number }
