import { sha256 } from './hash.js'
import { FILE_EXTRACT_CF_ID, FILE_EXTRACT_VERSION } from './file-extraction-config.js'
import type { CFVersion } from './types.js'

export function builtinCapabilities(): CFVersion[] {
  const draft: CFVersion['draft'] = {
    cfId: FILE_EXTRACT_CF_ID,
    revision: 1,
    name: '文件内容提取',
    does: '从办公文档中提取文本、表格及页码、工作表、幻灯片来源。',
    execution: { kind: 'builtin', tool: 'file.extract-text', version: '1' },
    input: '在节点上选择文件，或绑定 Flow 输入、直接上游输出中的文件路径字段。',
    output: 'documents 包含每份文件的正文、来源结构、警告与错误，succeeded/failed 为文件计数。',
    effects: [{ type: 'file-read', scope: 'workspace', description: '读取所选工作区文件' }],
    inputContract: { type: 'object' },
    outputContract: { type: 'object', required: ['kind', 'documents', 'succeeded', 'failed'] },
  }
  const program: CFVersion['program'] = {
    version: '0.3',
    kind: 'builtin',
    cfId: draft.cfId,
    sourceRevision: 1,
    tool: 'file.extract-text',
    toolVersion: '1',
  }
  return [
    {
      cfId: draft.cfId,
      version: FILE_EXTRACT_VERSION,
      draft,
      program,
      programHash: sha256({
        inputContract: draft.inputContract,
        outputContract: draft.outputContract,
        program,
      }),
      createdAt: '2026-09-07T00:00:00.000Z',
    },
  ]
}

export function assertUserCapability(draft: CFVersion['draft']) {
  if (draft.cfId.startsWith('builtin:') || draft.execution !== undefined)
    throw new Error('内置能力不可修改或覆盖。')
}

export function capabilityCatalog(stored: CFVersion[]): CFVersion[] {
  return [...builtinCapabilities(), ...stored.filter((item) => !item.cfId.startsWith('builtin:'))]
}
