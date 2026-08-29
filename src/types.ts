export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type LocalErrorPolicy =
  | { action: 'fail-cf' }
  | { action: 'retry'; maxAttempts: number }
  | { action: 'continue'; fallback: Json }
export type CFStep =
  | {
      index: number
      kind: 'agent'
      task: string
      input?: Json
      next?: number
      outputContract?: Json
      timeoutMs?: number
      onError?: LocalErrorPolicy
    }
  | {
      index: number
      kind: 'call'
      target: { type: 'script' | 'service'; ref: { id: string; version: string } }
      input?: Json
      next?: number
      outputContract?: Json
      timeoutMs?: number
      onError?: LocalErrorPolicy
    }
  | { index: number; kind: 'guard'; cond: Json; then: number; else: number }
  | { index: number; kind: 'return'; source?: Json }
export interface CFProgram {
  version: '0.1'
  cfId: string
  sourceRevision: number
  entry: number
  steps: CFStep[]
  limits: { maxStepExecutions: number; maxExternalCalls: number; maxOutputBytes: number }
}
export interface CFDraft {
  cfId: string
  revision: number
  name: string
  does: string
  input?: string
  output?: string
  process?: string
  inputContract?: Json
  outputContract?: Json
  effects?: CapabilityEffect[]
  defaultExecutor?: string
  program?: CFProgram
}
export type CapabilityEffect = {
  type: 'file-read' | 'file-write' | 'command'
  scope: 'workspace'
  description: string
}
export interface CFVersion {
  cfId: string
  version: string
  draft: CFDraft
  program: CFProgram
  programHash: string
  createdAt: string
}
export interface ResourceRequirement {
  id: string
  type: string
  access: 'read' | 'write' | 'admin'
  required: boolean
  description?: string
}
export interface ResourceBinding {
  requirementId: string
  resourceId: string
  type: string
}

export interface ResolvedResource extends ResourceBinding {
  access: ResourceRequirement['access']
  profileId: string
}
export interface ResourceProfile {
  id: string
  name: string
  bindings: ResourceBinding[]
  environment?: string
}
export type FlowNode =
  | {
      id: string
      name?: string
      kind: 'cf-call'
      cfRef: { cfId: string; version: string }
      inputDefaults?: Json
      executor?: string
      inputContract?: Json
      outputContract?: Json
      onError?: { action: 'stop' | 'retry'; maxAttempts?: number }
    }
  | {
      id: string
      kind: 'branch'
      cond: Json
      cases: string[]
      /** Natural-language routing rule for each case id. */
      caseConditions?: Record<string, string>
    }
  | {
      id: string
      kind: 'join'
      mode: 'all' | 'any'
      onUpstreamFailure?: 'fail' | 'continue-eligible'
    }
  | { id: string; kind: 'approval'; policyRef: string }
  | { id: string; kind: 'output'; outputId: string }
export interface FlowEdge {
  id: string
  from: string | '$entry'
  to: string
  when?: {
    outcome: 'completed' | 'failed' | 'branch-case' | 'approved' | 'rejected'
    caseId?: string
  }
}
export interface FlowBinding {
  id: string
  from: string
  to: string
  required?: boolean
  default?: Json
}
export interface FlowDraft {
  flowId: string
  revision: number
  name: string
  objective: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** @deprecated Field-level bindings are no longer used. */
  bindings?: FlowBinding[]
  resources?: ResourceRequirement[]
  limits?: { maxConcurrency?: number; maxNodeDispatches?: number }
}
export interface FlowPlan {
  version: '0.5'
  flowId: string
  flowVersion: string
  objective: string
  entries: number[]
  nodes: (FlowNode & {
    index: number
    programHash?: string
    executorProfile?: { id: string; profileVersion: number }
  })[]
  edges: (FlowEdge & { from: number | '$entry'; to: number })[]
  resources?: ResourceRequirement[]
  limits: { maxConcurrency: number; maxNodeDispatches: number }
  planHash: string
}

export interface FlowCompilationSnapshot {
  id: string
  flowId: string
  flowRevision: number
  mode: 'preview' | 'test'
  flowDraft: FlowDraft
  plan: FlowPlan
  programs: CFVersion[]
  runId?: string
  createdAt: string
}
export type LedgerEvent = {
  seq: number
  runId: string
  type: string
  node?: number
  data?: Json
  at: string
}

export type RuntimeBackendKind = 'builtin' | 'acp'
export type RuntimePromptTransport = 'stdin' | 'argument'
export type RuntimeOutputMode = 'json' | 'text'
export interface ExecutorRuntimeTraits {
  backendKind: 'builtin' | 'acp'
  sessionMode: 'stateless' | 'per-cf-call' | 'persistent'
  structuredOutput: boolean
  streaming: boolean
  toolEvents: boolean
  permissionPrompts: boolean
  tokenAccounting: 'exact' | 'approximate' | 'unavailable'
  cancellation: 'cooperative' | 'process-kill' | 'unsupported'
  filesystemIsolation: 'sandboxed' | 'cwd-scoped' | 'host-permissions'
  networkIsolation: 'enforced' | 'adapter-declared' | 'unenforced'
}
export interface RuntimeProfile {
  id: string
  profileVersion: number
  name: string
  description?: string
  enabled: boolean
  backend: RuntimeBackendKind
  command?: string
  args: string[]
  versionArgs: string[]
  model?: string
  workingDirectory?: string
  promptTransport: RuntimePromptTransport
  outputMode: RuntimeOutputMode
  timeoutMs: number
  maxOutputBytes: number
  envAllowlist: string[]
  capabilities: string[]
  traits: ExecutorRuntimeTraits
  adapterBuild: string
  createdAt: string
}
export interface RuntimeHealth {
  runtimeId: string
  profileVersion: number
  status: 'available' | 'unavailable' | 'disabled' | 'checking'
  checkedAt: string
  latencyMs: number
  version?: string
  error?: string
}
export interface WorkspaceSettings {
  defaultRuntimeId: string
  workspaceRoot: string
  defaultResourceProfileId?: string
  autoSaveDrafts: boolean
  testTimeoutMs: number
  locale: string
  updatedAt: string
}

export type RuntimeExecutionError = {
  layer: 'adapter' | 'runtime' | 'permission' | 'engine'
  code: string
  message: string
  retryable: boolean
  effectState: 'none' | 'started' | 'committed' | 'unknown'
}
