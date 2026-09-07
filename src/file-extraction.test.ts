import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink, open, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { parseDocument } from './file-extraction-parser.js'
import { extractFiles, parseInWorker } from './file-extraction.js'
import {
  assertExtractionInput,
  resolveExtractionPaths,
  EXTRACTION_LIMITS,
} from './file-extraction-config.js'
import {
  wordFixture,
  spreadsheetFixture,
  slidesFixture,
  pdfFixture,
  oversizedArchive,
} from './test-support/documents.js'

test('extracts real Office documents with Chinese text and source structure', async () => {
  const word = await parseDocument(wordFixture(), 'docx', {})
  assert.match(word.text, /月度办公报告\n正文顺序测试/)
  const table = word.blocks.find((block) => block.kind === 'table')!
  assert.equal(word.text.slice(table.rows![1][1].start, table.rows![1][1].end), '120')
  assert.ok(word.blocks.every((block) => block.page === undefined))
  const sheet = await parseDocument(spreadsheetFixture(), 'xlsx', {})
  assert.deepEqual(
    sheet.blocks.map((block) => block.sheet),
    ['费用', '汇总'],
  )
  assert.match(sheet.text, /部门\t\t金额/)
  assert.equal(sheet.blocks[0].rows![1][1].column, 2)
  assert.equal(sheet.blocks[0].rows![1][1].row, 2)
  assert.match(sheet.text, /3$/)
  const slides = await parseDocument(slidesFixture(), 'pptx', {})
  assert.match(slides.text, /办公演示第一页/)
  assert.match(slides.text, /第一张备注/)
  assert.deepEqual([...new Set(slides.blocks.map((block) => block.slide))], [1, 2])
})

test('extracts supported text formats, tables, BOM and GB18030 without interpreting external content', async () => {
  for (const [format, value, expected] of [
    ['txt', '中文\r\n正文', '中文\n正文'],
    ['json', '{"标题":"办公"}', '办公'],
    ['xml', '<!DOCTYPE x SYSTEM "https://example.invalid/external"><x>办公</x>', '办公'],
    ['md', '# 标题\n\n正文', '正文'],
    [
      'html',
      '<html><script>danger()</script><style>bad{}</style><h1>标题</h1><p>正文</p><img src="https://example.invalid/a.png"></html>',
      '正文',
    ],
    ['csv', '部门,金额,备注\n财务,120,"一行\n二行"', '财务'],
  ]) {
    const result = await parseDocument(Buffer.from(value), format, {})
    assert.ok(result.text.includes(expected), `${format}: ${result.text}`)
    if (format === 'html') assert.doesNotMatch(result.text, /danger|bad\{/)
    if (format === 'csv') assert.equal(result.blocks[0].rows!.length, 2)
  }
  const bom = await parseDocument(
    Buffer.concat([Buffer.from([255, 254]), Buffer.from('中文', 'utf16le')]),
    'txt',
    {},
  )
  assert.equal(bom.text, '中文')
  assert.equal(
    (await parseDocument(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), 'txt', { encoding: 'gb18030' }))
      .text,
    '中文',
  )
  await assert.rejects(parseDocument(Buffer.from([0xff]), 'txt', {}), /编码/)
})

test('PDF pages preserve text sources and distinguish missing text layers', async () => {
  const result = await parseDocument(await pdfFixture(), 'pdf', {})
  assert.match(result.text, /Office report page 1/)
  assert.deepEqual([...new Set(result.blocks.map((block) => block.page))], [1, 2])
  const mixed = await parseDocument(await pdfFixture('mixed'), 'pdf', {})
  assert.match(mixed.warnings.join(' '), /第 2 页/)
  await assert.rejects(parseDocument(await pdfFixture('scan'), 'pdf', {}), /文本层/)
  await assert.rejects(parseDocument(await pdfFixture('encrypted'), 'pdf', {}))
  await assert.rejects(parseDocument(Buffer.from('broken'), 'pdf', {}))
})

