import { parentPort, workerData } from 'node:worker_threads'
import { parseDocument } from './file-extraction-parser.js'
import { EXTRACTION_LIMITS } from './file-extraction-config.js'

try {
  const result = await parseDocument(workerData.bytes, workerData.format, workerData.options)
  if (Buffer.byteLength(JSON.stringify(result)) > EXTRACTION_LIMITS.outputBytes - 1024)
    throw Object.assign(new Error('提取结果超过 16 MiB，请设置每文件字符上限。'), {
      code: 'OUTPUT_LIMIT',
    })
  parentPort!.postMessage({ result })
} catch (error) {
  const item = error as { code?: string; message?: string; officeIssue?: { code?: string } }
  parentPort!.postMessage({
    error: {
      code: item.code ?? item.officeIssue?.code ?? 'PARSE_FAILED',
      message: item.message ?? '文件解析失败。',
    },
  })
}
