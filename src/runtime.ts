import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  client as acpClient,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type {
  CapabilityEffect,
  ExecutorRuntimeTraits,
  Json,
  ResolvedResource,
  RuntimeHealth,
  RuntimeProfile,
  WorkspaceSettings,
  AgentTraceReporter,
} from './types.js'
import type { ExecutorRegistry } from './engine.js'
import { Store } from './db.js'
import { isWithinDirectory } from './workspace.js'
import { DEMO_RUNTIME_ID, executeDemoCapability, isBuiltinRuntimeId } from './demo-runtime.js'
import {
  adapterDescriptorForId,
  adapterDescriptorRecord,
  externalAdapterDescriptors,
  loadAgentManifestRecords,
  type AgentManifestLoadOptions,
  type AgentManifestRecord,
} from './runtime-manifest.js'
import {
  canChangeWorkspace,
  describeResolvedCommand,
  discoverAcpCommands,
  existingAbsoluteDirectory,
  existingExecutable,
  launchProcess,
  parseJsonOutput,
  resolveCommandAliases,
  runtimeIdFromCommand,
  runtimeNameFromCommand,
  terminateProcess,
  type CommandResolutionOptions,
  type LaunchSpec,
  type ResolvedCommand,
} from './runtime-process.js'

const ADAPTER_BUILD = 'cf-runtime-adapter/4'
const moduleRequire = createRequire(import.meta.url)
export class RuntimeExecutionException extends Error {
  readonly details: import('./types.js').RuntimeExecutionError
  constructor(details: import('./types.js').RuntimeExecutionError) {
    super(details.message)
    this.name = 'RuntimeExecutionException'
    this.details = details
  }
}
export type RuntimeAnalysisOptions = {
  cwd: string
  allowedRoot: string
}

type AcpPermissionTool = {
  kind?: unknown
  name?: unknown
  title?: unknown
  locations?: unknown
  rawInput?: unknown
}

export function isAcpToolAllowed(
  tool: AcpPermissionTool,
  effects: CapabilityEffect[],
  root: string | undefined,
  cwd: string,
  analysis = false,
) {
  const kind = [tool.kind, tool.name, tool.title]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase())
    .join(' ')
  const effectType =
    kind.includes('read') || kind.includes('search')
      ? 'file-read'
      : kind.includes('edit') ||
          kind.includes('write') ||
          kind.includes('delete') ||
          kind.includes('move')
        ? 'file-write'
        : kind.includes('exec') ||
            kind.includes('command') ||
            kind.includes('terminal') ||
            kind.includes('bash') ||
            kind.includes('shell') ||
            kind.includes('powershell') ||
            kind.includes('cmd') ||
            kind.includes('run')
          ? 'command'
          : undefined
  const declared = effectType
    ? analysis && effectType === 'file-read'
      ? true
      : effects.some((effect) => effect.type === effectType && effect.scope === 'workspace')
    : false
  const locations = Array.isArray(tool.locations) ? [...tool.locations] : []
  if (tool.rawInput && typeof tool.rawInput === 'object') {
    for (const key of ['path', 'file', 'filePath', 'filename']) {
      const value = (tool.rawInput as Record<string, unknown>)[key]
      if (typeof value === 'string') locations.push(value)
    }
  }
  const inWorkspace = locations.every((location: any) => {
    let value = typeof location === 'string' ? location : (location?.path ?? location?.uri)
    if (typeof value === 'string' && value.startsWith('file://')) {
      try {
        value = new URL(value).pathname
      } catch {
        return false
      }
    }
    if (typeof value === 'string' && !isAbsolute(value)) value = resolve(cwd, value)
    return Boolean(root) && (!value || isWithinDirectory(root!, value))
  })
  const scopedRead = !analysis || effectType !== 'file-read' || locations.length > 0
  return Boolean(declared && inWorkspace && scopedRead)
}
const defaultTraits = (overrides: Partial<ExecutorRuntimeTraits> = {}): ExecutorRuntimeTraits => ({
  backendKind: 'acp',
  sessionMode: 'per-cf-call',
  structuredOutput: false,
  streaming: false,
  toolEvents: false,
  permissionPrompts: false,
  tokenAccounting: 'unavailable',
  cancellation: 'cooperative',
  filesystemIsolation: 'sandboxed',
  networkIsolation: 'adapter-declared',
  ...overrides,
})

const profileFromManifest = (record: AgentManifestRecord): RuntimeProfile => {
  const createdAt = new Date(0).toISOString()
  const manifest = record.manifest
  const cli = manifest.backend === 'cli'
  return {
    id: manifest.id,
    profileVersion: 1,
    name: manifest.name,
    description: manifest.description,
    enabled: true,
    backend: manifest.backend,
    command: manifest.command,
    args: manifest.args ?? [],
    versionArgs: manifest.versionArgs ?? (cli ? ['--version'] : []),
    promptTransport: manifest.promptTransport ?? (cli ? 'argument' : 'stdin'),
    outputMode: manifest.outputMode ?? 'json',
    timeoutMs: manifest.timeoutMs ?? 300_000,
    maxOutputBytes: manifest.maxOutputBytes ?? 1_048_576,
    envAllowlist: manifest.envAllowlist ?? ['HOME', 'PATH', 'LANG', 'LC_ALL'],
    capabilities: manifest.capabilities ?? [
      'reasoning',
      'code',
      'structured-output',
      'workspace-read',
    ],
    permissionArgs: manifest.permissionArgs,
    discovery: {
      source: record.source,
      manifestPath: record.manifestPath,
      manifestHash: record.manifestHash,
    },
    traits: defaultTraits({
      backendKind: cli ? 'process' : 'acp',
      structuredOutput: true,
      streaming: false,
      toolEvents: !cli,
      permissionPrompts: false,
      tokenAccounting: 'unavailable',
      cancellation: cli ? 'process-kill' : 'cooperative',
      filesystemIsolation: cli ? 'host-permissions' : 'sandboxed',
      networkIsolation: cli ? 'unenforced' : 'adapter-declared',
      ...manifest.traits,
    }),
    adapterBuild: ADAPTER_BUILD,
    createdAt,
  }
}

