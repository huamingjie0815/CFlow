import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  ExecutorRuntimeTraits,
  Json,
  ResolvedResource,
  RuntimeHealth,
  RuntimeProfile,
  WorkspaceSettings,
} from './types.js'
import type { ExecutorRegistry } from './engine.js'
import { Store } from './db.js'

const ADAPTER_BUILD = 'cf-process-adapter/2'
const defaultTraits = (
  overrides: Partial<ExecutorRuntimeTraits> = {},
): ExecutorRuntimeTraits => ({
  backendKind: 'process',
  sessionMode: 'per-cf-call',
  structuredOutput: false,
  streaming: false,
  toolEvents: false,
  permissionPrompts: false,
  tokenAccounting: 'unavailable',
  cancellation: 'process-kill',
  filesystemIsolation: 'cwd-scoped',
  networkIsolation: 'unenforced',
  ...overrides,
})

export const defaultRuntimeProfiles = (): RuntimeProfile[] => {
  const createdAt = new Date(0).toISOString()
  return [
    {
      id: 'echo',
      profileVersion: 1,
      name: 'Local Echo',
      description: '用于离线验证编排与契约，不调用外部 agent。',
      enabled: true,
      backend: 'builtin',
      args: [],
      versionArgs: [],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 30_000,
      maxOutputBytes: 1_048_576,
      envAllowlist: [],
      capabilities: ['structured-output', 'offline-test'],
      traits: defaultTraits({
        backendKind: 'custom-sdk',
        sessionMode: 'stateless',
        structuredOutput: true,
        cancellation: 'cooperative',
        filesystemIsolation: 'sandboxed',
        networkIsolation: 'enforced',
      }),
      adapterBuild: ADAPTER_BUILD,
      createdAt,
    },
    {
      id: 'codex',
      profileVersion: 1,
      name: 'Codex',
      description: '通过本机 Codex CLI 执行 CF AgentStep。默认只读沙箱。',
      enabled: true,
      backend: 'process',
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '-',
      ],
      versionArgs: ['--version'],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576,
      envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL', 'CODEX_HOME', 'OPENAI_API_KEY'],
      capabilities: ['reasoning', 'code', 'structured-output', 'workspace-read'],
      traits: defaultTraits({
        backendKind: 'process',
        structuredOutput: true,
        streaming: false,
        toolEvents: false,
        permissionPrompts: false,
        tokenAccounting: 'unavailable',
        filesystemIsolation: 'sandboxed',
        networkIsolation: 'adapter-declared',
      }),
      adapterBuild: ADAPTER_BUILD,
      createdAt,
    },
    {
      id: 'claude-code',
      profileVersion: 1,
      name: 'Claude Code',
      description: '通过本机 Claude Code CLI 执行 CF AgentStep。默认使用 plan 权限模式。',
      enabled: true,
      backend: 'process',
      command: 'claude',
      args: ['--print', '--output-format', 'text', '--permission-mode', 'plan'],
      versionArgs: ['--version'],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576,
      envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL', 'ANTHROPIC_API_KEY'],
      capabilities: ['reasoning', 'code', 'structured-output', 'workspace-read'],
      traits: defaultTraits({
        backendKind: 'process',
        structuredOutput: true,
        streaming: false,
        toolEvents: false,
        permissionPrompts: false,
        tokenAccounting: 'unavailable',
        filesystemIsolation: 'cwd-scoped',
        networkIsolation: 'adapter-declared',
      }),
      adapterBuild: ADAPTER_BUILD,
      createdAt,
    },
  ]
}

export const defaultWorkspaceSettings = (): WorkspaceSettings => ({
  defaultRuntimeId: 'codex',
  workspaceRoot: process.cwd(),
  autoSaveDrafts: true,
  testTimeoutMs: 300_000,
  locale: 'zh-CN',
  updatedAt: new Date().toISOString(),
})

