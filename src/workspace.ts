import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WorkspaceInfo } from './types.js'

const gitIgnoreStart = '# cflow:local-data'
const gitIgnoreEnd = '# /cflow:local-data'
const managedGitIgnore = `${gitIgnoreStart}
/cflow.sqlite
/cflow.sqlite-shm
/cflow.sqlite-wal
/cflow.sqlite-journal
/flows/
${gitIgnoreEnd}`

type InitializedWorkspace = WorkspaceInfo & { dataDirectory: string; databasePath: string }

export function isWithinDirectory(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

export function validateWorkspaceRoot(value: unknown, errorCode = 'FLOW_WORKSPACE_UNAVAILABLE') {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(errorCode)
  let normalized: string
  try {
    normalized = realpathSync(value)
    if (!statSync(normalized).isDirectory()) throw new Error(errorCode)
    accessSync(normalized, constants.R_OK | constants.W_OK)
  } catch {
    throw new Error(errorCode)
  }
  return normalized
}

export function requireWorkspaceRoot(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value))
    throw new Error('FLOW_WORKSPACE_REQUIRED')
  return value
}

function maintainWorkspaceGitIgnore(dataDirectory: string) {
  const file = join(dataDirectory, '.gitignore')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const start = current.indexOf(gitIgnoreStart)
  const end = current.indexOf(gitIgnoreEnd)
  let next: string
  if (start >= 0 && end >= start) {
    next = `${current.slice(0, start)}${managedGitIgnore}${current.slice(end + gitIgnoreEnd.length)}`
  } else {
    next = `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${managedGitIgnore}\n`
  }
  if (next !== current) writeFileSync(file, next)
}

export function initializeWorkspace(
  value = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): InitializedWorkspace {
  if (Object.prototype.hasOwnProperty.call(environment, 'CF_DB'))
    throw new Error('CF_DB_UNSUPPORTED')
  const root = validateWorkspaceRoot(resolve(value), 'WORKSPACE_UNAVAILABLE')
  const requestedDataDirectory = join(root, '.cflow')
  mkdirSync(requestedDataDirectory, { recursive: true })
  const dataDirectory = realpathSync(requestedDataDirectory)
  if (!isWithinDirectory(root, dataDirectory)) throw new Error('WORKSPACE_DATA_OUTSIDE_ROOT')
  accessSync(dataDirectory, constants.R_OK | constants.W_OK)
  maintainWorkspaceGitIgnore(dataDirectory)
  return {
    root,
    dataDirectory,
    databasePath: join(dataDirectory, 'cflow.sqlite'),
  }
}