export type RuntimeDiscoveryOptions = AgentManifestLoadOptions &
  CommandResolutionOptions & { healthTimeoutMs?: number }

export const discoverRuntimeProfiles = (options: RuntimeDiscoveryOptions = {}) => {
  const loaded = loadAgentManifestRecords(options)
  const declared = loaded.records.map(profileFromManifest)
  const external = externalAdapterDescriptors
    .filter((descriptor) =>
      resolveCommandAliases(
        [descriptor.manifest.command, ...(descriptor.commandAliases ?? [])],
        options,
      ),
    )
    .map((descriptor) => profileFromManifest(adapterDescriptorRecord(descriptor, 'path-acp')))
  const declaredCommands = new Set(
    [...declared, ...external].flatMap((profile) => [
      profile.command,
      ...(adapterDescriptorForId(profile.id)?.commandAliases ?? []),
    ]),
  )
  const generic = discoverAcpCommands(options)
    .filter((command) => !declaredCommands.has(command))
    .sort()
    .map((command): RuntimeProfile => ({
      id: runtimeIdFromCommand(command),
      profileVersion: 1,
      name: runtimeNameFromCommand(command),
      description: `通过本机 ACP server ${command} 执行步骤。`,
      enabled: true,
      backend: 'acp',
      command,
      args: [],
      versionArgs: [],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576,
      envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL'],
      capabilities: ['reasoning', 'code', 'structured-output', 'workspace-read'],
      discovery: {
        source: 'path-acp',
        manifestHash: `path-acp:${command}`,
      },
      traits: defaultTraits({ structuredOutput: true, toolEvents: true }),
      adapterBuild: ADAPTER_BUILD,
      createdAt: new Date(0).toISOString(),
    }))
  const selected = new Map([...generic, ...external].map((profile) => [profile.id, profile]))
  for (const profile of declared) selected.set(profile.id, profile)
  return { profiles: [...selected.values()], warnings: loaded.warnings }
}

export const defaultRuntimeProfiles = (): RuntimeProfile[] => discoverRuntimeProfiles().profiles

export const defaultWorkspaceSettings = (defaultRuntimeId = 'codex'): WorkspaceSettings => ({
  defaultRuntimeId,
  autoSaveDrafts: true,
  testTimeoutMs: 300_000,
  locale: 'zh-CN',
  updatedAt: new Date().toISOString(),
})

