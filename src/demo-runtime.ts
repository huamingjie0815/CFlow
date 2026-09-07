import type { AgentTraceReporter, Json } from './types.js'

export const DEMO_RUNTIME_ID = 'cflow-demo'

export const DEMO_HELLO_WORLD_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>Hello World</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f7f9;
        color: #1d2126;
        font-family: system-ui, sans-serif;
      }
      main {
        padding: 48px 56px;
        background: #fff;
        border: 1px solid #e5e8ec;
        border-radius: 16px;
      }
      h1 { margin: 0; font-size: 32px; }
      p { margin: 10px 0 0; color: #5b636d; }
    </style>
  </head>
  <body>
    <main>
      <h1>Hello World</h1>
      <p>你好，世界</p>
    </main>
  </body>
</html>
`

export const demoCapabilityOutput = {
  title: 'Hello World',
  greeting: '你好，世界',
  pageStyle: 'illustrated',
  html: DEMO_HELLO_WORLD_HTML,
  note: '这是演示结果，未调用本机助手',
} as const

export const isBuiltinRuntimeId = (id: string) => id === 'echo' || id === DEMO_RUNTIME_ID

export async function executeDemoCapability(
  _task: string,
  _input: Json,
  _signal?: AbortSignal,
  _resources?: unknown,
  _effects?: unknown,
  _context?: unknown,
  trace?: AgentTraceReporter,
): Promise<Json> {
  trace?.({
    kind: 'notice',
    title: '演示执行',
    detail: '未调用本机助手。这条结果只用来展示流程怎么跑。',
    status: 'completed',
  })
  return { ...demoCapabilityOutput }
}
