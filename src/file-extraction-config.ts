import type { FileExtractionInput, Json } from './types.js'

export const FILE_EXTRACT_CF_ID = 'builtin:file.extract-text'
export const FILE_EXTRACT_VERSION = '1.0.0'
export const EXTRACTION_LIMITS = {
  files: 100,
  fileBytes: 50 * 1024 * 1024,
  decompressedBytes: 256 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
  timeoutMs: 60_000,
} as const
export const EXTRACTION_FORMATS = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'csv',
  'md',
  'html',
  'txt',
  'json',
  'xml',
]

export function assertExtractionInput(
  value: FileExtractionInput | undefined,
): asserts value is FileExtractionInput {
  const fail = () => {
    throw new Error('请选择待解析文件或配置文件路径来源。')
  }
  if (!value || !value.source) return fail()
  const source = value.source
  if (source.kind === 'files') {
    if (
      !Array.isArray(source.paths) ||
      !source.paths.length ||
      source.paths.length > EXTRACTION_LIMITS.files ||
      source.paths.some((path) => typeof path !== 'string' || !path.trim())
    )
      fail()
  } else if (source.kind === 'flow-input' || source.kind === 'upstream') {
    if (
      typeof source.pointer !== 'string' ||
      (source.pointer !== '' && !source.pointer.startsWith('/')) ||
      /~(?![01])/u.test(source.pointer)
    )
      fail()
    if (source.kind === 'upstream' && (typeof source.nodeId !== 'string' || !source.nodeId.trim()))
      fail()
  } else fail()
  if (value.encoding !== undefined && !['utf-8', 'gb18030'].includes(value.encoding))
    throw new Error('文本编码无效。')
  if (value.maxChars !== undefined && (!Number.isSafeInteger(value.maxChars) || value.maxChars < 1))
    throw new Error('字符上限必须为正整数。')
}

export function resolveExtractionPaths(config: FileExtractionInput, input: Json): string[] {
  assertExtractionInput(config)
  const source = config.source
  let paths: unknown
  if (source.kind === 'files') paths = source.paths
  else {
    const context = input as { flowInput?: Json; upstream?: { nodeId: string; output: Json }[] }
    let value: unknown =
      source.kind === 'flow-input'
        ? context.flowInput
        : context.upstream?.find((item) => item.nodeId === source.nodeId)?.output
    for (const part of source.pointer === '' ? [] : source.pointer.slice(1).split('/')) {
      const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
      value =
        value !== null && typeof value === 'object' && Object.hasOwn(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined
    }
    paths = typeof value === 'string' ? [value] : value
  }
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > EXTRACTION_LIMITS.files ||
    paths.some((path) => typeof path !== 'string' || !path.trim())
  )
    throw new Error('文件路径字段必须包含一个路径或非空路径列表，最多 100 个文件。')
  return [...new Set(paths as string[])]
}
