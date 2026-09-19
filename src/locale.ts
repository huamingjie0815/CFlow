export const LOCALES = ['zh-CN', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh-CN'
}

export function detectCliLocale(environment: NodeJS.ProcessEnv = process.env): Locale {
  const lang = String(environment.LC_ALL || environment.LANG || '').toLowerCase()
  if (!lang || lang.startsWith('zh')) return 'zh-CN'
  return 'en'
}

export function format(template: string, vars: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`,
  )
}

const define = <T>(value: T) => value

const cliZh = define({
  started: 'CFlow 已启动：{url}',
  openFailed: 'CFlow 无法自动打开浏览器，请手动访问 {url}：{error}',
  startFailed: 'CFlow 启动失败：{error}',
})

const demoZh = define({
  flowName: '示例：写出 Hello World 页面',
  objective: '写出一个 Hello World 页面，用来熟悉检查、分支、并行汇合和试运行',
  themeName: '拟定页面主题',
  themeDoes: '根据目标确定 Hello World 页面的标题、问候语和样式路线',
  themeInput: '流程目标',
  themeOutput: '页面标题、问候语，以及插图版或纯文本的样式选择',
  htmlName: '写 HTML 骨架',
  htmlDoes: '写出插图版 Hello World 页面的基本 HTML 结构',
  htmlInput: '已确定的页面主题',
  htmlOutput: '页面骨架',
  greetingName: '写欢迎文案',
  greetingDoes: '写出插图版页面上的欢迎文字',
  greetingInput: '已确定的页面主题',
  greetingOutput: '欢迎文案',
  assembleName: '汇总成完整页面',
  assembleDoes: '把骨架和文案汇总成一份完整的 Hello World 页面',
  assembleInput: 'HTML 骨架与欢迎文案',
  assembleOutput: '完整页面 HTML',
  plainName: '写纯文本页面',
  plainDoes: '写出不含插图的纯文本 Hello World 页面',
  plainInput: '已确定的页面主题',
  plainOutput: '纯文本页面 HTML',
  illustrated: '需要插图版页面',
  plainRoute: '只要纯文本页面',
})

const builtinZh = define({
  name: '文件内容提取',
  does: '从办公文档中提取文本、表格及页码、工作表、幻灯片来源。',
  input: '在节点上选择文件，或绑定 Flow 输入、直接上游输出中的文件路径字段。',
  output: 'documents 包含每份文件的正文、来源结构、警告与错误，succeeded/failed 为文件计数。',
  effect: '读取所选工作区文件',
  immutable: '内置能力不可修改或覆盖。',
})

const parserZh = define({
  invalidEncoding: '无法按所选编码读取文件，请检查文本编码。',
  outputLimit: '提取结果过大，请设置每文件字符上限。',
  emptyPage: '第 {page} 页没有可提取文本，未进行 OCR。',
  documentLimit: '文档结构超过解析限制，无法保证结果完整，请拆分文件。',
  noTextLayer: 'PDF 没有可提取的文本层，可能是扫描件；本工具未启用 OCR。',
  truncated: '已按字符上限截断，当前结果不是完整文档。',
  emptyFile: '文件内容为空。',
  workerOutputLimit: '提取结果超过 16 MiB，请设置每文件字符上限。',
  parseFailed: '文件解析失败。',
})

const extractionZh = define({
  pathInsideWorkspace: '文件路径必须位于当前工作目录内。',
  notRegularOrLink: '目标必须是普通文件，不能是目录或符号链接。',
  pathOutside: '文件路径超出当前工作目录。',
  notRegular: '目标不是普通文件。',
  fileTooLarge: '单文件不能超过 50 MiB。',
  fileChanged: '读取期间文件发生变化，请重试。',
  aborted: '解析已取消。',
  timeout: '文件解析超时。',
  workerExit: '文件解析进程提前退出（{code}）。',
  unsupportedFormat: '暂不支持此文件格式，请转换为 PDF、DOCX、XLSX、PPTX 或文本文件。',
  missingFile: '文件不存在。',
  unreadable: '无法读取或解析文件。',
  nodeOutputLimit: '节点提取结果超过 16 MiB，请减少文件数量或设置每文件字符上限。',
  allFailed: '所有文件均提取失败，请查看逐文件错误。',
})

const proposalZh = define({
  branchCondition: '分支条件',
  branchConditionNamed: '分支条件：{condition}',
  stageFallback: '第 {index} 个步骤',
  defaultInput: '来自 Flow 输入或上游 CF 的结构化输入',
  defaultOutput: '供下游 CF 使用的结构化结果',
  languageRule:
    'Write flowName, summary, stage names, does, conditions, and assistantMessage in Simplified Chinese.',
  generatedSummary: 'Runtime 已生成可审阅的 Flow 草案。',
})

const agentZh = define({
  branch: '条件分支',
  join: '汇合',
  output: '流程结果',
  unknownStep: '未知步骤',
  runIncomplete: '运行没有完成。',
  noDraft:
    '目前还没有可分析的流程。先在中间区域描述目标，生成一份 Flow 草案后，我就能检查步骤和运行证据。',
  failedRun:
    '我定位到最近一次运行在「{name}」失败。记录里的原因是：{error}。当前没有可用的流程助手，我只能根据这份草稿说明问题，不能直接改图。请在设置里选一个可用 Runtime，再说一次要怎么改。',
  noRuntimeRevise:
    '我已经加载「{name}」当前草稿，但当前没有可用的流程助手，不能直接改图。请在设置里选一个可用 Runtime 后再说一次要改的地方。',
  loaded:
    '我已经加载「{name}」当前草稿，当前有 {count} 个能力步骤。你可以问某一步在做什么，或在助手可用时直接说要怎么改。',
  replyLanguage: 'Reply in concise Chinese.',
})

export type CliCopy = typeof cliZh
export type DemoCopy = typeof demoZh
export type BuiltinCopy = typeof builtinZh
export type ParserCopy = typeof parserZh
export type ExtractionCopy = typeof extractionZh
export type ProposalCopy = typeof proposalZh
export type AgentCopy = typeof agentZh

export const cliCopy: Record<Locale, CliCopy> = {
  'zh-CN': cliZh,
  en: {
    started: 'CFlow is running at {url}',
    openFailed: 'CFlow could not open a browser. Open {url} manually: {error}',
    startFailed: 'CFlow failed to start: {error}',
  },
}

export const demoCopy: Record<Locale, DemoCopy> = {
  'zh-CN': demoZh,
  en: {
    flowName: 'Example: write a Hello World page',
    objective: 'Write a Hello World page to try check, branches, parallel joins, and a test run',
    themeName: 'Choose a page theme',
    themeDoes:
      'Decide the Hello World title, greeting, and whether the page is illustrated or plain',
    themeInput: 'Flow objective',
    themeOutput: 'Page title, greeting, and illustrated vs plain style',
    htmlName: 'Write the HTML frame',
    htmlDoes: 'Write the basic HTML structure for the illustrated Hello World page',
    htmlInput: 'Chosen page theme',
    htmlOutput: 'Page frame',
    greetingName: 'Write the greeting',
    greetingDoes: 'Write the welcome copy for the illustrated page',
    greetingInput: 'Chosen page theme',
    greetingOutput: 'Greeting copy',
    assembleName: 'Assemble the full page',
    assembleDoes: 'Combine the frame and greeting into a complete Hello World page',
    assembleInput: 'HTML frame and greeting',
    assembleOutput: 'Complete page HTML',
    plainName: 'Write a plain-text page',
    plainDoes: 'Write a Hello World page without illustrations',
    plainInput: 'Chosen page theme',
    plainOutput: 'Plain-text page HTML',
    illustrated: 'Need an illustrated page',
    plainRoute: 'Plain text only',
  },
}

export const builtinCopy: Record<Locale, BuiltinCopy> = {
  'zh-CN': builtinZh,
  en: {
    name: 'Extract file contents',
    does: 'Extract text, tables, and page, sheet, or slide sources from office documents.',
    input:
      'Pick files on the node, or bind paths from Flow input or the immediate upstream output.',
    output:
      'documents holds each file’s text, source structure, warnings, and errors; succeeded/failed are file counts.',
    effect: 'Read the selected workspace files',
    immutable: 'Built-in capabilities cannot be changed or overridden.',
  },
}

export const parserCopy: Record<Locale, ParserCopy> = {
  'zh-CN': parserZh,
  en: {
    invalidEncoding: 'Could not read the file with the selected encoding. Check the text encoding.',
    outputLimit: 'The extracted result is too large. Set a per-file character limit.',
    emptyPage: 'Page {page} has no extractable text. OCR is not used.',
    documentLimit: 'The document structure exceeds parser limits. Split the file and try again.',
    noTextLayer: 'This PDF has no extractable text layer and may be a scan. OCR is not enabled.',
    truncated: 'Truncated at the character limit. This is not the full document.',
    emptyFile: 'The file is empty.',
    workerOutputLimit: 'The extracted result exceeds 16 MiB. Set a per-file character limit.',
    parseFailed: 'File parsing failed.',
  },
}

export const extractionCopy: Record<Locale, ExtractionCopy> = {
  'zh-CN': extractionZh,
  en: {
    pathInsideWorkspace: 'File paths must stay inside the current workspace directory.',
    notRegularOrLink: 'The target must be a regular file, not a directory or symlink.',
    pathOutside: 'The file path is outside the current workspace directory.',
    notRegular: 'The target is not a regular file.',
    fileTooLarge: 'Each file must be 50 MiB or smaller.',
    fileChanged: 'The file changed while it was being read. Try again.',
    aborted: 'Parsing was cancelled.',
    timeout: 'File parsing timed out.',
    workerExit: 'The file parser exited early ({code}).',
    unsupportedFormat:
      'This file format is not supported. Convert it to PDF, DOCX, XLSX, PPTX, or a text file.',
    missingFile: 'The file does not exist.',
    unreadable: 'The file could not be read or parsed.',
    nodeOutputLimit:
      'The node’s extracted result exceeds 16 MiB. Use fewer files or set a per-file character limit.',
    allFailed: 'Every file failed to extract. Check the per-file errors.',
  },
}

export const proposalCopy: Record<Locale, ProposalCopy> = {
  'zh-CN': proposalZh,
  en: {
    branchCondition: 'Branch condition',
    branchConditionNamed: 'Branch condition: {condition}',
    stageFallback: 'Step {index}',
    defaultInput: 'Structured input from Flow input or an upstream CF',
    defaultOutput: 'Structured result for downstream CFs',
    languageRule:
      'Write flowName, summary, stage names, does, conditions, and assistantMessage in English.',
    generatedSummary: 'A reviewable Flow draft is ready.',
  },
}

export const agentCopy: Record<Locale, AgentCopy> = {
  'zh-CN': agentZh,
  en: {
    branch: 'Conditional branch',
    join: 'Join',
    output: 'Flow result',
    unknownStep: 'Unknown step',
    runIncomplete: 'The run did not finish.',
    noDraft:
      'There is no Flow to inspect yet. Describe the objective in the centre panel to generate a draft, then I can check steps and run evidence.',
    failedRun:
      'The latest run failed at “{name}”. The recorded reason is: {error}. No Flow assistant is available, so I can only explain from this draft and cannot change the graph. Pick an available runtime in Settings, then say how you want it changed.',
    noRuntimeRevise:
      'I loaded the current draft of “{name}”, but no Flow assistant is available, so I cannot change the graph. Pick an available runtime in Settings, then say what to change.',
    loaded:
      'I loaded the current draft of “{name}”, with {count} capability steps. You can ask what a step does, or change the graph once an assistant is available.',
    replyLanguage: 'Reply in concise English.',
  },
}
