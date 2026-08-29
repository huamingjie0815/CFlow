import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, relative, resolve, sep } from 'node:path'
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
} from './types.js'
import type { ExecutorRegistry } from './engine.js'
import { Store } from './db.js'

const ADAPTER_BUILD = 'cf-acp-adapter/1'
export class RuntimeExecutionException extends Error {
  readonly details: import('./types.js').RuntimeExecutionError
  constructor(details: import('./types.js').RuntimeExecutionError) {
    super(details.message)
    this.name = 'RuntimeExecutionException'
    this.details = details
  }
}
const KNOWN_RUNTIME_IDS = new Set(['codex', 'claude-code'])
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

export const defaultRuntimeProfiles = (): RuntimeProfile[] => {
  const createdAt = new Date(0).toISOString()
  const discovered = new Set(discoverAcpCommands())
  const profile = (
    input: Pick<RuntimeProfile, 'id' | 'name' | 'description' | 'command' | 'envAllowlist'> &
      Partial<RuntimeProfile>,
  ): RuntimeProfile => ({
    profileVersion: 1,
    enabled: true,
    backend: 'acp',
    args: [],
    versionArgs: [],
    promptTransport: 'stdin',
    outputMode: 'json',
    timeoutMs: 300_000,
    maxOutputBytes: 1_048_576,
    capabilities: ['reasoning', 'code', 'structured-output', 'workspace-read'],
    traits: defaultTraits({
      backendKind: 'acp',
      structuredOutput: true,
      streaming: false,
      toolEvents: true,
      permissionPrompts: false,
      tokenAccounting: 'unavailable',
      cancellation: 'cooperative',
      filesystemIsolation: 'sandboxed',
      networkIsolation: 'adapter-declared',
    }),
    adapterBuild: ADAPTER_BUILD,
    createdAt,
    ...input,
  })
  const known = [
    profile({
      id: 'codex',
      name: 'Codex',
      description:
        '用本机已登录的 Codex 来执行步骤。默认只读；能力声明 workspace 写入后可修改工作区文件。',
      command: 'codex-acp',
      envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL', 'CODEX_HOME', 'OPENAI_API_KEY'],
      traits: defaultTraits({
        backendKind: 'acp',
        structuredOutput: true,
        streaming: false,
        toolEvents: true,
        permissionPrompts: false,
        tokenAccounting: 'approximate',
        cancellation: 'cooperative',
        filesystemIsolation: 'sandboxed',
        networkIsolation: 'adapter-declared',
      }),
    }),
    profile({
      id: 'claude-code',
      name: 'Claude Code',
      description: '用本机已登录的 Claude Code 来执行步骤。',
      command: 'claude-agent-acp',
      envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL', 'ANTHROPIC_API_KEY'],
    }),
  ].filter((candidate) => discovered.has(candidate.command!))
  const knownCommands = new Set(known.map((candidate) => candidate.command))
  const generic = [...discovered]
    .filter((command) => !knownCommands.has(command))
    .sort()
    .map((command) =>
      profile({
        id: runtimeIdFromCommand(command),
        name: runtimeNameFromCommand(command),
        description: `通过本机 ACP server ${command} 执行步骤。`,
        command,
        envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL'],
      }),
    )
  return [...known, ...generic]
}

export const defaultWorkspaceSettings = (defaultRuntimeId = 'codex'): WorkspaceSettings => ({
  defaultRuntimeId,
  workspaceRoot: process.cwd(),
  autoSaveDrafts: true,
  testTimeoutMs: 300_000,
  locale: 'zh-CN',
  updatedAt: new Date().toISOString(),
})

