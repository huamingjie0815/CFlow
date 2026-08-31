import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  ExecutorRuntimeTraits,
  RuntimeBackendKind,
  RuntimeDiscoverySource,
  RuntimeOutputMode,
  RuntimePermissionMode,
  RuntimePromptTransport,
} from './types.js'

export type AgentManifest = {
  schemaVersion: 1
  id: string
  name: string
  description?: string
  backend: Exclude<RuntimeBackendKind, 'builtin'>
  command: string
  args?: string[]
  versionArgs?: string[]
  promptTransport?: RuntimePromptTransport
  outputMode?: RuntimeOutputMode
  timeoutMs?: number
  maxOutputBytes?: number
  envAllowlist?: string[]
  capabilities?: string[]
  permissionArgs?: Partial<Record<RuntimePermissionMode, string[]>>
  traits?: Partial<ExecutorRuntimeTraits>
}

export type AgentManifestRecord = {
  manifest: AgentManifest
  source: RuntimeDiscoverySource
  manifestPath?: string
  manifestHash: string
}

export type AgentManifestLoadOptions = {
  projectRoot?: string
  userManifestDirectory?: string | false
  projectManifestDirectory?: string | false
  packageRoot?: string | false
  includeBuiltins?: boolean
}

const builtinManifests: AgentManifest[] = [
  {
    schemaVersion: 1,
    id: 'codex',
    name: 'Codex',
    description:
      '用本机已登录的 Codex 来执行步骤。默认只读；能力声明 workspace 写入后可修改工作区文件。',
    backend: 'acp',
    command: 'codex-acp',
    envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL', 'CODEX_HOME', 'OPENAI_API_KEY'],
    capabilities: ['reasoning', 'code', 'structured-output', 'workspace-read'],
    traits: { tokenAccounting: 'approximate' },
  },
  {
    schemaVersion: 1,
    id: 'claude-code',
    name: 'Claude Code',
    description: '用本机已登录的 Claude Code 来执行步骤。',
    backend: 'acp',
    command: 'claude-agent-acp',
    envAllowlist: ['HOME', 'PATH', 'LANG', 'LC_ALL', 'ANTHROPIC_API_KEY'],
    capabilities: ['reasoning', 'code', 'structured-output', 'workspace-read'],
  },
]

const manifestHash = (manifest: AgentManifest) =>
  createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16)

const stringValue = (value: unknown, name: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${name}_INVALID`)
  if (value.includes('\0')) throw new Error(`${name}_INVALID`)
  return value.trim()
}

const stringList = (value: unknown, name: string, maxItems: number) => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name}_INVALID`)
  return value.map((item) => stringValue(item, name, 500))
}

