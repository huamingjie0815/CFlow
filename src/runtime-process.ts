import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import crossSpawn from 'cross-spawn'
import type { CapabilityEffect, Json } from './types.js'

/** Package root, so bundled adapter binaries resolve in dev and after build. */
export const runtimePackageRoot = (() => {
  const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
  return currentDirectory.includes(`${sep}dist${sep}`)
    ? resolve(currentDirectory, '..', '..')
    : resolve(currentDirectory, '..')
})()

export type CommandSource =
  'explicit' | 'bundled-bin' | 'project-bin' | 'path' | 'windows-appdata' | 'common-path'

export type ResolvedCommand = {
  requested: string
  executable: string
  launchType: 'native' | 'windows-command'
  source: CommandSource
}

export type CommandResolutionOptions = {
  bundledRoot?: string
  env?: NodeJS.ProcessEnv
  excludedSources?: CommandSource[]
  platform?: NodeJS.Platform
  projectRoot?: string
}

export type LaunchSpec = {
  resolved: ResolvedCommand
  args: string[]
  cwd: string
  env: Record<string, string>
  stdio: SpawnOptions['stdio']
}

export const existingAbsoluteDirectory = (value: string, errorCode: string) => {
  if (!isAbsolute(value)) throw new Error(errorCode)
  try {
    if (!statSync(value).isDirectory()) throw new Error(errorCode)
  } catch {
    throw new Error(errorCode)
  }
  return resolve(value)
}

export const existingExecutable = (value: string, platform = process.platform) => {
  try {
    if (!statSync(value).isFile()) return undefined
    if (platform !== 'win32') accessSync(value, constants.X_OK)
    return value
  } catch {
    return undefined
  }
}

const windowsExecutableExtensions = (env: NodeJS.ProcessEnv = process.env) => {
  const configured = (env.PATHEXT ?? '.COM;.EXE;.CMD;.BAT')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => ['.com', '.exe', '.cmd', '.bat'].includes(extension))
  return [...new Set([...configured, '.com', '.exe', '.cmd', '.bat'])]
}

export const executableExtensions = (
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) => (platform === 'win32' ? windowsExecutableExtensions(env) : [])

export const stripExecutableExtension = (
  command: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const lower = command.toLowerCase()
  const extension = executableExtensions(platform, env)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => lower.endsWith(candidate))
  return extension ? command.slice(0, -extension.length) : command
}

export const executableCandidates = (
  command: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (platform !== 'win32') return [command]
  const lower = command.toLowerCase()
  if (/\.ps1$/i.test(lower)) return []
  if (executableExtensions(platform, env).some((extension) => lower.endsWith(extension)))
    return [command]
  return executableExtensions(platform, env).map((extension) => `${command}${extension}`)
}

export const normalizedAcpCommand = (
  command: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const normalized = stripExecutableExtension(command, platform, env)
  return isAcpCommandName(normalized) ? normalized : undefined
}

