import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { isWithinDirectory } from './workspace.js'
import {
  EXTRACTION_FORMATS,
  EXTRACTION_LIMITS,
  resolveExtractionPaths,
} from './file-extraction-config.js'
import type { ExtractedDocument, FileExtractionInput, FileExtractionResult, Json } from './types.js'

function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

async function readSource(root: string, path: string) {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw failure('PATH_OUTSIDE_WORKSPACE', '文件路径必须位于当前工作目录内。')
  const normalizedRoot = await realpath(root)
  const target = resolve(normalizedRoot, path)
  const stat = await lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw failure('NOT_REGULAR_FILE', '目标必须是普通文件，不能是目录或符号链接。')
  const actual = await realpath(target)
  if (!isWithinDirectory(normalizedRoot, actual))
    throw failure('PATH_OUTSIDE_WORKSPACE', '文件路径超出当前工作目录。')
  const file = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw failure('NOT_REGULAR_FILE', '目标不是普通文件。')
    if (info.size > EXTRACTION_LIMITS.fileBytes)
      throw failure('FILE_TOO_LARGE', '单文件不能超过 50 MiB。')
    // Bound the read even when a source file grows after stat().
    const bytes = Buffer.alloc(info.size + 1)
    let count = 0
    while (count < bytes.length) {
      const chunk = await file.read(bytes, count, bytes.length - count, null)
      if (!chunk.bytesRead) break
      count += chunk.bytesRead
    }
    if (count > info.size) throw failure('FILE_CHANGED', '读取期间文件发生变化，请重试。')
    return bytes.subarray(0, count)
  } finally {
    await file.close()
  }
}

export function parseInWorker(
  bytes: Uint8Array,
  format: string,
  options: Pick<FileExtractionInput, 'encoding' | 'maxChars'>,
  signal: AbortSignal,
  timeoutMs: number = EXTRACTION_LIMITS.timeoutMs,
): Promise<Omit<ExtractedDocument, 'path'>> {
  signal.throwIfAborted()
  const compiled = import.meta.url.endsWith('.js')
  const entry = new URL(
    compiled ? './file-extraction-worker.js' : './file-extraction-worker.ts',
    import.meta.url,
  )
  const worker = compiled
    ? new Worker(entry, {
        workerData: { bytes, format, options },
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      })
    : new Worker(
        `import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(entry.href)}, ${JSON.stringify(import.meta.url)}))`,
        {
          eval: true,
          workerData: { bytes, format, options },
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        },
      )
  return new Promise((resolveResult, reject) => {
    let settled = false
    const finish = async (error?: Error, result?: Omit<ExtractedDocument, 'path'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      await worker.terminate()
      if (error) reject(error)
      else resolveResult(result!)
    }
    const abort = () => void finish(failure('ABORTED', '解析已取消。'))
    const timer = setTimeout(
      () => void finish(failure('PARSE_TIMEOUT', '文件解析超时。')),
      timeoutMs,
    )
    signal.addEventListener('abort', abort, { once: true })
    worker.once(
      'message',
      (message) =>
        void finish(
          message.error ? failure(message.error.code, message.error.message) : undefined,
          message.result,
        ),
    )
    worker.once(
      'error',
      (error) => void finish(error instanceof Error ? error : new Error(String(error))),
    )
    worker.once('exit', (code) => {
      if (!settled) void finish(failure('WORKER_EXIT', `文件解析进程提前退出（${code}）。`))
    })
    if (signal.aborted) abort()
  })
}

export async function extractFiles(
  config: FileExtractionInput,
  input: Json,
  root: string,
  signal: AbortSignal,
  report: (type: string, data: Json) => void = () => {},
) {
  const paths = resolveExtractionPaths(config, input)
  const result: FileExtractionResult = {
    kind: 'file-extraction',
    documents: [],
    succeeded: 0,
    failed: 0,
  }
  let outputBytes = 0
  for (const path of paths) {
    signal.throwIfAborted()
    report('tool.file.started', { path })
    let format = extname(path).slice(1).toLowerCase()
    format =
      ({ markdown: 'md', htm: 'html', text: 'txt' } as Record<string, string>)[format] ?? format
    let document: ExtractedDocument
    try {
      if (!EXTRACTION_FORMATS.includes(format))
        throw failure(
          'UNSUPPORTED_FORMAT',
          '暂不支持此文件格式，请转换为 PDF、DOCX、XLSX、PPTX 或文本文件。',
        )
      const bytes = await readSource(root, path)
      signal.throwIfAborted()
      document = { path, ...(await parseInWorker(bytes, format, config, signal)) }
      result.succeeded++
    } catch (error) {
      if (signal.aborted) throw error
      const item = error as { code?: string; message?: string }
      document = {
        path,
        format,
        status: 'failed',
        text: '',
        blocks: [],
        warnings: [],
        truncated: false,
        originalChars: 0,
        error: {
          code: item.code ?? 'PARSE_FAILED',
          message:
            item.code === 'ENOENT' ? '文件不存在。' : (item.message ?? '无法读取或解析文件。'),
        },
      }
      result.failed++
    }
    outputBytes += Buffer.byteLength(JSON.stringify(document))
    if (outputBytes > EXTRACTION_LIMITS.outputBytes - 1024)
      throw failure('OUTPUT_LIMIT', '节点提取结果超过 16 MiB，请减少文件数量或设置每文件字符上限。')
    result.documents.push(document)
    report(`tool.file.${document.status}`, {
      path,
      format,
      ...(document.error
        ? { error: document.error }
        : {
            chars: document.text.length,
            truncated: document.truncated,
            warnings: document.warnings,
          }),
    })
  }
  if (!result.succeeded)
    throw Object.assign(failure('ALL_FILES_FAILED', '所有文件均提取失败，请查看逐文件错误。'), {
      result,
    })
  return result
}
