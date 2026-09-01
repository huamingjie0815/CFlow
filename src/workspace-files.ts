import { lstat, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.cflow',
  'node_modules',
  'dist',
  'build',
  'coverage',
])
const RESULT_LIMIT = 200

function normalizedRelativePath(value: string) {
  const path = value.trim().replaceAll('\\', '/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  if (parts.some((part) => EXCLUDED_DIRECTORIES.has(part))) return null
  return path
}

async function isWorkspaceFile(root: string, path: string) {
  const normalized = normalizedRelativePath(path)
  if (!normalized) return false
  const target = resolve(root, ...normalized.split('/'))
  try {
    const [stat, resolvedTarget] = await Promise.all([lstat(target), realpath(target)])
    const scope = relative(root, resolvedTarget)
    return (
      stat.isFile() && scope !== '..' && !scope.startsWith(`..${sep}`) && !scope.startsWith(sep)
    )
  } catch {
    return false
  }
}

async function indexedFiles(root: string) {
  const files: string[] = []
  const walk = async (directory: string, prefix: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await walk(resolve(directory, entry.name), path)
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
  }
  await walk(root, '')
  return files.sort((left, right) => left.localeCompare(right))
}

export async function searchWorkspaceFiles(
  root: string,
  input: { query?: string; selected?: string[] },
) {
  const query = String(input.query ?? '')
    .trim()
    .toLocaleLowerCase()
  const safeSelected = [
    ...new Set((input.selected ?? []).map(normalizedRelativePath).filter(Boolean)),
  ] as string[]
  const files = await indexedFiles(root)
  const filtered = query ? files.filter((path) => path.toLocaleLowerCase().includes(query)) : files
  const missing: string[] = []
  for (const path of safeSelected) if (!(await isWorkspaceFile(root, path))) missing.push(path)
  return {
    matches: filtered.slice(0, RESULT_LIMIT),
    missing,
    truncated: filtered.length > RESULT_LIMIT,
  }
}

export async function missingWorkspaceFiles(root: string, paths: string[]) {
  const missing: string[] = []
  for (const path of paths) if (!(await isWorkspaceFile(root, path))) missing.push(path)
  return missing
}
