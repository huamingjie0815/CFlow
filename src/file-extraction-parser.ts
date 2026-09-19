import {
  OfficeParser,
  type OfficeContentNode,
  type OfficeParserAST,
  type SupportedFileType,
} from 'officeparser'
import { EXTRACTION_LIMITS } from './file-extraction-config.js'
import { format, normalizeLocale, parserCopy, type Locale } from './locale.js'
import type { ExtractedBlock, ExtractedDocument, FileExtractionInput } from './types.js'

export function decodeDocumentText(
  bytes: Uint8Array,
  encoding: FileExtractionInput['encoding'] = 'utf-8',
  locale: Locale = 'zh-CN',
) {
  const bom =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
          ? 'utf-8'
          : encoding
  try {
    return new TextDecoder(bom, { fatal: true })
      .decode(bytes)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
  } catch {
    throw Object.assign(new Error(parserCopy[normalizeLocale(locale)].invalidEncoding), {
      code: 'INVALID_ENCODING',
    })
  }
}

type Location = Pick<ExtractedBlock, 'page' | 'slide' | 'sheet'>

export function extractAst(
  ast: Pick<OfficeParserAST, 'content' | 'warnings' | 'auxiliary'>,
  maxChars?: number,
  locale: Locale = 'zh-CN',
) {
  let text = ''
  let originalChars = 0
  let hasText = false
  const blocks: ExtractedBlock[] = []
  const warnings = ast.warnings.map((issue) => `${issue.code}: ${issue.message}`)
  const limit = maxChars ?? EXTRACTION_LIMITS.outputBytes
  const append = (value: string) => {
    const start = text.length
    const remaining = Math.max(0, limit - originalChars)
    originalChars += value.length
    if (remaining > 0) {
      let part = value.slice(0, remaining)
      if (part.length < value.length && /[\uD800-\uDBFF]$/u.test(part)) part = part.slice(0, -1)
      text += part
    }
    if (maxChars === undefined && originalChars > limit)
      throw Object.assign(new Error(parserCopy[normalizeLocale(locale)].outputLimit), {
        code: 'OUTPUT_LIMIT',
      })
    return { start, end: text.length }
  }
  const ignored = new Set(['image', 'chart', 'drawing', 'embed'])
  const blockTypes = new Set([
    'paragraph',
    'heading',
    'list',
    'table',
    'note',
    'comment',
    'header',
    'footer',
    'definitionList',
    'definitionTerm',
    'definitionDescription',
    'admonition',
  ])
  const isBlock = (node: OfficeContentNode) =>
    blockTypes.has(node.type) || (node.type === 'code' && node.metadata?.math !== 'inline')
  const hasContent = (node: OfficeContentNode): boolean =>
    !ignored.has(node.type) &&
    (node.type === 'break' ||
      node.type === 'table' ||
      (node.children?.length ? node.children.some(hasContent) : Boolean(node.text)))
  // Inline runs concatenate; only block boundaries and explicit breaks add newlines.
  const writeContent = (node: OfficeContentNode, location: Location) => {
    if (ignored.has(node.type)) return
    if (node.type === 'break') {
      append('\n')
    } else if (node.type === 'table') {
      writeTable(node, location)
    } else if (node.children?.length) {
      let previous: OfficeContentNode | undefined
      for (const child of node.children) {
        if (!hasContent(child)) continue
        if (previous && (isBlock(previous) || isBlock(child))) append('\n')
        writeContent(child, location)
        previous = child
      }
    } else {
      hasText ||= Boolean(node.text?.trim())
      append(node.text ?? '')
    }
  }
  const writeTable = (node: OfficeContentNode, location: Location) => {
    const start = text.length
    const rows: NonNullable<ExtractedBlock['rows']> = []
    let occupied: { start: number; end: number; until: number }[] = []
    for (const [rowIndex, row] of (node.children ?? []).entries()) {
      if (rowIndex) append('\n')
      if (row.type !== 'row') {
        writeContent(row, location)
        continue
      }
      occupied = occupied.filter((span) => span.until > rowIndex)
      const cells: NonNullable<ExtractedBlock['rows']>[number] = []
      let nextColumn = 0
      let previousColumn = -1
      for (const cell of row.children ?? []) {
        const meta = cell.type === 'cell' ? cell.metadata : undefined
        const colSpan = Math.max(1, meta?.colSpan ?? 1)
        const rowSpan = Math.max(1, meta?.rowSpan ?? 1)
        let col = meta?.col ?? nextColumn
        if (meta?.col === undefined) {
          let collision
          while (
            (collision = occupied.find((span) => col < span.end && col + colSpan > span.start))
          )
            col = collision.end
        }
        append(
          '\t'.repeat(
            Math.max(0, Math.min(16384, col - previousColumn - (previousColumn < 0 ? 1 : 0))),
          ),
        )
        previousColumn = col
        nextColumn = col + colSpan
        if (rowSpan > 1) occupied.push({ start: col, end: nextColumn, until: rowIndex + rowSpan })
        const cellStart = text.length
        const retained = originalChars < limit
        writeContent(cell, location)
        if (retained)
          cells.push({
            start: cellStart,
            end: text.length,
            row: meta?.row ?? rowIndex,
            column: col,
            ...(rowSpan > 1 ? { rowSpan } : {}),
            ...(colSpan > 1 ? { colSpan } : {}),
          })
      }
      if (cells.length) rows.push(cells)
    }
    if (start < text.length || rows.length)
      blocks.push({ kind: 'table', start, end: text.length, ...location, rows })
  }
  const annotations = (node: OfficeContentNode, location: Location) => {
    for (const note of [...(node.notes ?? []), ...(node.comments ?? [])]) visit(note, location)
    for (const child of node.children ?? []) annotations(child, location)
  }
  const visit = (node: OfficeContentNode, inherited: Location = {}) => {
    const meta = node.metadata as Record<string, unknown> | undefined
    const location: Location = {
      ...inherited,
      ...(node.type === 'page' && typeof meta?.pageNumber === 'number'
        ? { page: meta.pageNumber }
        : {}),
      ...(node.type === 'slide' && typeof meta?.slideNumber === 'number'
        ? { slide: meta.slideNumber }
        : {}),
      ...(node.type === 'sheet' && typeof meta?.sheetName === 'string'
        ? { sheet: meta.sheetName }
        : {}),
    }
    const before = originalChars
    if (
      node.type === 'table' ||
      (node.type === 'sheet' && node.children?.some((child) => child.type === 'row'))
    ) {
      if (originalChars) append('\n')
      writeTable(node, location)
      annotations(node, location)
    } else if (['page', 'slide', 'sheet'].includes(node.type)) {
      for (const child of node.children ?? []) visit(child, location)
      for (const note of [...(node.notes ?? []), ...(node.comments ?? [])]) visit(note, location)
    } else {
      if (hasContent(node)) {
        if (originalChars) append('\n')
        const start = text.length
        writeContent(node, location)
        if (start < text.length)
          blocks.push({ kind: node.type, start, end: text.length, ...location })
      }
      annotations(node, location)
    }
    if (node.type === 'page' && originalChars === before)
      warnings.push(
        format(parserCopy[normalizeLocale(locale)].emptyPage, { page: location.page ?? '?' }),
      )
  }
  for (const node of ast.content) visit(node)
  for (const node of [...(ast.auxiliary?.headers ?? []), ...(ast.auxiliary?.footers ?? [])])
    visit(node)
  blocks.sort((a, b) => a.start - b.start || b.end - a.end)
  return { text, blocks, warnings, originalChars, truncated: originalChars > text.length, hasText }
}

