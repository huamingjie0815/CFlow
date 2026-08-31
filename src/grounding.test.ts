import test from 'node:test'
import assert from 'node:assert/strict'
import { assertAttachmentGrounding, collectGroundingFailures } from './proposal.js'

/**
 * Attachment grounding is a fail-closed guarantee: a proposed stage must quote
 * the uploaded document. These tests pin both halves of that — legitimate
 * quote shapes must pass, and invented text must still be rejected.
 */

const source = [
  {
    path: 'SKILL.md',
    content: `## 3. 处理流程

1. **接收工单**：从邮箱或工单系统读取新提交的工单，记录编号、提交人和时间。
2. **分类判断**：根据工单标题和正文判断类别（故障 / 咨询 / 变更）。
   - 若为“故障”，进入紧急通道；
   - 其他类别按普通队列处理。
3. **指派处理人**: 依据类别与当前负载，指派给对应小组。
`,
  },
]

const withQuote = (quote: unknown) => ({ stages: [{ name: '接收工单', sourceQuote: quote }] })
const failuresFor = (quote: unknown) => collectGroundingFailures(withQuote(quote), source)

test('a verbatim quote passes', () => {
  assert.deepEqual(failuresFor('从邮箱或工单系统读取新提交的工单，记录编号、提交人和时间。'), [])
})

test('quote shapes a model legitimately produces are accepted', () => {
  const accepted = [
    // Markdown emphasis dropped
    '接收工单：从邮箱或工单系统读取新提交的工单',
    // Full-width colon rewritten as half-width
    '指派处理人: 依据类别与当前负载，指派给对应小组。',
    // Half-width colon rewritten as full-width
    '接收工单：从邮箱或工单系统读取新提交的工单',
    // Curly quotes flattened
    '若为"故障"，进入紧急通道',
    // Leading list marker kept
    '- 若为“故障”，进入紧急通道；',
    // Heading marker kept
    '## 3. 处理流程',
    // Elided middle
    '根据工单标题和正文判断类别…指派给对应小组',
    // Wrapped in quotation marks
    '「根据工单标题和正文判断类别（故障 / 咨询 / 变更）。」',
    // Trailing punctuation dropped
    '其他类别按普通队列处理',
  ]
  for (const quote of accepted) {
    assert.deepEqual(failuresFor(quote), [], `should accept: ${quote}`)
  }
})

test('invented text is still rejected — the guarantee holds', () => {
  const rejected = [
    '调用第三方风控接口进行评分',
    '自动向申请人退款并关闭工单',
    // Real fragments bridged by an invented middle: every fragment must exist.
    '根据工单标题和正文判断类别…自动生成赔付方案',
  ]
  for (const quote of rejected) {
    const failures = failuresFor(quote)
    assert.equal(failures.length, 1, `should reject: ${quote}`)
    assert.equal(failures[0].reason, 'not-found')
  }
})

test('a missing quote is reported as missing, not as not-found', () => {
  for (const empty of [undefined, null, '', '   ']) {
    const failures = failuresFor(empty)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].reason, 'missing')
  }
})

test('a quote too short to be evidence is rejected distinctly', () => {
  const failures = failuresFor('工单')
  assert.equal(failures.length, 1)
  assert.equal(failures[0].reason, 'too-short')
})

test('nested route stages are checked too, and reported by name', () => {
  const failures = collectGroundingFailures(
    {
      stages: [
        { name: '分类判断', sourceQuote: '根据工单标题和正文判断类别' },
        {
          name: '路由',
          sourceQuote: '若为“故障”，进入紧急通道',
          routes: [
            { stages: [{ name: '紧急处理', sourceQuote: '进入紧急通道' }] },
            { stages: [{ name: '编造的步骤', sourceQuote: '联系外部供应商索赔' }] },
          ],
        },
      ],
    },
    source,
  )
  assert.equal(failures.length, 1)
  assert.equal(failures[0].stageName, '编造的步骤')
  assert.equal(failures[0].reason, 'not-found')
})

test('every failure is collected at once, not just the first', () => {
  const failures = collectGroundingFailures(
    {
      stages: [
        { name: '好的', sourceQuote: '进入紧急通道' },
        { name: '缺引用', sourceQuote: '' },
        { name: '编造', sourceQuote: '调用风控接口' },
      ],
    },
    source,
  )
  assert.equal(failures.length, 2)
  assert.deepEqual(
    failures.map((item) => item.reason),
    ['missing', 'not-found'],
  )
})

test('a runtime that quoted nothing at all is a distinct, reportable case', () => {
  const nothing = { stages: [{ name: 'a' }, { name: 'b' }] }
  assert.throws(
    () => assertAttachmentGrounding(nothing, source),
    (error: Error & { details?: any }) => {
      assert.match(error.message, /RUNTIME_PROPOSAL_UNQUOTED/)
      assert.equal(error.details.allMissing, true)
      assert.equal(error.details.total, 2)
      return true
    },
  )
  // One invented stage among grounded ones is NOT the same failure.
  assert.throws(
    () =>
      assertAttachmentGrounding(
        {
          stages: [
            { name: 'a', sourceQuote: '进入紧急通道' },
            { name: 'b', sourceQuote: '编造内容' },
          ],
        },
        source,
      ),
    (error: Error & { details?: any }) => {
      assert.match(error.message, /RUNTIME_PROPOSAL_UNGROUNDED/)
      assert.equal(error.details.allMissing, false)
      return true
    },
  )
})

test('grounded stages produce no error at all', () => {
  assert.doesNotThrow(() =>
    assertAttachmentGrounding(
      { stages: [{ name: '接收工单', sourceQuote: '从邮箱或工单系统读取新提交的工单' }] },
      source,
    ),
  )
})