const cleanEnvironment = (allowlist: string[]) => {
  const env: NodeJS.ProcessEnv = {}
  for (const key of allowlist) if (process.env[key] !== undefined) env[key] = process.env[key]
  return env
}

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
    for (const profile of defaultRuntimeProfiles()) {
      const current = this.store.runtimeProfile(profile.id)
      if (!current) this.store.saveRuntimeProfile(profile)
      else if (current.adapterBuild !== ADAPTER_BUILD)
        this.store.saveRuntimeProfile({
          ...current,
          profileVersion: this.store.nextRuntimeProfileVersion(profile.id),
          traits: profile.traits,
          adapterBuild: ADAPTER_BUILD,
          createdAt: new Date().toISOString(),
        })
    }
    if (!this.store.settings()) this.store.saveSettings(defaultWorkspaceSettings())
  }
  profiles() {
    return this.store.currentRuntimeProfiles()
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
    if (!input.name?.trim() || input.name.trim().length > 80) throw new Error('RUNTIME_NAME_INVALID')
    const backend = input.backend ?? 'process'
    if (!['builtin', 'process'].includes(backend)) throw new Error('RUNTIME_BACKEND_INVALID')
    if (backend === 'builtin' && id !== 'echo') throw new Error('RUNTIME_BUILTIN_RESERVED')
    const command = input.command?.trim()
    if (backend === 'process' && !command) throw new Error('RUNTIME_COMMAND_REQUIRED')
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
      if (!Array.isArray(items) || items.length > max || items.some((value) => typeof value !== 'string'))
        throw new Error('RUNTIME_LIST_INVALID')
      return items.map((value) => value.trim()).filter(Boolean)
    }
    const previous = this.profile(id)
    const envAllowlist = safeList(input.envAllowlist ?? previous?.envAllowlist ?? ['PATH', 'HOME'], 40)
    if (envAllowlist.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      throw new Error('RUNTIME_ENV_NAME_INVALID')
    return {
      id,
      profileVersion: this.store.nextRuntimeProfileVersion(id),
      name: input.name.trim(),
      description: input.description?.trim().slice(0, 400),
      enabled: input.enabled ?? true,
      backend,
      command,
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
        execute: (task, input, signal, resources) =>
          this.executeProfile(profile, task, input, signal, resources),
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
    const cached = this.healthCache.get(id)
    if (!force && cached && cached.expires > Date.now()) return cached.value
    const started = Date.now()
    try {
      const version = await this.runProcess(profile, '', AbortSignal.timeout(5_000), true)
      const value: RuntimeHealth = {
        runtimeId: id,
        profileVersion: profile.profileVersion,
        status: 'available',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        version: String(version).trim().split('\n')[0].slice(0, 160),
      }
      this.healthCache.set(id, { expires: Date.now() + 10_000, value })
      return value
    } catch (error) {
      const value: RuntimeHealth = {
        runtimeId: id,
        profileVersion: profile.profileVersion,
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }
      this.healthCache.set(id, { expires: Date.now() + 10_000, value })
      return value
    }
  }
  async execute(
    id: string,
    task: string,
    input: Json,
    signal: AbortSignal,
    resources: ResolvedResource[] = [],
  ): Promise<Json> {
    const profile = this.profile(id)
    if (!profile) throw new Error(`UNKNOWN_EXECUTOR:${id}`)
    return this.executeProfile(profile, task, input, signal, resources)
  }
  private async executeProfile(
    profile: RuntimeProfile,
    task: string,
    input: Json,
    signal: AbortSignal,
    resources: ResolvedResource[] = [],
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
      resources.length
        ? `Authorized resources (do not access outside these scopes):\n${JSON.stringify(resources)}`
        : 'Authorized resources: none.',
    ].join('\n\n')
    const text = await this.runProcess(profile, prompt, signal, false)
    return profile.outputMode === 'json' ? parseJsonOutput(text) : { content: text.trim() }
  }
  private runProcess(
    profile: RuntimeProfile,
    prompt: string,
    signal: AbortSignal,
    versionOnly: boolean,
  ): Promise<string> {
    if (!profile.command) throw new Error('RUNTIME_COMMAND_REQUIRED')
    const args = versionOnly ? [...profile.versionArgs] : [...profile.args]
    if (!versionOnly && profile.model) {
      const placeholders = args.filter((arg) => arg.includes('{model}')).length
      if (placeholders) {
        for (let i = 0; i < args.length; i++) args[i] = args[i].replaceAll('{model}', profile.model)
      } else {
        const stdinMarker = profile.promptTransport === 'stdin' ? args.lastIndexOf('-') : -1
        const insertAt = stdinMarker >= 0 ? stdinMarker : args.length
        args.splice(insertAt, 0, '--model', profile.model)
      }
    }
    if (!versionOnly && profile.promptTransport === 'argument') args.push(prompt)
    const cwd = profile.workingDirectory ?? this.settings().workspaceRoot
    return new Promise((resolvePromise, reject) => {
      const child = spawn(profile.command!, args, {
        cwd,
        env: cleanEnvironment(profile.envAllowlist),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
      let stdout = Buffer.alloc(0)
      let stderr = Buffer.alloc(0)
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolvePromise(stdout.toString('utf8'))
      }
      const abort = () => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 1_000).unref()
        finish(new Error(signal.reason?.name === 'TimeoutError' ? 'RUNTIME_TIMEOUT' : 'ABORTED'))
      }
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 1_000).unref()
        finish(new Error('RUNTIME_TIMEOUT'))
      }, versionOnly ? 5_000 : profile.timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      child.on('error', (error) => finish(new Error(`RUNTIME_START_FAILED:${error.message}`)))
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = Buffer.concat([stdout, chunk])
        if (stdout.length > profile.maxOutputBytes) {
          child.kill('SIGTERM')
          finish(new Error('RUNTIME_OUTPUT_LIMIT_EXCEEDED'))
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk])
        if (stderr.length > 65_536) stderr = stderr.subarray(stderr.length - 65_536)
      })
      child.on('close', (code) => {
        if (code === 0) finish()
        else
          finish(
            new Error(
              `RUNTIME_EXIT_${code ?? 'UNKNOWN'}:${stderr.toString('utf8').trim().slice(-800)}`,
            ),
          )
      })
      if (!versionOnly && profile.promptTransport === 'stdin') child.stdin.end(prompt)
      else child.stdin.end()
      if (signal.aborted) abort()
    })
  }
}