export async function parseDocument(
  bytes: Uint8Array,
  format: string,
  options: Pick<FileExtractionInput, 'encoding' | 'maxChars'> & { locale?: Locale },
): Promise<Omit<ExtractedDocument, 'path'>> {
  const locale = normalizeLocale(options.locale)
  let parsed: ReturnType<typeof extractAst>
  if (['txt', 'json', 'xml'].includes(format)) {
    const value = decodeDocumentText(bytes, options.encoding, locale)
    parsed = extractAst(
      { content: [{ type: 'paragraph', text: value }], warnings: [] },
      options.maxChars,
      locale,
    )
  } else {
    const buffer = ['csv', 'md', 'html'].includes(format)
      ? Buffer.from(decodeDocumentText(bytes, options.encoding, locale))
      : Buffer.from(bytes)
    const ast = await OfficeParser.parseOffice(buffer, {
      fileType: format as SupportedFileType,
      ocr: false,
      extractAttachments: false,
      includeRawContent: false,
      includeBreakNodes: true,
      serializeRawContent: false,
      ignoreSlideMasters: true,
      ignoreNotes: false,
      ignoreComments: false,
      decompressionLimits: {
        maxUncompressedBytes: EXTRACTION_LIMITS.decompressedBytes,
        maxZipEntries: 10_000,
        maxTableCells: 1_000_000,
      },
    })
    if (ast.warnings.some((issue) => String(issue.code).includes('LIMIT_EXCEEDED')))
      throw Object.assign(new Error(parserCopy[locale].documentLimit), {
        code: 'DOCUMENT_LIMIT',
      })
    parsed = extractAst(ast, options.maxChars, locale)
  }
  if (format === 'pdf' && !parsed.hasText)
    throw Object.assign(new Error(parserCopy[locale].noTextLayer), {
      code: 'NO_TEXT_LAYER',
    })
  const { hasText: _hasText, ...result } = parsed
  if (result.truncated) result.warnings.push(parserCopy[locale].truncated)
  if (!result.originalChars) result.warnings.push(parserCopy[locale].emptyFile)
  return { format, status: 'completed', ...result }
}