test('preserves explicit breaks and inline formatting inside paragraphs, lists and cells', async () => {
  const word = unzipSync(wordFixture())
  word['word/document.xml'] = strToU8(
    strFromU8(word['word/document.xml']).replace('正文顺序测试', 'first</w:t><w:br/><w:t>second'),
  )
  assert.match((await parseDocument(zipSync(word), 'docx', {})).text, /first\nsecond/)
  for (const [format, source, expected] of [
    ['html', '<p>first<br>second</p>', 'first\nsecond'],
    ['md', 'first  \nsecond', 'first\nsecond'],
    ['md', '- pay **120** USD\n- next', 'pay 120 USD\nnext'],
    ['html', '<table><tr><td>AB<b>CD</b>EF</td></tr></table>', 'ABCDEF'],
    ['html', '<table><tr><td><p>first</p><p>second</p></td></tr></table>', 'first\nsecond'],
    ['html', '<dl><dt>Name</dt><dd>Alice</dd></dl>', 'Name\nAlice'],
  ]) {
    assert.equal((await parseDocument(Buffer.from(source), format, {})).text, expected, source)
  }
})

test('retains nested table text, source ranges and truncation', async () => {
  const source = Buffer.from(
    '<table><tr><td>A</td><td><p>before</p><table><tr><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr></table><p>after</p></td></tr></table>',
  )
  const full = await parseDocument(source, 'html', {})
  assert.equal(full.text, 'A\tbefore\nB\tC\nD\tE\nafter')
  const tables = full.blocks.filter((block) => block.kind === 'table')
  assert.equal(tables.length, 2)
  const nested = tables.find((block) => block.rows?.length === 2)!
  assert.deepEqual(
    nested.rows!.map((row) => row.map((cell) => full.text.slice(cell.start, cell.end))),
    [
      ['B', 'C'],
      ['D', 'E'],
    ],
  )
  for (const maxChars of [1, 9, 12, 15]) {
    const clipped = await parseDocument(source, 'html', { maxChars })
    assert.equal(clipped.text, full.text.slice(0, maxChars))
    assert.equal(clipped.originalChars, full.text.length)
    assert.equal(clipped.truncated, true)
    for (const block of clipped.blocks) {
      assert.ok(block.start <= block.end && block.end <= clipped.text.length)
      for (const row of block.rows ?? [])
        for (const cell of row) assert.ok(cell.start <= cell.end && cell.end <= clipped.text.length)
    }
  }
})

test('assigns visual columns around horizontal and vertical merged HTML cells', async () => {
  const source = Buffer.from(
    '<table><tr><td colspan="2" rowspan="2">Merged</td><td>Third</td></tr><tr><td>Below</td></tr><tr><td>A</td><td>B</td><td>C</td></tr></table>',
  )
  const result = await parseDocument(source, 'html', {})
  assert.deepEqual(
    result.blocks[0].rows!.map((row) => row.map((cell) => cell.column)),
    [[0, 2], [2], [0, 1, 2]],
  )
  assert.equal(result.text, 'Merged\t\tThird\n\t\tBelow\nA\tB\tC')
})

test('truncation clips text and ranges consistently without silently dropping full results', async () => {
  const full = await parseDocument(spreadsheetFixture(), 'xlsx', {})
  const clipped = await parseDocument(spreadsheetFixture(), 'xlsx', { maxChars: 8 })
  assert.equal(clipped.text, full.text.slice(0, 8))
  assert.equal(clipped.originalChars, full.text.length)
  assert.equal(clipped.truncated, true)
  for (const block of clipped.blocks) {
    assert.ok(block.start <= block.end && block.end <= clipped.text.length)
    for (const row of block.rows ?? [])
      for (const cell of row) assert.ok(cell.start <= cell.end && cell.end <= clipped.text.length)
  }
  const empty = await parseDocument(Buffer.alloc(0), 'txt', {})
  assert.equal(empty.truncated, false)
  assert.match(empty.warnings.join(' '), /为空/)
  await assert.rejects(
    parseDocument(Buffer.alloc(EXTRACTION_LIMITS.outputBytes + 1, 'a'), 'txt', {}),
    /结果过大/,
  )
})