export class RuntimeManager {
  private activeRuntimeIds = new Set<string>()
  private lastDiscoveryWarnings: string[] = []
  constructor(
    private store: Store,
    private discoveryOptions: RuntimeDiscoveryOptions = {},
  ) {
    this.ensureDefaults()
  }
  ensureDefaults() {
    this.discover()
    this.ensureDemoRuntime()
    const preferredRuntimeId = this.activeRuntimeIds.has('codex')
      ? 'codex'
      : ([...this.activeRuntimeIds][0] ?? 'codex')
    const settings = this.store.settings()
    if (!settings) {
      this.store.saveSettings(defaultWorkspaceSettings(preferredRuntimeId))
    } else {
      const { workspaceRoot: _removed, ...cleanSettings } = settings as WorkspaceSettings & {
        workspaceRoot?: string
      }
      const current = this.store.runtimeProfile(settings.defaultRuntimeId)
      if (!current || current.backend === 'builtin')
        this.store.saveSettings({
          ...cleanSettings,
          defaultRuntimeId: preferredRuntimeId,
          updatedAt: new Date().toISOString(),
        })
      else if (Object.prototype.hasOwnProperty.call(settings, 'workspaceRoot'))
        this.store.saveSettings(cleanSettings)
    }
  }
  discover() {
    const discovery = discoverRuntimeProfiles(this.discoveryOptions)
    const reserved = discovery.profiles.filter((profile) => profile.id === DEMO_RUNTIME_ID)
    const defaults = discovery.profiles.filter((profile) => profile.id !== DEMO_RUNTIME_ID)
    this.activeRuntimeIds = new Set(defaults.map((profile) => profile.id))
    this.lastDiscoveryWarnings = [
      ...discovery.warnings,
      ...reserved.map(() => `${DEMO_RUNTIME_ID}: reserved runtime id ignored`),
    ]
    const changed: RuntimeProfile[] = []
    for (const profile of defaults) {
      const current = this.store.runtimeProfile(profile.id)
      if (!current) {
        this.store.saveRuntimeProfile(profile)
        changed.push(profile)
      } else if (
        current.adapterBuild !== ADAPTER_BUILD ||
        current.discovery?.manifestHash !== profile.discovery?.manifestHash
      ) {
        const updated = {
          ...current,
          ...profile,
          enabled: current.enabled,
          model: current.model,
          workingDirectory: current.workingDirectory,
          profileVersion: this.store.nextRuntimeProfileVersion(profile.id),
          createdAt: new Date().toISOString(),
        }
        this.store.saveRuntimeProfile(updated)
        changed.push(updated)
      }
    }
    return changed
  }
  private ensureDemoRuntime() {
    const current = this.store.runtimeProfile(DEMO_RUNTIME_ID)
    if (
      current?.backend === 'builtin' &&
      current.enabled &&
      current.discovery?.source === 'builtin'
    )
      return
    this.store.saveRuntimeProfile({
      id: DEMO_RUNTIME_ID,
      profileVersion: current ? this.store.nextRuntimeProfileVersion(DEMO_RUNTIME_ID) : 1,
      name: '演示执行',
      description: '内置演示执行器，不调用本机助手。',
      enabled: true,
      backend: 'builtin',
      args: [],
      versionArgs: [],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 5_000,
      maxOutputBytes: 65_536,
      envAllowlist: [],
      capabilities: ['structured-output'],
      discovery: { source: 'builtin' },
      traits: defaultTraits({
        backendKind: 'builtin',
        sessionMode: 'stateless',
        structuredOutput: true,
        streaming: false,
        toolEvents: false,
        permissionPrompts: false,
        tokenAccounting: 'unavailable',
        cancellation: 'cooperative',
        filesystemIsolation: 'sandboxed',
        networkIsolation: 'enforced',
      }),
      adapterBuild: ADAPTER_BUILD,
      createdAt: new Date(0).toISOString(),
    })
  }
  discoveryWarnings() {
    return this.lastDiscoveryWarnings
  }
  profiles() {
    const defaultRuntimeId = this.store.settings()?.defaultRuntimeId
    return this.store
      .currentRuntimeProfiles()
      .filter(
        (profile) =>
          profile.id !== DEMO_RUNTIME_ID &&
          profile.backend !== 'builtin' &&
          (this.activeRuntimeIds.has(profile.id) ||
            profile.discovery?.source === 'manual' ||
            profile.id === defaultRuntimeId),
      )
  }
  profile(id: string) {
    return this.store.runtimeProfile(id)
  }
  settings() {
    const stored = this.store.settings()
    if (!stored) return defaultWorkspaceSettings()
    const { workspaceRoot: _removed, ...settings } = stored as WorkspaceSettings & {
      workspaceRoot?: string
    }
    return settings
  }
  validateSettings(input: Partial<WorkspaceSettings>) {
    if (Object.prototype.hasOwnProperty.call(input, 'workspaceRoot'))
      throw new Error('WORKSPACE_ROOT_SETTING_REMOVED')
    const previous = this.settings()
    const defaultRuntimeId = String(input.defaultRuntimeId ?? previous.defaultRuntimeId)
    const defaultRuntime = this.profile(defaultRuntimeId)
    if (!defaultRuntime) throw new Error('DEFAULT_RUNTIME_NOT_FOUND')
    if (defaultRuntime.backend === 'builtin') throw new Error('DEFAULT_RUNTIME_NOT_SELECTABLE')
    if (!defaultRuntime.enabled) throw new Error('DEFAULT_RUNTIME_DISABLED')
    const defaultResourceProfileId = Object.prototype.hasOwnProperty.call(
      input,
      'defaultResourceProfileId',
    )
      ? input.defaultResourceProfileId
      : previous.defaultResourceProfileId
    if (
      defaultResourceProfileId &&
      !this.store.getResourceProfile(String(defaultResourceProfileId))
    )
      throw new Error('DEFAULT_RESOURCE_PROFILE_NOT_FOUND')
    const testTimeoutMs = Number(input.testTimeoutMs ?? previous.testTimeoutMs)
    if (!Number.isInteger(testTimeoutMs) || testTimeoutMs < 1_000 || testTimeoutMs > 3_600_000)
      throw new Error('TEST_TIMEOUT_INVALID')
    return {
      ...previous,
      ...input,
      defaultRuntimeId,
      defaultResourceProfileId: defaultResourceProfileId
        ? String(defaultResourceProfileId)
        : undefined,
      autoSaveDrafts: input.autoSaveDrafts ?? previous.autoSaveDrafts,
      testTimeoutMs,
      locale: String(input.locale ?? previous.locale).slice(0, 32),
      updatedAt: new Date().toISOString(),
    } satisfies WorkspaceSettings
  }
  updateSettings(input: Partial<WorkspaceSettings>) {
    const value = this.validateSettings(input)
    this.store.saveSettings(value)
    return value
  }
  validateProfile(input: Partial<RuntimeProfile> & { id: string; name: string }) {
    const id = input.id.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('RUNTIME_ID_INVALID')
    if (id === DEMO_RUNTIME_ID) throw new Error('RUNTIME_ID_RESERVED')
    if (!input.name?.trim() || input.name.trim().length > 80)
      throw new Error('RUNTIME_NAME_INVALID')
    const backend = input.backend ?? 'acp'
    if (!['builtin', 'acp', 'cli'].includes(backend)) throw new Error('RUNTIME_BACKEND_INVALID')
    if (backend === 'builtin' && !isBuiltinRuntimeId(id))
      throw new Error('RUNTIME_BUILTIN_RESERVED')
    const command = input.command?.trim()
    if ((backend === 'acp' || backend === 'cli') && !command)
      throw new Error('RUNTIME_COMMAND_REQUIRED')
    const timeoutMs = Number(input.timeoutMs ?? 300_000)
    const maxOutputBytes = Number(input.maxOutputBytes ?? 1_048_576)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000)
      throw new Error('RUNTIME_TIMEOUT_INVALID')
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1_024 || maxOutputBytes > 16_777_216)
      throw new Error('RUNTIME_OUTPUT_LIMIT_INVALID')
    const workingDirectoryInput = input.workingDirectory?.trim()
    const workingDirectory = workingDirectoryInput
      ? existingAbsoluteDirectory(workingDirectoryInput, 'RUNTIME_CWD_INVALID')
      : undefined
    const safeList = (items: unknown, max: number) => {
      if (
        !Array.isArray(items) ||
        items.length > max ||
        items.some((value) => typeof value !== 'string')
      )
        throw new Error('RUNTIME_LIST_INVALID')
      return items.map((value) => value.trim()).filter(Boolean)
    }
    const previous = this.profile(id)
    const envAllowlist = safeList(
      input.envAllowlist ?? previous?.envAllowlist ?? ['PATH', 'HOME'],
      40,
    )
    if (envAllowlist.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      throw new Error('RUNTIME_ENV_NAME_INVALID')
    const permissionArgsInput = input.permissionArgs ?? previous?.permissionArgs
    const permissionArgs = permissionArgsInput
      ? Object.fromEntries(
          (['none', 'read', 'write', 'full'] as const)
            .map((mode) => [mode, safeList(permissionArgsInput[mode] ?? [], 30)] as const)
            .filter(([, args]) => args.length),
        )
      : undefined
    return {
      id,
      profileVersion: this.store.nextRuntimeProfileVersion(id),
      name: input.name.trim(),
      description: input.description?.trim().slice(0, 400),
      enabled: input.enabled ?? true,
      backend,
      command:
        backend === 'acp' || backend === 'cli' ? (command ?? previous?.command ?? id) : command,
      args: safeList(input.args ?? previous?.args ?? [], 40),
      versionArgs: safeList(input.versionArgs ?? previous?.versionArgs ?? ['--version'], 10),
      model: input.model?.trim().slice(0, 120),
      workingDirectory,
      promptTransport: input.promptTransport === 'argument' ? 'argument' : 'stdin',
      outputMode: input.outputMode === 'text' ? 'text' : 'json',
      timeoutMs,
      maxOutputBytes,
      envAllowlist: [...new Set(envAllowlist)],
      capabilities: safeList(input.capabilities ?? previous?.capabilities ?? [], 40),
      permissionArgs,
      discovery: previous?.discovery ?? { source: 'manual' },
      traits: {
        ...defaultTraits(
          backend === 'cli'
            ? {
                backendKind: 'process',
                cancellation: 'process-kill',
                filesystemIsolation: 'host-permissions',
                networkIsolation: 'unenforced',
              }
            : {},
        ),
        ...(input.traits ?? previous?.traits ?? {}),
      },
      adapterBuild: ADAPTER_BUILD,
      createdAt: new Date().toISOString(),
    } satisfies RuntimeProfile
  }
  saveProfile(input: Partial<RuntimeProfile> & { id: string; name: string }) {
    const profile = this.validateProfile(input)
    this.store.saveRuntimeProfile(profile)
    this.activeRuntimeIds.add(profile.id)
    return profile
  }
  register(registry: ExecutorRegistry, profile: RuntimeProfile, exactOnly = false) {
    if (profile.id === DEMO_RUNTIME_ID) {
      registry.register({
        id: `${profile.id}@${profile.profileVersion}`,
        execute: executeDemoCapability,
      })
      if (!exactOnly) registry.register({ id: profile.id, execute: executeDemoCapability })
      return
    }
    if (profile.backend === 'builtin') {
      const execute = async (task: string, input: Json) => ({ task, input }) as Json
      registry.register({ id: `${profile.id}@${profile.profileVersion}`, execute })
      if (!exactOnly) registry.register({ id: profile.id, execute })
      return
    }
    const executor = (id: string) =>
      registry.register({
        id,
        execute: (task, input, signal, resources, effects, context, trace) =>
          this.executeProfile(
            profile,
            task,
            input,
            signal,
            resources,
            undefined,
            effects,
            context,
            undefined,
            trace,
          ),
      })
    executor(`${profile.id}@${profile.profileVersion}`)
    if (!exactOnly) executor(profile.id)
  }
  registerAll(registry: ExecutorRegistry) {
    const current = new Map(this.profiles().map((profile) => [profile.id, profile.profileVersion]))
    for (const profile of this.store.allRuntimeProfiles())
      this.register(registry, profile, current.get(profile.id) !== profile.profileVersion)
  }
  async health(id: string): Promise<RuntimeHealth> {
    const profile = this.profile(id)
    if (!profile) throw new Error('RUNTIME_NOT_FOUND')
    if (!profile.enabled)
      return {
        runtimeId: id,
        profileVersion: profile.profileVersion,
        status: 'disabled',
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
      }
    if (profile.backend === 'builtin')
      return {
        runtimeId: id,
        profileVersion: profile.profileVersion,
        status: 'available',
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        version: profile.adapterBuild,
      }
    if (profile.backend === 'acp') {
      const started = Date.now()
      try {
        const version = await this.probeAcp(profile)
        return {
          runtimeId: id,
          profileVersion: profile.profileVersion,
          status: 'available',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          stage: 'protocol-ready',
          authentication: 'unknown',
          version,
        }
      } catch (error) {
        return {
          runtimeId: id,
          profileVersion: profile.profileVersion,
          status: 'unavailable',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          stage: this.commandInstalled(profile) ? 'installed' : undefined,
          authentication: 'unknown',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    if (profile.backend === 'cli') {
      const started = Date.now()
      try {
        const version = await this.probeCli(profile)
        return {
          runtimeId: id,
          profileVersion: profile.profileVersion,
          status: 'available',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          stage: 'adapter-ready',
          authentication: 'unknown',
          version,
        }
      } catch (error) {
        return {
          runtimeId: id,
          profileVersion: profile.profileVersion,
          status: 'unavailable',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          stage: this.commandInstalled(profile) ? 'installed' : undefined,
          authentication: 'unknown',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    throw new Error(`RUNTIME_BACKEND_UNSUPPORTED:${profile.backend}`)
  }
  async execute(
    id: string,
    task: string,
    input: Json,
    signal: AbortSignal,
    resources: ResolvedResource[] = [],
    outputSchema?: Record<string, unknown>,
    context?: { workspaceRoot: string },
    trace?: AgentTraceReporter,
  ): Promise<Json> {
    const profile = this.profile(id)
    if (!profile) throw new Error(`UNKNOWN_EXECUTOR:${id}`)
    return this.executeProfile(
      profile,
      task,
      input,
      signal,
      resources,
      outputSchema,
      [],
      context,
      undefined,
      trace,
    )
  }
  async executeAnalysis(
    id: string,
    task: string,
    input: Json,
    signal: AbortSignal,
    options: RuntimeAnalysisOptions,
    outputSchema?: Record<string, unknown>,
    trace?: AgentTraceReporter,
  ): Promise<Json> {
    const profile = this.profile(id)
    if (!profile) throw new Error(`UNKNOWN_EXECUTOR:${id}`)
    return this.executeProfile(
      profile,
      task,
      input,
      signal,
      [],
      outputSchema,
      [],
      undefined,
      options,
      trace,
    )
  }
  private async executeProfile(
    profile: RuntimeProfile,
    task: string,
    input: Json,
    signal: AbortSignal,
    resources: ResolvedResource[] = [],
    outputSchema?: Record<string, unknown>,
    effects: CapabilityEffect[] = [],
    context?: { workspaceRoot: string },
    analysis?: RuntimeAnalysisOptions,
    trace?: AgentTraceReporter,
  ): Promise<Json> {
    if (profile.id === DEMO_RUNTIME_ID)
      return executeDemoCapability(task, input, signal, resources, effects, context, trace)
    if (!profile.enabled) throw new Error(`RUNTIME_DISABLED:${profile.id}`)
    trace?.({
      kind: 'stage',
      title: '已准备 Agent 请求',
      status: 'completed',
      detail: `${profile.name} · ${profile.backend.toUpperCase()}`,
    })
    if (profile.backend === 'builtin') {
      return { task, input }
    }
    const prompt = [
      'You are executing one bounded CF capability inside a fixed Flow.',
      'Complete only the current task. Do not choose the next Flow node or change the Flow.',
      profile.outputMode === 'json'
        ? 'Return only valid JSON. Do not wrap it in Markdown.'
        : 'Return the final result without process commentary.',
      `Task:\n${task}`,
      `Input JSON:\n${JSON.stringify(input)}`,
      'Input JSON contains flowInput and an upstream array with complete source outputs. Select and transform only data described by the capability input guidance.',
      effects.length
        ? `Declared effects (authorized within workspace root ${context?.workspaceRoot ?? analysis?.allowedRoot}):\n${JSON.stringify(effects)}\nYou may perform these declared effects when required by the task; do not ask the user for a second authorization.`
        : 'Declared effects: none. Do not perform file writes, reads, or commands.',
      outputSchema ? `Expected output JSON Schema:\n${JSON.stringify(outputSchema)}` : undefined,
      resources.length
        ? `Authorized resources (do not access outside these scopes):\n${JSON.stringify(resources)}`
        : 'Authorized resources: none.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const text =
      profile.backend === 'acp'
        ? await this.runAcp(profile, prompt, signal, effects, context, analysis, trace)
        : profile.backend === 'cli'
          ? await this.runCli(profile, prompt, signal, effects, context, analysis, trace)
          : await Promise.reject(new Error(`RUNTIME_BACKEND_UNSUPPORTED:${profile.backend}`))
    return profile.outputMode === 'json' ? parseJsonOutput(text) : { content: text.trim() }
  }
  private commandResolutionOptions(env: NodeJS.ProcessEnv = process.env) {
    return {
      bundledRoot: this.discoveryOptions.bundledRoot,
      env,
      platform: this.discoveryOptions.platform,
      projectRoot: this.discoveryOptions.projectRoot,
    } satisfies CommandResolutionOptions
  }
  private resolvedCommand(profile: RuntimeProfile, env: Record<string, string>) {
    if (!profile.command) throw new Error('RUNTIME_COMMAND_REQUIRED')
    const descriptor = adapterDescriptorForId(profile.id)
    const resolved = resolveCommandAliases(
      [profile.command, ...(descriptor?.commandAliases ?? [])],
      this.commandResolutionOptions(env),
    )
    if (!resolved)
      throw new Error(
        `${profile.backend === 'acp' ? 'ACP_SERVER_NOT_FOUND' : 'AGENT_CLI_NOT_FOUND'}:${profile.command}`,
      )
    return resolved
  }
  private commandInstalled(profile: RuntimeProfile) {
    if (!profile.command) return false
    try {
      this.resolvedCommand(profile, this.runtimeEnvironment(profile))
      return true
    } catch {
      return false
    }
  }
  private launchSpec(
    profile: RuntimeProfile,
    args: string[],
    cwd: string,
    stdio: LaunchSpec['stdio'],
    effects: CapabilityEffect[] = [],
  ) {
    const env = this.runtimeEnvironment(profile, effects)
    return {
      resolved: this.resolvedCommand(profile, env),
      args,
      cwd,
      env,
      stdio,
    } satisfies LaunchSpec
  }
  private async probeAcp(profile: RuntimeProfile) {
    const spec = this.launchSpec(profile, profile.args, profile.workingDirectory ?? process.cwd(), [
      'pipe',
      'pipe',
      'pipe',
    ])
    const child = launchProcess(spec)
    let stderr = Buffer.alloc(0)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk])
      if (stderr.length > 8_192) stderr = stderr.subarray(stderr.length - 8_192)
    })
    const terminate = () => terminateProcess(child)
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      if (!child.stdin || !child.stdout) throw new Error('ACP_SERVER_STDIO_UNAVAILABLE')
      const stream = ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      )
      const initialize = acpClient({ name: 'CFlow Health Check' }).connectWith(
        stream,
        async (ctx) =>
          ctx.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientInfo: { name: 'CFlow', version: ADAPTER_BUILD },
            clientCapabilities: { plan: {}, session: {} },
          }),
      )
      const childError = new Promise<never>((_, reject) => child.once('error', reject))
      const childExit = new Promise<never>((_, reject) =>
        child.once('exit', (code, signal) =>
          reject(new Error(`ACP_SERVER_EXITED:${code ?? signal ?? 'unknown'}`)),
        ),
      )
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          terminate()
          reject(new Error('ACP_HANDSHAKE_TIMEOUT'))
        }, this.discoveryOptions.healthTimeoutMs ?? 5_000)
      })
      const response = await Promise.race([initialize, childError, childExit, timedOut])
      const agent = response.agentInfo
        ? [response.agentInfo.name, response.agentInfo.version].filter(Boolean).join(' ')
        : undefined
      return [
        `ACP ${response.protocolVersion}`,
        agent,
        `via ${describeResolvedCommand(spec.resolved)}`,
      ]
        .filter(Boolean)
        .join(' · ')
    } catch (error) {
      const detail = stderr.toString('utf8').trim().slice(-800)
      if (error instanceof Error)
        throw new Error(
          `${error.message}${detail ? `:${detail}` : ''} [launch=${describeResolvedCommand(spec.resolved)}]`,
        )
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      terminate()
    }
  }
  private async probeCli(profile: RuntimeProfile) {
    const spec = this.launchSpec(
      profile,
      profile.versionArgs,
      profile.workingDirectory ?? process.cwd(),
      ['ignore', 'pipe', 'pipe'],
    )
    if (!profile.versionArgs.length) return `CLI via ${describeResolvedCommand(spec.resolved)}`
    const child = launchProcess(spec)
    const output: Buffer[] = []
    const errors: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk))
    let timeout: ReturnType<typeof setTimeout> | undefined
    const terminate = () => terminateProcess(child)
    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit, reject) => {
          child.once('error', reject)
          child.once('exit', (code, signal) => resolveExit({ code, signal }))
          timeout = setTimeout(() => {
            terminate()
            reject(new Error('CLI_HEALTHCHECK_TIMEOUT'))
          }, this.discoveryOptions.healthTimeoutMs ?? 5_000)
        },
      )
      const detail = Buffer.concat(errors).toString('utf8').trim().slice(-800)
      if (result.code !== 0)
        throw new Error(
          `CLI_HEALTHCHECK_EXITED:${result.code ?? result.signal ?? 'unknown'}${detail ? `:${detail}` : ''} [launch=${describeResolvedCommand(spec.resolved)}]`,
        )
      const version = Buffer.concat(output).toString('utf8').trim().split(/\r?\n/, 1)[0]
      return [version || profile.name, `via ${describeResolvedCommand(spec.resolved)}`].join(' · ')
    } finally {
      if (timeout) clearTimeout(timeout)
      terminate()
    }
  }
  private platformEnvironment() {
    const env: Record<string, string> = {}
    const required =
      process.platform === 'win32'
        ? [
            'PATH',
            'PATHEXT',
            'SystemRoot',
            'ComSpec',
            'USERPROFILE',
            'HOMEDRIVE',
            'HOMEPATH',
            'APPDATA',
            'LOCALAPPDATA',
            'TEMP',
            'TMP',
          ]
        : ['PATH', 'HOME', 'TMPDIR']
    for (const key of required) {
      const actual =
        process.platform === 'win32'
          ? Object.keys(process.env).find(
              (candidate) => candidate.toLowerCase() === key.toLowerCase(),
            )
          : key
      const value = actual ? process.env[actual] : undefined
      if (value !== undefined) env[key] = value
    }
    return env
  }
  private bundledCodexPath() {
    const targets: Record<string, [string, string]> = {
      'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
      'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
      'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
      'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
      'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
      'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
    }
    const target = targets[`${process.platform}-${process.arch}`]
    if (!target)
      throw new Error(`CODEX_BUNDLED_PLATFORM_UNSUPPORTED:${process.platform}-${process.arch}`)
    let packageJson: string
    try {
      packageJson = moduleRequire.resolve(`${target[0]}/package.json`)
    } catch {
      throw new Error(`CODEX_BUNDLED_CLI_NOT_FOUND:${target[0]}`)
    }
    const executable = join(
      dirname(packageJson),
      'vendor',
      target[1],
      'bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    )
    const resolved = existingExecutable(executable)
    if (!resolved) throw new Error(`CODEX_BUNDLED_CLI_NOT_FOUND:${executable}`)
    return resolved
  }
  private runtimeEnvironment(profile: RuntimeProfile, effects: CapabilityEffect[] = []) {
    const env = this.platformEnvironment()
    for (const key of profile.envAllowlist) {
      const value = process.env[key]
      if (value !== undefined) env[key] = value
    }
    const descriptor = adapterDescriptorForId(profile.id)
    if (descriptor) {
      Object.assign(env, descriptor.staticEnvironment)
      if (profile.model && descriptor.modelEnvironment)
        env[descriptor.modelEnvironment] = JSON.stringify({ model: profile.model })
      if (descriptor.permissionMode)
        env[descriptor.permissionMode.environment] = canChangeWorkspace(effects)
          ? descriptor.permissionMode.workspaceWrite
          : descriptor.permissionMode.readOnly
      if (descriptor.nativeCommand) {
        const override = process.env[descriptor.nativeCommand.overrideEnvironment]
        if (override) {
          const resolved = resolveCommandAliases(
            [override],
            this.commandResolutionOptions(process.env),
          )
          if (!resolved)
            throw new Error(
              `${profile.id === 'codex' ? 'CODEX_CLI_NOT_FOUND' : 'CLAUDE_CODE_CLI_NOT_FOUND'}:${override}`,
            )
          env[descriptor.nativeCommand.adapterEnvironment] = resolved.executable
        } else if (descriptor.nativeCommand.bundled === 'codex') {
          env[descriptor.nativeCommand.adapterEnvironment] = this.bundledCodexPath()
        }
      }
    }
    return env
  }
  private cliPermissionArgs(
    profile: RuntimeProfile,
    effects: CapabilityEffect[],
    analysis?: RuntimeAnalysisOptions,
  ) {
    const canRead = Boolean(analysis) || effects.some((effect) => effect.type === 'file-read')
    const canWrite = effects.some((effect) => effect.type === 'file-write')
    const canRun = effects.some((effect) => effect.type === 'command')
    const mode = canRun ? 'full' : canWrite ? 'write' : canRead ? 'read' : 'none'
    return profile.permissionArgs?.[mode] ?? []
  }
  private async runCli(
    profile: RuntimeProfile,
    prompt: string,
    signal: AbortSignal,
    effects: CapabilityEffect[] = [],
    context?: { workspaceRoot: string },
    analysis?: RuntimeAnalysisOptions,
    trace?: AgentTraceReporter,
  ) {
    const cwd = analysis?.cwd ?? context?.workspaceRoot ?? profile.workingDirectory ?? process.cwd()
    const args = [
      ...profile.args,
      ...this.cliPermissionArgs(profile, effects, analysis),
      ...(profile.promptTransport === 'argument' ? [prompt] : []),
    ]
    const spec = this.launchSpec(profile, args, cwd, ['pipe', 'pipe', 'pipe'], effects)
    const child = launchProcess(spec)
    trace?.({ kind: 'stage', title: '正在等待 Agent 响应', status: 'running' })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let outputBytes = 0
    let outputLimitExceeded = false
    const terminate = () => terminateProcess(child)
    const relayAbort = () => terminate()
    signal.addEventListener('abort', relayAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > profile.maxOutputBytes) {
        outputLimitExceeded = true
        terminate()
        return
      }
      output.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      errors.push(chunk)
      if (Buffer.concat(errors).length > 65_536) errors.shift()
    })
    if (!child.stdin) throw new Error('RUNTIME_STDIN_UNAVAILABLE')
    if (profile.promptTransport === 'stdin') child.stdin.end(prompt)
    else child.stdin.end()
    try {
      const result = await new Promise<{ code: number | null; childSignal: NodeJS.Signals | null }>(
        (resolveExit, reject) => {
          child.once('error', reject)
          child.once('exit', (code, childSignal) => resolveExit({ code, childSignal }))
        },
      )
      if (signal.aborted)
        throw new RuntimeExecutionException({
          layer: 'runtime',
          code: signal.reason?.name === 'TimeoutError' ? 'RUNTIME_TIMEOUT' : 'RUN_CANCELLED',
          message: signal.reason?.name === 'TimeoutError' ? '运行超时' : '运行已取消',
          retryable: signal.reason?.name === 'TimeoutError',
          effectState: canChangeWorkspace(effects) ? 'unknown' : 'none',
        })
      if (outputLimitExceeded) throw new Error('RUNTIME_OUTPUT_LIMIT_EXCEEDED')
      const stderr = Buffer.concat(errors).toString('utf8').trim().slice(-800)
      if (result.code !== 0)
        throw new Error(
          `AGENT_CLI_EXITED:${result.code ?? result.childSignal ?? 'unknown'}${stderr ? `:${stderr}` : ''}`,
        )
      trace?.({ kind: 'stage', title: 'Agent 已返回结果', status: 'completed' })
      return Buffer.concat(output).toString('utf8')
    } finally {
      signal.removeEventListener('abort', relayAbort)
      terminate()
    }
  }
  private async runAcp(
    profile: RuntimeProfile,
    prompt: string,
    signal: AbortSignal,
    effects: CapabilityEffect[] = [],
    context?: { workspaceRoot: string },
    analysis?: RuntimeAnalysisOptions,
    trace?: AgentTraceReporter,
  ) {
    const cwd = analysis?.cwd ?? context?.workspaceRoot ?? profile.workingDirectory ?? process.cwd()
    const spec = this.launchSpec(profile, profile.args, cwd, ['pipe', 'pipe', 'pipe'], effects)
    const child = launchProcess(spec)
    let stderr = Buffer.alloc(0)
    let stderrText = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk])
      if (stderr.length > 65_536) stderr = stderr.subarray(stderr.length - 65_536)
      stderrText = stderr.toString('utf8')
    })
    const terminate = () => terminateProcess(child)
    const relayAbort = () => terminate()
    signal.addEventListener('abort', relayAbort, { once: true })
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveExit) =>
        child.once('exit', (code, childSignal) => resolveExit({ code, signal: childSignal })),
    )
    try {
      if (!child.stdin || !child.stdout) throw new Error('ACP_SERVER_STDIO_UNAVAILABLE')
      const stream = ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      )
      let permissionDenied = false
      trace?.({ kind: 'stage', title: '正在连接 Agent 会话', status: 'running' })
      return await acpClient({ name: 'CFlow' })
        .onRequest(methods.client.session.requestPermission, async (ctx: any) => {
          const tool = ctx?.params?.toolCall ?? ctx?.toolCall ?? {}
          const root = analysis?.allowedRoot ?? context?.workspaceRoot
          if (!isAcpToolAllowed(tool, effects, root, cwd, Boolean(analysis))) {
            permissionDenied = true
            const option = ctx?.params?.options?.find((o: any) =>
              String(o.kind).startsWith('reject'),
            )
            return option
              ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
              : { outcome: { outcome: 'cancelled' as const } }
          }
          const option = ctx?.params?.options?.find((o: any) => String(o.kind).startsWith('allow'))
          return option
            ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
            : { outcome: { outcome: 'cancelled' as const } }
        })
        .connectWith(stream, async (ctx) => {
          await ctx.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientInfo: { name: 'CFlow', version: ADAPTER_BUILD },
            clientCapabilities: {
              plan: {},
              session: {},
            },
          })
          return ctx.buildSession(cwd).withSession(async (session) => {
            const promptResult = session.prompt(prompt)
            let text = ''
            let analysisReported = false
            while (true) {
              const update = await session.nextUpdate()
              if (update.kind === 'stop') break
              const item: any = update.update
              const tag = item?.sessionUpdate
              if (tag === 'agent_message_chunk' && item.content?.type === 'text')
                text += item.content.text
              else if (tag === 'agent_thought_chunk' && !analysisReported) {
                analysisReported = true
                trace?.({ kind: 'stage', title: 'Agent 正在分析', status: 'running' })
              } else if (tag === 'plan')
                trace?.({
                  kind: 'plan',
                  title: 'Agent 制定了执行计划',
                  detail: item.entries?.map((entry: any) => entry.content).join('；'),
                  technical: item,
                })
              else if (tag === 'tool_call' || tag === 'tool_call_update')
                trace?.({
                  kind: 'tool',
                  title: item.title ?? item.name ?? 'Agent 工具调用',
                  detail: item.status ? `状态：${item.status}` : undefined,
                  status:
                    item.status === 'failed'
                      ? 'failed'
                      : item.status === 'completed'
                        ? 'completed'
                        : 'running',
                  technical: {
                    toolCallId: item.toolCallId,
                    input: item.rawInput,
                    output: item.rawOutput,
                    locations: item.locations,
                  },
                })
            }
            const response = await promptResult
            if (response.stopReason !== 'end_turn') {
              const reason = String(response.stopReason).toUpperCase()
              throw new RuntimeExecutionException({
                layer: 'adapter',
                code: permissionDenied ? 'PERMISSION_DENIED' : `ACP_STOP_${reason}`,
                message: permissionDenied
                  ? '无法执行请求的文件或命令操作：能力包未声明该权限或路径超出工作区。'
                  : reason === 'CANCELLED'
                    ? 'Agent 在执行过程中停止'
                    : `Agent 停止执行（${String(response.stopReason)}）`,
                retryable: false,
                effectState: permissionDenied ? 'none' : 'unknown',
              })
            }
            if (Buffer.byteLength(text, 'utf8') > profile.maxOutputBytes)
              throw new Error('RUNTIME_OUTPUT_LIMIT_EXCEEDED')
            trace?.({ kind: 'stage', title: 'Agent 已完成处理', status: 'completed' })
            return text
          })
        })
    } catch (error) {
      const detail = stderrText.trim().slice(-800)
      if (error instanceof Error) {
        if (signal.aborted)
          throw new RuntimeExecutionException({
            layer: 'runtime',
            code: signal.reason?.name === 'TimeoutError' ? 'RUNTIME_TIMEOUT' : 'RUN_CANCELLED',
            message: signal.reason?.name === 'TimeoutError' ? '运行超时' : '运行已取消',
            retryable: signal.reason?.name === 'TimeoutError',
            effectState: effects.some(
              (effect) => effect.type === 'file-write' || effect.type === 'command',
            )
              ? 'unknown'
              : 'none',
          })
        throw new Error(detail ? `${error.message}:${detail}` : error.message)
      }
      throw error
    } finally {
      signal.removeEventListener('abort', relayAbort)
      terminate()
      await Promise.race([
        exitPromise,
        new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500)),
      ])
    }
  }
}
