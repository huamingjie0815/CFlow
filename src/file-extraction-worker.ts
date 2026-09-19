import { parentPort, workerData } from 'node:worker_threads'
import { parseDocument } from './file-extraction-parser.js'
import { EXTRACTION_LIMITS } from './file-extraction-config.js'
import { normalizeLocale, parserCopy } from './locale.js'

const locale = normalizeLocale(workerData.options?.locale)
try {
  const result = await parseDocument(workerData.bytes, workerData.format, workerData.options)
  if (Buffer.byteLength(JSON.stringify(result)) > EXTRACTION_LIMITS.outputBytes - 1024)
    throw Object.assign(new Error(parserCopy[locale].workerOutputLimit), {
      code: 'OUTPUT_LIMIT',
    })
  parentPort!.postMessage({ result })
} catch (error) {
  const item = error as { code?: string; message?: string; officeIssue?: { code?: string } }
  parentPort!.postMessage({
    error: {
      code: item.code ?? item.officeIssue?.code ?? 'PARSE_FAILED',
      message: item.message ?? parserCopy[locale].parseFailed,
    },
  })
}
