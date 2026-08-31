# CFlow

CFlow 是一个以 **Flow** 为核心的本机多 Agent 编排工作台。用户可以用自然语言描述目标，由系统结合 CF 能力库生成可审阅的流程草稿，也可以直接在 DAG 画布中组合、检查、测试、发布和运行流程。

## 当前设计

CFlow 不以 Project 为一级对象。每个 Flow 固定一个本机工作目录，代码仓库、文件集和外部资源都作为 Flow 的运行时上下文或 Resource Profile 使用。

完整工作流为：

```text
选择工作目录 → 描述目标/附加 skill → 生成草稿 → 画布编辑
→ 检查 → 测试 → 发布不可变版本 → 运行 → 查看日志或继续询问助手
```

系统采用两级自然语言编程模型：

```text
CFDraft（自然语言函数源）
  → cf-compiler → CFProgram
  → 测试并发布 CFVersion

FlowDraft（组合已发布 CFVersion）
  → flow-compiler → FlowPlan DAG
  → 测试并发布 FlowVersion
  → Flow Engine 调度 CF Runtime
  → CF Runtime 调用已固定的 Agent Runtime
```

CFlow 的关键约束：

- Flow 是可审阅、可版本化的 DAG；CF 是一个有边界的 Agent 能力，内部不再维护第二套控制流。
- Agent 可以提出或修订草稿，但不能改变已发布图、审批结果、权限或运行事实。
- 检查、测试、发布、运行是独立阶段；测试使用临时编译快照，发布会固定 CF、Runtime Profile、资源和工作目录。
- 数据沿连线传递完整 Flow 输入与已激活的上游输出，不维护字段级 Binding。
- Run Ledger、Job Lease 与 SSE 事件记录执行事实，支持条件分支、共享汇合、审批、重试和取消。

工作台仅面向最小宽度 1280px 的桌面浏览器。顶栏负责流程切换和设置；主区域为左侧详情、中间画布、右侧助手，画布下方提供检查和日志抽屉。左右栏可以收起为窄轨，不提供移动端或触控布局。界面优先使用业务语言，内部 ID、版本和 hash 收在“技术细节”中；同一屏只突出当前下一步操作。

视觉令牌、组件规则和交互原则统一维护在 [`DESIGN.md`](./DESIGN.md)。

## 安装与运行

需要 Node.js 22 或更高版本。

直接从 npm 启动：

```bash
npx @hmj/cflow
```

或全局安装：

```bash
npm install -g @hmj/cflow
cflow
```

从源码运行：

```bash
npm install
npm run build
npm start
```

打开 `http://127.0.0.1:3000`。默认数据库写入 `data/cf.sqlite`，可通过 `CF_DB=/path/to/file.sqlite` 指定其他位置；开发模式使用 `npm run dev`。

服务默认只监听 `127.0.0.1`，因为 Runtime 设置可以启动本机受控进程。只有在已经配置外部认证与网络访问控制时，才应通过显式 `HOST` 改为其他监听地址。

## Runtime 与设置

工作台内置 Codex 与 Claude Code，并通过声明式 manifest 接入 Grok Build、Pi 等本机 Agent。普通用户只需选择默认 Agent 和工作目录：

- 页面加载与设置页“重新识别”会合并 PATH ACP、npm 包、用户 manifest 和项目 manifest；来源与无效 manifest 警告会明确展示。
- Codex 与 Claude Code 通过内置 ACP Adapter 执行；Grok Build 与 Pi 是普通项目 manifest。所有命令均使用 argv 数组启动，不拼接 shell 命令字符串。
- ACP 必须完成真实 `initialize` 握手才标记为可用；CLI 必须通过无副作用的版本探测。认证状态不会用可能计费的模型请求猜测。
- Runtime 配置每次保存都会生成不可变 Profile 版本；发布 Flow 时会 pin 精确 Profile 版本，Run Ledger 记录实际执行版本。
- 设置页只暴露默认 Agent、本地工作目录和测试最长等待时间；资源绑定按需放在折叠的高级区域。
- Runtime 必须返回符合 CF output contract 的 JSON，否则 Flow fail closed。
- Flow/CF 草稿会保存到 SQLite；Resource Profile 可在设置中创建、编辑与删除。

非内置 Agent 可以通过 JSON manifest 接入。项目级文件放在 `<workspace>/.cflow/agents.d/*.json`，用户级文件放在 `~/.config/cflow/agents.d/*.json`；项目配置优先级更高。最小示例：

```json
{
  "schemaVersion": 1,
  "id": "example-agent",
  "name": "Example Agent",
  "backend": "cli",
  "command": "example-agent",
  "versionArgs": ["--version"],
  "promptTransport": "stdin",
  "outputMode": "json"
}
```

`backend` 支持 `acp` 和 `cli`。还可以通过 npm 包的 `cflowAgent` 字段声明 manifest；无效配置会被跳过，并在设置页显示原因。

安全边界按事实展示：Process Runtime 只承诺独立子进程、工作区根目录内的限定 cwd、清理环境、超时/取消与参数化启动；除非具体 adapter 明确提供，否则不声称网络隔离或主机级文件系统沙箱。当前 Process Adapter 收集最终输出，不把底层 CLI 的流式片段、tool events 或 token usage 伪装成产品已暴露能力。密钥值不写入产品数据库，只按配置的变量名从服务端环境继承。

## 开发与验证

```bash
pnpm test
pnpm run typecheck:web
pnpm run format:check
pnpm run build
```

技术栈为 TypeScript、Fastify、React、XYFlow、SQLite 和 Vite。生产构建输出到 `dist/`，npm 包只包含运行产物、README 和唯一的设计文档 `DESIGN.md`。
