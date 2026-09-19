import { sha256 } from './hash.js'
import { FILE_EXTRACT_CF_ID, FILE_EXTRACT_VERSION } from './file-extraction-config.js'
import { builtinCopy, normalizeLocale, type Locale } from './locale.js'
import type { CFVersion } from './types.js'

export function builtinCapabilities(locale: Locale = 'zh-CN'): CFVersion[] {
  const copy = builtinCopy[normalizeLocale(locale)]
  const draft: CFVersion['draft'] = {
    cfId: FILE_EXTRACT_CF_ID,
    revision: 1,
    name: copy.name,
    does: copy.does,
    execution: { kind: 'builtin', tool: 'file.extract-text', version: '1' },
    input: copy.input,
    output: copy.output,
    effects: [{ type: 'file-read', scope: 'workspace', description: copy.effect }],
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
    throw new Error(builtinCopy['zh-CN'].immutable)
}

export function capabilityCatalog(stored: CFVersion[], locale: Locale = 'zh-CN'): CFVersion[] {
  return [
    ...builtinCapabilities(locale),
    ...stored.filter((item) => !item.cfId.startsWith('builtin:')),
  ]
}