const isWithinDirectory = (root: string, candidate: string) => {
  const path = relative(resolve(root), resolve(candidate))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

const existingAbsoluteDirectory = (value: string, errorCode: string) => {
  if (!isAbsolute(value)) throw new Error(errorCode)
  try {
    if (!statSync(value).isDirectory()) throw new Error(errorCode)
  } catch {
    throw new Error(errorCode)
  }
  return resolve(value)
}

const existingExecutable = (value: string) => {
  try {
    if (statSync(value).isFile()) return value
  } catch {
    return undefined
  }
  return undefined
}

const executableExtensions = () => {
  const raw = process.env.PATHEXT?.trim() || '.COM;.EXE;.BAT;.CMD;.PS1'
  return [
    ...new Set(
      raw
        .split(';')
        .map((extension) => extension.trim().toLowerCase())
        .filter((extension) => extension.startsWith('.')),
    ),
  ]
}

const stripExecutableExtension = (command: string) => {
  const lower = command.toLowerCase()
  const extension = executableExtensions()
    .sort((a, b) => b.length - a.length)
    .find((candidate) => lower.endsWith(candidate))
  return extension ? command.slice(0, -extension.length) : command
}

const executableCandidates = (command: string) => {
  const lower = command.toLowerCase()
  if (executableExtensions().some((extension) => lower.endsWith(extension))) return [command]
  return [command, ...executableExtensions().map((extension) => `${command}${extension}`)]
}

const normalizedAcpCommand = (command: string) => {
  const normalized = stripExecutableExtension(command)
  return isAcpCommandName(normalized) ? normalized : undefined
}

const discoverAcpCommands = () => {
  const projectBin = resolve('node_modules', '.bin')
  const directories = [
    projectBin,
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((entry) => resolve(entry)),
  ]
  const commands = new Set<string>()
  const seen = new Set<string>()
  for (const directory of directories) {
    if (seen.has(directory)) continue
    seen.add(directory)
    try {
      for (const entry of readdirSync(directory)) {
        const command = normalizedAcpCommand(entry)
        if (!command) continue
        if (existingExecutable(resolve(directory, entry))) commands.add(command)
      }
    } catch {
      // Missing PATH entries are normal on developer machines.
    }
  }
  return [...commands]
}

const isAcpCommandName = (command: string) =>
  /^acp-[a-z0-9._-]+$/i.test(command) || /^[a-z0-9._-]+-acp$/i.test(command)

const runtimeIdFromCommand = (command: string) =>
  command
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

const runtimeNameFromCommand = (command: string) =>
  command
    .replace(/[-_.]+/g, ' ')
    .replace(/\bacp\b/gi, 'ACP')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const resolveExecutable = (
  command: string,
  env: Record<string, string>,
  options: { includeProjectBin?: boolean } = {},
) => {
  if (isAbsolute(command)) {
    for (const candidate of executableCandidates(command)) {
      const executable = existingExecutable(candidate)
      if (executable) return executable
    }
    return undefined
  }
  if (command.includes(sep)) {
    for (const candidate of executableCandidates(resolve(command))) {
      const executable = existingExecutable(candidate)
      if (executable) return executable
    }
    return undefined
  }
  const projectBin = resolve('node_modules', '.bin')
  if (options.includeProjectBin) {
    for (const candidate of executableCandidates(command)) {
      const localExecutable = existingExecutable(resolve(projectBin, candidate))
      if (localExecutable) return localExecutable
    }
  }
  for (const dir of (env.PATH ?? process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    if (!options.includeProjectBin && resolve(dir) === projectBin) continue
    for (const candidate of executableCandidates(command)) {
      const executable = existingExecutable(resolve(dir, candidate))
      if (executable) return executable
    }
  }
  return undefined
}

const needsWindowsShell = (executable: string) =>
  process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)

const parseJsonOutput = (text: string): Json => {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed
  try {
    return JSON.parse(fenced) as Json
  } catch {
    const start = Math.min(
      ...['{', '['].map((token) => {
        const index = fenced.indexOf(token)
        return index < 0 ? Number.POSITIVE_INFINITY : index
      }),
    )
    const end = Math.max(fenced.lastIndexOf('}'), fenced.lastIndexOf(']'))
    if (Number.isFinite(start) && end > start) {
      try {
        return JSON.parse(fenced.slice(start, end + 1)) as Json
      } catch {
        // Fall through to a loud structured-output error.
      }
    }
    throw new Error('RUNTIME_JSON_INVALID')
  }
}

export class RuntimeManager {
  private healthCache = new Map<string, { expires: number; value: RuntimeHealth }>()
  constructor(private store: Store) {
    this.ensureDefaults()
  }
  ensureDefaults() {
    const defaults = defaultRuntimeProfiles()
    for (const profile of defaults) {
      const current = this.store.runtimeProfile(profile.id)
      if (!current) this.store.saveRuntimeProfile(profile)
      else if (current.adapterBuild !== ADAPTER_BUILD)
        this.store.saveRuntimeProfile({
          ...current,
          ...profile,
          profileVersion: this.store.nextRuntimeProfileVersion(profile.id),
          createdAt: new Date().toISOString(),
        })
    }
    if (!this.store.settings())
      this.store.saveSettings(defaultWorkspaceSettings(defaults[0]?.id ?? 'codex'))
  }
  profiles() {
    return this.store
      .currentRuntimeProfiles()
      .filter((profile) => profile.backend === 'acp' || KNOWN_RUNTIME_IDS.has(profile.id))
  }
  profile(id: string) {
    return this.store.runtimeProfile(id)
  }
  settings() {
    return this.store.settings() ?? defaultWorkspaceSettings()
  }
  validateSettings(input: Partial<WorkspaceSettings>) {
    const previous = this.settings()
    const workspaceRoot = existingAbsoluteDirectory(
      String(input.workspaceRoot ?? previous.workspaceRoot),
      'WORKSPACE_ROOT_INVALID',
    )
    const defaultRuntimeId = String(input.defaultRuntimeId ?? previous.defaultRuntimeId)
    const defaultRuntime = this.profile(defaultRuntimeId)
    if (!defaultRuntime) throw new Error('DEFAULT_RUNTIME_NOT_FOUND')
    if (!defaultRuntime.enabled) throw new Error('DEFAULT_RUNTIME_DISABLED')
    for (const profile of this.profiles()) {
      if (profile.workingDirectory && !isWithinDirectory(workspaceRoot, profile.workingDirectory))
        throw new Error(`WORKSPACE_ROOT_RUNTIME_CONFLICT:${profile.id}`)
    }
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
      workspaceRoot,
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
    if (!input.name?.trim() || input.name.trim().length > 80)
      throw new Error('RUNTIME_NAME_INVALID')
    const backend = input.backend ?? 'acp'
    if (!['builtin', 'acp'].includes(backend)) throw new Error('RUNTIME_BACKEND_INVALID')
    if (backend === 'builtin' && id !== 'echo') throw new Error('RUNTIME_BUILTIN_RESERVED')
    const command = input.command?.trim()
    if (backend === 'acp' && !command) throw new Error('RUNTIME_COMMAND_REQUIRED')
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
    if (workingDirectory && !isWithinDirectory(this.settings().workspaceRoot, workingDirectory))
      throw new Error('RUNTIME_CWD_OUTSIDE_WORKSPACE')
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
    return {
      id,
      profileVersion: this.store.nextRuntimeProfileVersion(id),
      name: input.name.trim(),
      description: input.description?.trim().slice(0, 400),
      enabled: input.enabled ?? true,
      backend,
      command: backend === 'acp' ? (command ?? previous?.command ?? id) : command,
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
      traits: { ...defaultTraits(), ...(input.traits ?? previous?.traits ?? {}) },
      adapterBuild: ADAPTER_BUILD,
      createdAt: new Date().toISOString(),
    } satisfies RuntimeProfile
  }
  saveProfile(input: Partial<RuntimeProfile> & { id: string; name: string }) {
    const profile = this.validateProfile(input)
    this.store.saveRuntimeProfile(profile)
    this.healthCache.delete(profile.id)
    return profile
  }
  register(registry: ExecutorRegistry, profile: RuntimeProfile, exactOnly = false) {
    if (profile.backend === 'builtin') {
      const echo = {
        execute: async (task: string, input: Json) => ({ task, input }) as Json,
      }
      registry.register({ id: `${profile.id}@${profile.profileVersion}`, ...echo })
      if (!exactOnly) registry.register({ id: profile.id, ...echo })
      return
    }
    const executor = (id: string) =>
      registry.register({
        id,
        execute: (task, input, signal, resources, effects) =>
          this.executeProfile(profile, task, input, signal, resources, undefined, effects),
      })
    executor(`${profile.id}@${profile.profileVersion}`)
    if (!exactOnly) executor(profile.id)
  }
  registerAll(registry: ExecutorRegistry) {
    const current = new Map(this.profiles().map((profile) => [profile.id, profile.profileVersion]))
    for (const profile of this.store.allRuntimeProfiles())
      this.register(registry, profile, current.get(profile.id) !== profile.profileVersion)
  }
  async health(id: string, force = false): Promise<RuntimeHealth> {
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
        return {
          runtimeId: id,
          profileVersion: profile.profileVersion,
          status: 'available',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          version: this.acpVersion(profile),
        }
      } catch (error) {
        return {
          runtimeId: id,
          profileVersion: profile.profileVersion,
          status: 'unavailable',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
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
  ): Promise<Json> {
    const profile = this.profile(id)
    if (!profile) throw new Error(`UNKNOWN_EXECUTOR:${id}`)
    return this.executeProfile(profile, task, input, signal, resources, outputSchema)
  }
  private async executeProfile(
    profile: RuntimeProfile,
    task: string,
    input: Json,
    signal: AbortSignal,
    resources: ResolvedResource[] = [],
    outputSchema?: Record<string, unknown>,
    effects: CapabilityEffect[] = [],
  ): Promise<Json> {
    if (!profile.enabled) throw new Error(`RUNTIME_DISABLED:${profile.id}`)
    if (profile.backend === 'builtin') return { task, input }
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
        ? `Declared effects (authorized within workspace root ${this.settings().workspaceRoot}):\n${JSON.stringify(effects)}\nYou may perform these declared effects when required by the task; do not ask the user for a second authorization.`
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
        ? await this.runAcp(profile, prompt, signal, effects)
        : await Promise.reject(new Error(`RUNTIME_BACKEND_UNSUPPORTED:${profile.backend}`))
    return profile.outputMode === 'json' ? parseJsonOutput(text) : { content: text.trim() }
  }
  private acpVersion(profile: RuntimeProfile) {
    const bottom =
      profile.id === 'codex'
        ? `CODEX_PATH=${this.codexPath()}`
        : profile.id === 'claude-code'
          ? `CLAUDE_CODE_EXECUTABLE=${this.claudePath()}`
          : undefined
    return [`acp via ${this.acpCommand(profile)}`, bottom ? `(${bottom})` : undefined]
      .filter(Boolean)
      .join(' ')
  }
  private acpCommand(profile: RuntimeProfile) {
    if (!profile.command) throw new Error('RUNTIME_COMMAND_REQUIRED')
    const env = this.acpEnvironment(profile)
    const resolved = resolveExecutable(profile.command, env, { includeProjectBin: true })
    if (!resolved) throw new Error(`ACP_SERVER_NOT_FOUND:${profile.command}`)
    return resolved
  }
  private codexPath() {
    const env = { ...process.env } as Record<string, string>
    const command = process.env.CFLOW_CODEX_PATH ?? process.env.CODEX_PATH ?? 'codex'
    const resolved = resolveExecutable(command, env)
    if (!resolved) throw new Error(`CODEX_CLI_NOT_FOUND:${command}`)
    return resolved
  }
  private claudePath() {
    const env = { ...process.env } as Record<string, string>
    const command = process.env.CFLOW_CLAUDE_PATH ?? process.env.CLAUDE_CODE_EXECUTABLE ?? 'claude'
    const resolved = resolveExecutable(command, env)
    if (!resolved) throw new Error(`CLAUDE_CODE_CLI_NOT_FOUND:${command}`)
    return resolved
  }
  private acpEnvironment(profile: RuntimeProfile, effects: CapabilityEffect[] = []) {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    if (profile.id === 'codex') {
      env.CODEX_PATH = this.codexPath()
      env.INITIAL_AGENT_MODE = effects.some((effect) => effect.type === 'file-write')
        ? 'workspace-write'
        : 'read-only'
      env.NO_BROWSER ??= '1'
      if (profile.model) env.CODEX_CONFIG = JSON.stringify({ model: profile.model })
    }
    if (profile.id === 'claude-code') {
      env.CLAUDE_CODE_EXECUTABLE = this.claudePath()
      if (profile.model) env.CLAUDE_MODEL_CONFIG = JSON.stringify({ model: profile.model })
    }
    return env
  }
  private async runAcp(
    profile: RuntimeProfile,
    prompt: string,
    signal: AbortSignal,
    effects: CapabilityEffect[] = [],
  ) {
    const cwd = profile.workingDirectory ?? this.settings().workspaceRoot
    const command = this.acpCommand(profile)
    const child = spawn(command, profile.args, {
      cwd,
      env: this.acpEnvironment(profile, effects),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: needsWindowsShell(command),
      windowsHide: true,
    })
    let stderr = Buffer.alloc(0)
    let stderrText = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk])
      if (stderr.length > 65_536) stderr = stderr.subarray(stderr.length - 65_536)
      stderrText = stderr.toString('utf8')
    })
    const terminate = () => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref()
    }
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
      return await acpClient({ name: 'CFlow' })
        .onRequest(methods.client.session.requestPermission, async (ctx: any) => {
          const tool = ctx?.params?.toolCall ?? ctx?.toolCall ?? {}
          const kind = String(tool.kind ?? tool.name ?? tool.title ?? '').toLowerCase()
          const effectType =
            kind.includes('read') || kind.includes('search')
              ? 'file-read'
              : kind.includes('edit') ||
                  kind.includes('write') ||
                  kind.includes('delete') ||
                  kind.includes('move')
                ? 'file-write'
                : kind.includes('exec') || kind.includes('command') || kind.includes('terminal')
                  ? 'command'
                  : undefined
          const declared = effectType
            ? effects.some((effect) => effect.type === effectType && effect.scope === 'workspace')
            : false
          const locations = Array.isArray(tool.locations) ? [...tool.locations] : []
          const raw = tool.rawInput
          if (raw && typeof raw === 'object') {
            for (const key of ['path', 'file', 'filePath', 'filename']) {
              const value = (raw as any)[key]
              if (typeof value === 'string') locations.push(value)
            }
          }
          const root = this.settings().workspaceRoot
          const inWorkspace = locations.every((location: any) => {
            let value = typeof location === 'string' ? location : (location?.path ?? location?.uri)
            if (typeof value === 'string' && value.startsWith('file://')) {
              try {
                value = new URL(value).pathname
              } catch {
                return false
              }
            }
            return !value || isWithinDirectory(root, value)
          })
          if (!declared || !inWorkspace) {
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
            const text = await session.readText()
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