const uniqueDirectories = (values: { directory: string; source: CommandSource }[]) => {
  const seen = new Set<string>()
  return values.filter(({ directory }) => {
    const normalized = resolve(directory)
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export const commandSearchDirectories = (options: CommandResolutionOptions = {}) => {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const packageRoot = resolve(options.bundledRoot ?? runtimePackageRoot)
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  const values: { directory: string; source: CommandSource }[] = [
    { directory: join(packageRoot, 'node_modules', '.bin'), source: 'bundled-bin' },
    { directory: join(projectRoot, 'node_modules', '.bin'), source: 'project-bin' },
    ...(env.PATH ?? '')
      .split(pathDelimiter)
      .filter(Boolean)
      .map((directory) => ({ directory, source: 'path' as const })),
  ]
  if (platform === 'win32' && env.APPDATA)
    values.push({ directory: join(env.APPDATA, 'npm'), source: 'windows-appdata' })
  if (platform !== 'win32') {
    const userHome = env.HOME ?? homedir()
    values.push(
      { directory: join(userHome, '.local', 'bin'), source: 'common-path' },
      { directory: join(userHome, '.cargo', 'bin'), source: 'common-path' },
      { directory: join(userHome, '.npm-global', 'bin'), source: 'common-path' },
      { directory: join(userHome, 'Library', 'pnpm'), source: 'common-path' },
      { directory: '/opt/homebrew/bin', source: 'common-path' },
      { directory: '/usr/local/bin', source: 'common-path' },
      { directory: '/usr/bin', source: 'common-path' },
    )
  }
  const excludedSources = new Set(options.excludedSources ?? [])
  const excludedDirectories = new Set<string>()
  if (excludedSources.has('bundled-bin'))
    excludedDirectories.add(resolve(packageRoot, 'node_modules', '.bin'))
  if (excludedSources.has('project-bin'))
    excludedDirectories.add(resolve(projectRoot, 'node_modules', '.bin'))
  return uniqueDirectories(
    values.filter(
      ({ directory, source }) =>
        !excludedSources.has(source) && !excludedDirectories.has(resolve(directory)),
    ),
  )
}

export const resolveCommand = (
  command: string,
  options: CommandResolutionOptions = {},
): ResolvedCommand | undefined => {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const launchType = (candidate: string): ResolvedCommand['launchType'] =>
    platform === 'win32' && /\.(?:cmd|bat)$/i.test(candidate) ? 'windows-command' : 'native'
  const direct = isAbsolute(command) || command.includes('/') || command.includes('\\')
  if (direct) {
    const target = isAbsolute(command)
      ? command
      : resolve(options.projectRoot ?? process.cwd(), command)
    for (const candidate of executableCandidates(target, platform, env)) {
      const executable = existingExecutable(candidate, platform)
      if (executable)
        return {
          requested: command,
          executable,
          launchType: launchType(candidate),
          source: 'explicit',
        }
    }
    return undefined
  }
  for (const { directory, source } of commandSearchDirectories(options)) {
    for (const candidate of executableCandidates(command, platform, env)) {
      const executable = existingExecutable(join(directory, candidate), platform)
      if (executable)
        return { requested: command, executable, launchType: launchType(candidate), source }
    }
  }
  return undefined
}

export const resolveCommandAliases = (
  commands: string[],
  options: CommandResolutionOptions = {},
) => {
  for (const command of commands) {
    const resolved = resolveCommand(command, options)
    if (resolved) return resolved
  }
  return undefined
}

export const describeResolvedCommand = (command: ResolvedCommand) =>
  `${command.launchType} ${command.executable} (${command.source})`

export const launchProcess = (spec: LaunchSpec): ChildProcess =>
  crossSpawn(spec.resolved.executable, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: spec.stdio,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })

const terminatingProcesses = new WeakSet<ChildProcess>()

export const terminateProcess = (child: ChildProcess) => {
  if (
    !child.pid ||
    child.exitCode !== null ||
    child.signalCode !== null ||
    terminatingProcesses.has(child)
  )
    return
  terminatingProcesses.add(child)
  if (process.platform === 'win32') {
    const killer = crossSpawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    const fallback = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
    killer.once('error', fallback)
    killer.once('exit', (code) => {
      if (code !== 0) fallback()
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 1_000).unref()
}

export const discoverAcpCommands = (options: CommandResolutionOptions = {}) => {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const commands = new Set<string>()
  for (const { directory } of commandSearchDirectories(options)) {
    try {
      for (const entry of readdirSync(directory)) {
        const command = normalizedAcpCommand(entry, platform, env)
        if (!command) continue
        if (resolveCommand(join(directory, entry), options)) commands.add(command)
      }
    } catch {
      // Missing search directories are normal on developer machines.
    }
  }
  return [...commands]
}

export const isAcpCommandName = (command: string) =>
  /^acp-[a-z0-9._-]+$/i.test(command) || /^[a-z0-9._-]+-acp$/i.test(command)

export const runtimeIdFromCommand = (command: string) =>
  command
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

export const runtimeNameFromCommand = (command: string) =>
  command
    .replace(/[-_.]+/g, ' ')
    .replace(/\bacp\b/gi, 'ACP')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const canChangeWorkspace = (effects: CapabilityEffect[]) =>
  effects.some((effect) => effect.type === 'file-write' || effect.type === 'command')

export const parseJsonOutput = (text: string): Json => {
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
