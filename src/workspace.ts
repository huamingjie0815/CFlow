import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

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
