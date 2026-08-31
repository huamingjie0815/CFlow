import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CapabilityEffect, Json } from './types.js'

/**
 * Process-level helpers shared by the ACP and CLI runtime adapters: locating an
 * executable without a shell, discovering ACP servers on PATH, and reading a
 * structured answer out of an agent's stdout.
 */

/** Package root, so bundled adapter binaries resolve in dev and after build. */
const runtimePackageRoot = (() => {
  const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
  return currentDirectory.includes(`${sep}dist${sep}`)
    ? resolve(currentDirectory, '..', '..')
    : resolve(currentDirectory, '..')
})()

export const existingAbsoluteDirectory = (value: string, errorCode: string) => {
  if (!isAbsolute(value)) throw new Error(errorCode)
  try {
    if (!statSync(value).isDirectory()) throw new Error(errorCode)
  } catch {
    throw new Error(errorCode)
  }
  return resolve(value)
}

export const existingExecutable = (value: string) => {
  try {
    if (statSync(value).isFile()) {
      accessSync(value, constants.X_OK)
      return value
    }
  } catch {
    return undefined
  }
  return undefined
}

export const executableExtensions = () => {
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

export const stripExecutableExtension = (command: string) => {
  const lower = command.toLowerCase()
  const extension = executableExtensions()
    .sort((a, b) => b.length - a.length)
    .find((candidate) => lower.endsWith(candidate))
  return extension ? command.slice(0, -extension.length) : command
}

export const executableCandidates = (command: string) => {
  const lower = command.toLowerCase()
  if (executableExtensions().some((extension) => lower.endsWith(extension))) return [command]
  return [command, ...executableExtensions().map((extension) => `${command}${extension}`)]
}

export const normalizedAcpCommand = (command: string) => {
  const normalized = stripExecutableExtension(command)
  return isAcpCommandName(normalized) ? normalized : undefined
}

export const discoverAcpCommands = (projectRoot = process.cwd()) => {
  const projectBin = resolve(projectRoot, 'node_modules', '.bin')
  const bundledBin = resolve(runtimePackageRoot, 'node_modules', '.bin')
  const directories = [
    bundledBin,
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

export const resolveExecutable = (
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
  const localBins = [
    resolve(runtimePackageRoot, 'node_modules', '.bin'),
    resolve('node_modules', '.bin'),
  ]
  if (options.includeProjectBin) {
    for (const directory of localBins) {
      for (const candidate of executableCandidates(command)) {
        const localExecutable = existingExecutable(resolve(directory, candidate))
        if (localExecutable) return localExecutable
      }
    }
  }
  for (const dir of (env.PATH ?? process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    if (!options.includeProjectBin && localBins.includes(resolve(dir))) continue
    for (const candidate of executableCandidates(command)) {
      const executable = existingExecutable(resolve(dir, candidate))
      if (executable) return executable
    }
  }
  return undefined
}

export const needsWindowsShell = (executable: string) =>
  process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)

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