test('resolves explicit path sources with JSON Pointer escaping and rejects missing or non-path values', () => {
  assert.deepEqual(
    resolveExtractionPaths({ source: { kind: 'files', paths: ['a.txt', 'a.txt'] } }, {}),
    ['a.txt'],
  )
  assert.deepEqual(
    resolveExtractionPaths(
      { source: { kind: 'flow-input', pointer: '/a~1b/~0key' } },
      { flowInput: { 'a/b': { '~key': 'a.txt' } } },
    ),
    ['a.txt'],
  )
  assert.deepEqual(
    resolveExtractionPaths(
      { source: { kind: 'upstream', nodeId: 'one', pointer: '/files' } },
      {
        upstream: [
          { nodeId: 'one', output: { files: ['a.txt'] } },
          { nodeId: 'two', output: { files: ['b.txt'] } },
        ],
      },
    ),
    ['a.txt'],
  )
  for (const value of [null, 42, {}, [], [''], ['a.txt', 1]])
    assert.throws(
      () =>
        resolveExtractionPaths(
          { source: { kind: 'flow-input', pointer: '/files' } },
          { flowInput: { files: value } },
        ),
      /路径/,
    )
  assert.throws(() => assertExtractionInput({ source: { kind: 'flow-input', pointer: '/bad~2' } }))
  assert.throws(() =>
    assertExtractionInput({ source: { kind: 'files', paths: ['a.txt'] }, maxChars: 0 }),
  )
})

test('batch parsing retains successes and rejects escapes, missing, unsupported and oversized files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cflow-extract-'))
  const outside = await mkdtemp(join(tmpdir(), 'cflow-outside-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  await writeFile(join(root, 'ok.txt'), '正文')
  await writeFile(join(root, 'bad.docx'), 'broken')
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
  await symlink(outside, join(root, 'outside'))
  await mkdir(join(root, 'directory.txt'))
  const big = await open(join(root, 'large.txt'), 'w')
  await big.truncate(EXTRACTION_LIMITS.fileBytes + 1)
  await big.close()
  const paths = [
    'ok.txt',
    'missing.txt',
    '../secret.txt',
    '/etc/secret.txt',
    'link.txt',
    'outside/secret.txt',
    'directory.txt',
    'bad.docx',
    'old.doc',
    'large.txt',
  ]
  const events: string[] = []
  const result = await extractFiles(
    { source: { kind: 'files', paths } },
    {},
    root,
    new AbortController().signal,
    (type) => events.push(type),
  )
  assert.equal(result.succeeded, 1)
  assert.equal(result.failed, 9)
  assert.equal(result.documents[0].text, '正文')
  assert.equal(result.documents.at(-1)?.error?.code, 'FILE_TOO_LARGE')
  assert.equal(events.filter((event) => event === 'tool.file.started').length, 10)
  await assert.rejects(
    extractFiles(
      { source: { kind: 'files', paths: ['missing.txt'] } },
      {},
      root,
      new AbortController().signal,
    ),
    (error) => (error as any).result.failed === 1,
  )
})

test('worker cancellation and timeout terminate parsing and release the worker', async () => {
  await assert.rejects(
    parseInWorker(Buffer.from('hello'), 'txt', {}, new AbortController().signal, 1),
    /超时/,
  )
  const controller = new AbortController()
  const work = parseInWorker(Buffer.alloc(10_000_000, 'a'), 'txt', {}, controller.signal)
  controller.abort()
  await assert.rejects(work, /取消/)
  const after = await parseInWorker(
    Buffer.from('still works'),
    'txt',
    {},
    new AbortController().signal,
  )
  assert.equal(after.text, 'still works')
})

test('compressed Office expansion is bounded', async () => {
  await assert.rejects(
    parseInWorker(oversizedArchive(), 'docx', {}, new AbortController().signal),
    /uncompress|limit|size|exceed/i,
  )
})

test('aggregate result size fails explicitly and a configured text limit makes the batch usable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cflow-result-limit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const path of ['one.txt', 'two.txt'])
    await writeFile(join(root, path), Buffer.alloc(9 * 1024 * 1024, 'a'))
  const source = { kind: 'files' as const, paths: ['one.txt', 'two.txt'] }
  await assert.rejects(extractFiles({ source }, {}, root, new AbortController().signal), /16 MiB/)
  const result = await extractFiles(
    { source, maxChars: 100 },
    {},
    root,
    new AbortController().signal,
  )
  assert.equal(result.succeeded, 2)
  assert.ok(
    result.documents.every(
      (doc) => doc.text.length === 100 && doc.truncated && doc.originalChars === 9 * 1024 * 1024,
    ),
  )
})