const numberValue = (value: unknown, name: string, minimum: number, maximum: number) => {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${name}_INVALID`)
  return parsed
}

const traitValue = <K extends keyof ExecutorRuntimeTraits>(
  traits: Record<string, unknown>,
  key: K,
  allowed: readonly ExecutorRuntimeTraits[K][],
) => {
  const value = traits[key]
  if (value === undefined) return undefined
  if (!allowed.includes(value as ExecutorRuntimeTraits[K])) throw new Error('TRAITS_INVALID')
  return value as ExecutorRuntimeTraits[K]
}

const normalizeTraits = (value: unknown): Partial<ExecutorRuntimeTraits> | undefined => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TRAITS_INVALID')
  const traits = value as Record<string, unknown>
  const normalized = {
    backendKind: traitValue(traits, 'backendKind', ['acp', 'process']),
    sessionMode: traitValue(traits, 'sessionMode', ['stateless', 'per-cf-call', 'persistent']),
    structuredOutput: traitValue(traits, 'structuredOutput', [true, false]),
    streaming: traitValue(traits, 'streaming', [true, false]),
    toolEvents: traitValue(traits, 'toolEvents', [true, false]),
    permissionPrompts: traitValue(traits, 'permissionPrompts', [true, false]),
    tokenAccounting: traitValue(traits, 'tokenAccounting', ['exact', 'approximate', 'unavailable']),
    cancellation: traitValue(traits, 'cancellation', [
      'cooperative',
      'process-kill',
      'unsupported',
    ]),
    filesystemIsolation: traitValue(traits, 'filesystemIsolation', [
      'sandboxed',
      'cwd-scoped',
      'host-permissions',
    ]),
    networkIsolation: traitValue(traits, 'networkIsolation', [
      'enforced',
      'adapter-declared',
      'unenforced',
    ]),
  }
  return Object.fromEntries(
    Object.entries(normalized).filter(([, item]) => item !== undefined),
  ) as Partial<ExecutorRuntimeTraits>
}

const normalizePermissionArgs = (
  value: unknown,
): Partial<Record<RuntimePermissionMode, string[]>> | undefined => {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PERMISSION_ARGS_INVALID')
  const input = value as Record<string, unknown>
  const output: Partial<Record<RuntimePermissionMode, string[]>> = {}
  for (const mode of ['none', 'read', 'write', 'full'] as const) {
    const args = stringList(input[mode], 'PERMISSION_ARGS', 30)
    if (args) output[mode] = args
  }
  return output
}

const normalizeManifest = (value: unknown, baseDirectory?: string): AgentManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OBJECT_INVALID')
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== 1) throw new Error('SCHEMA_VERSION_UNSUPPORTED')
  const id = stringValue(input.id, 'ID', 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('ID_INVALID')
  const backend = input.backend
  if (backend !== 'acp' && backend !== 'cli') throw new Error('BACKEND_INVALID')
  const rawCommand = stringValue(input.command, 'COMMAND', 500)
  const command =
    baseDirectory &&
    !isAbsolute(rawCommand) &&
    (rawCommand.startsWith('./') || rawCommand.startsWith('../'))
      ? resolve(baseDirectory, rawCommand)
      : rawCommand
  const promptTransport = input.promptTransport
  if (
    promptTransport !== undefined &&
    promptTransport !== 'stdin' &&
    promptTransport !== 'argument'
  )
    throw new Error('PROMPT_TRANSPORT_INVALID')
  const outputMode = input.outputMode
  if (outputMode !== undefined && outputMode !== 'json' && outputMode !== 'text')
    throw new Error('OUTPUT_MODE_INVALID')
  const envAllowlist = stringList(input.envAllowlist, 'ENV_ALLOWLIST', 40)
  if (envAllowlist?.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    throw new Error('ENV_ALLOWLIST_INVALID')
  return {
    schemaVersion: 1,
    id,
    name: stringValue(input.name, 'NAME', 80),
    description:
      input.description === undefined
        ? undefined
        : stringValue(input.description, 'DESCRIPTION', 400),
    backend,
    command,
    args: stringList(input.args, 'ARGS', 40),
    versionArgs: stringList(input.versionArgs, 'VERSION_ARGS', 10),
    promptTransport,
    outputMode,
    timeoutMs: numberValue(input.timeoutMs, 'TIMEOUT', 1_000, 3_600_000),
    maxOutputBytes: numberValue(input.maxOutputBytes, 'OUTPUT_LIMIT', 1_024, 16_777_216),
    envAllowlist,
    capabilities: stringList(input.capabilities, 'CAPABILITIES', 40),
    permissionArgs: normalizePermissionArgs(input.permissionArgs),
    traits: normalizeTraits(input.traits),
  }
}

const record = (
  value: unknown,
  source: RuntimeDiscoverySource,
  manifestPath?: string,
  baseDirectory?: string,
): AgentManifestRecord => {
  const manifest = normalizeManifest(value, baseDirectory)
  return { manifest, source, manifestPath, manifestHash: manifestHash(manifest) }
}

const manifestFiles = (directory: string | false) => {
  if (!directory || !existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(directory, name))
}

const packageJsonFiles = (packageRoot: string | false) => {
  if (!packageRoot || !existsSync(packageRoot)) return []
  const files: string[] = []
  for (const name of readdirSync(packageRoot).sort()) {
    if (name === '.bin' || name.startsWith('.')) continue
    const candidate = join(packageRoot, name)
    try {
      if (name.startsWith('@') && statSync(candidate).isDirectory()) {
        for (const child of readdirSync(candidate).sort())
          files.push(join(candidate, child, 'package.json'))
      } else files.push(join(candidate, 'package.json'))
    } catch {
      // Broken package links are ignored during discovery.
    }
  }
  return files.filter(existsSync)
}

export function loadAgentManifestRecords(options: AgentManifestLoadOptions = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const userDirectory =
    options.userManifestDirectory === false
      ? false
      : resolve(
          options.userManifestDirectory ??
            join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'cflow', 'agents.d'),
        )
  const projectDirectory =
    options.projectManifestDirectory === false
      ? false
      : resolve(options.projectManifestDirectory ?? join(projectRoot, '.cflow', 'agents.d'))
  const packageRoot =
    options.packageRoot === false
      ? false
      : resolve(options.packageRoot ?? join(projectRoot, 'node_modules'))
  const records: AgentManifestRecord[] = []
  const warnings: string[] = []
  if (options.includeBuiltins !== false)
    for (const manifest of builtinManifests)
      records.push(record(manifest, 'builtin', `builtin:${manifest.id}`))

  const addValues = (
    values: unknown,
    source: RuntimeDiscoverySource,
    manifestPath: string,
    baseDirectory: string,
  ) => {
    const manifests = Array.isArray(values) ? values : [values]
    for (const value of manifests) {
      try {
        records.push(record(value, source, manifestPath, baseDirectory))
      } catch (error) {
        warnings.push(`${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  for (const packageJson of packageJsonFiles(packageRoot)) {
    try {
      const value = JSON.parse(readFileSync(packageJson, 'utf8')) as { cflowAgent?: unknown }
      if (value.cflowAgent !== undefined)
        addValues(value.cflowAgent, 'package-manifest', packageJson, dirname(packageJson))
    } catch {
      // A package without readable metadata is unrelated unless it advertises cflowAgent.
    }
  }
  for (const [directory, source] of [
    [userDirectory, 'user-manifest'],
    [projectDirectory, 'project-manifest'],
  ] as const) {
    for (const manifestPath of manifestFiles(directory)) {
      try {
        addValues(
          JSON.parse(readFileSync(manifestPath, 'utf8')),
          source,
          manifestPath,
          dirname(manifestPath),
        )
      } catch (error) {
        warnings.push(`${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const selected = new Map<string, AgentManifestRecord>()
  for (const candidate of records) selected.set(candidate.manifest.id, candidate)
  return { records: [...selected.values()], warnings }
}
