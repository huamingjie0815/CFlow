export type {
  CFDraft,
  CapabilityEffect,
  CFVersion,
  FlowCompilationSnapshot,
  FlowBinding,
  FlowDraft,
  FlowEdge,
  FlowNode,
  FlowPlan,
  Json,
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
  }
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

export type AgentChatAction = {
  type: 'retry-node' | 'select-node' | 'open-activity' | 'update-node' | 'update-binding'
  label: string
  description: string
  nodeId?: string
  patch?: {
    executor?: string
    onError?: { action: 'stop' | 'retry'; maxAttempts?: number }
  }
  binding?: { id?: string; from: string; to: string; required?: boolean }
}

export type AgentChatMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  actions?: AgentChatAction[]
  meta?: string
}

export type FlowAgentResponse = {
  message: string
  actions: AgentChatAction[]
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
  settings: WorkspaceSettings
  flowDrafts: FlowDraft[]
  cfDrafts: CFDraft[]
}

export type CanvasPosition = { x: number; y: number }
