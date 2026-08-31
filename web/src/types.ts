export type {
  CFDraft,
  CFVersion,
  FlowCompilationSnapshot,
  FlowDraft,
  FlowEdge,
  FlowNode,
  FlowPlan,
  LedgerEvent,
  ResourceProfile,
  RuntimeProfile,
  WorkspaceSettings,
} from '../../src/types'

import type {
  CFDraft,
  CFVersion,
  FlowCompilationSnapshot,
  FlowDraft,
  FlowPlan,
  ResourceProfile,
  RuntimeProfile,
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
}

export type AgentChatMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  meta?: string
  /** Whether this turn came from the initial goal or from later chat. */
  source?: 'goal' | 'agent'
  at?: string
}

export type FlowAgentResponse = {
  message: string
  intent: 'answer' | 'revise'
  stages: {
    kind: 'cf-call'
    name: string
    does: string
    cfId: string | null
    input?: string
    output?: string
    process?: string
  }[]
  flowDraft?: FlowDraft
  cfDrafts?: CFDraft[]
  runtimeId?: string
  fallback?: boolean
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
}

export type DirectoryListing = {
  path: string
  parentPath: string | null
  directories: { name: string; path: string; hidden?: boolean }[]
}

export type CompilationPreview = {
  plan: FlowPlan
  programs: CFVersion[]
}

export type BootstrapData = {
  cfs: CFVersion[]
  plans: FlowPlan[]
  runs: RunSummary[]
  flowCompilations: FlowCompilationSnapshot[]
  resources: ResourceProfile[]
  runtimes: RuntimeWithHealth[]
  runtimeDiscoveryWarnings: string[]
  settings: WorkspaceSettings
  flowDrafts: FlowDraft[]
  cfDrafts: CFDraft[]
}

export type CanvasPosition = { x: number; y: number }
