export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
/**
 * Legacy deterministic agent task. Builtin programs use a separately versioned
 * tool identity; neither program format contains internal control flow.
 */
export interface AgentCFProgram {
  version: '0.2'
  cfId: string
  sourceRevision: number
  task: string
}
export type CFProgram =
  | AgentCFProgram
  | {
      version: '0.3'
      kind: 'builtin'
      cfId: string
      sourceRevision: number
      tool: 'file.extract-text'
      toolVersion: '1'
    }
export type FileExtractionInput = {
  source:
    | { kind: 'files'; paths: string[] }
    | { kind: 'flow-input'; pointer: string }
    | { kind: 'upstream'; nodeId: string; pointer: string }
  encoding?: 'utf-8' | 'gb18030'
  maxChars?: number
}
export type TextRange = { start: number; end: number }
export type ExtractedBlock = TextRange & {
  kind: string
  page?: number
  slide?: number
  sheet?: string
  rows?: (TextRange & { row: number; column: number; rowSpan?: number; colSpan?: number })[][]
}
export type ExtractedDocument = {
  path: string
  format: string
  status: 'completed' | 'failed'
  text: string
  blocks: ExtractedBlock[]
  warnings: string[]
  truncated: boolean
  originalChars: number
  error?: { code: string; message: string }
}
export type FileExtractionResult = {
  kind: 'file-extraction'
  documents: ExtractedDocument[]
  succeeded: number
  failed: number
}
export interface CFDraft {
  execution?: { kind: 'builtin'; tool: 'file.extract-text'; version: '1' }
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
  /** Ordered workspace-relative paths used to resolve file mentions in the task. */
  fileReferences?: string[]
  defaultExecutor?: string
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
      toolInput?: FileExtractionInput
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
  | { id: string; kind: 'output'; outputId: string }
export interface FlowEdge {
  id: string
  from: string | '$entry'
  to: string
  when?: {
    outcome: 'completed' | 'failed' | 'branch-case'
    caseId?: string
  }
}
export interface FlowDraft {
  flowId: string
  revision: number
  name: string
  objective: string
  workspaceRoot: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  resources?: ResourceRequirement[]
  limits?: { maxConcurrency?: number; maxNodeDispatches?: number }
}
export interface FlowPlan {
  version: '0.6'
  flowId: string
  flowVersion: string
  objective: string
  workspaceRoot: string
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
  warnings?: CompilationWarning[]
  runId?: string
  createdAt: string
}
export type CompilationWarning = {
  code: 'INDEXED_FILE_MISSING' | 'FILE_MENTION_NOT_INDEXED'
  cfId: string
  nodeId: string
  path: string
  message: string
}
export type LedgerEvent = {
  seq: number
  runId: string
  type: string
  node?: number
  data?: Json
  at: string
}

export type AgentInvocationKind = 'flow-node' | 'flow-proposal' | 'flow-assistant'
export type AgentInvocationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
export type AgentTraceEventKind = 'stage' | 'plan' | 'tool' | 'notice' | 'error'

export interface AgentInvocation {
  id: string
  kind: AgentInvocationKind
  status: AgentInvocationStatus
  runtimeId?: string
  flowId?: string
  runId?: string
  node?: number
  messageId?: string
  result?: Json
  error?: string
  createdAt: string
  updatedAt: string
}

export interface AgentTraceEvent {
  invocationId: string
  seq: number
  kind: AgentTraceEventKind
  title: string
  detail?: string
  status?: 'pending' | 'running' | 'completed' | 'failed'
  technical?: Json
  at: string
}

export type AgentTraceReporter = (
  event: Omit<AgentTraceEvent, 'invocationId' | 'seq' | 'at'>,
) => void

export type RuntimeBackendKind = 'builtin' | 'acp' | 'cli'
export type RuntimePromptTransport = 'stdin' | 'argument'
export type RuntimeOutputMode = 'json' | 'text'
export type RuntimePermissionMode = 'none' | 'read' | 'write' | 'full'
export interface ProjectAgentConfig {
  id: string
  name: string
  description?: string
  command: string
  assistantCommand?: string
  assistantPathEnvironment?: string
  args: string[]
  outputMode: RuntimeOutputMode
  envAllowlist: string[]
  timeoutMs: number
  maxOutputBytes: number
  preset?: boolean
  overridden?: boolean
}
export type RuntimeDiscoverySource =
  'builtin' | 'path-acp' | 'package-manifest' | 'user-manifest' | 'project-manifest' | 'manual'
export interface ExecutorRuntimeTraits {
  backendKind: 'builtin' | 'acp' | 'process'
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
  assistantCommand?: string
  assistantPathEnvironment?: string
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
  permissionArgs?: Partial<Record<RuntimePermissionMode, string[]>>
  discovery?: {
    source: RuntimeDiscoverySource
    manifestPath?: string
    manifestHash?: string
  }
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
  stage?: 'installed' | 'adapter-ready' | 'protocol-ready'
  authentication?: 'unknown' | 'verified' | 'required'
  version?: string
  error?: string
}
export interface WorkspaceSettings {
  defaultRuntimeId: string
  defaultResourceProfileId?: string
  autoSaveDrafts: boolean
  testTimeoutMs: number
  locale: import('./locale.js').Locale
  updatedAt: string
}

export interface WorkspaceInfo {
  root: string
}

export type RuntimeExecutionError = {
  layer: 'adapter' | 'runtime' | 'permission' | 'engine'
  code: string
  message: string
  retryable: boolean
  effectState: 'none' | 'started' | 'committed' | 'unknown'
}
