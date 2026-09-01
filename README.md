# CFlow

CFlow 是一个以 Flow 为核心的本机多 Agent 编排工作台。用户用自然语言描述目标，系统生成可审阅的流程草案；用户可以在桌面 DAG 画布中调整、检查、测试、发布、运行流程，并通过运行日志或助手继续处理问题。

## 产品模型

CFlow 面向 HR、财务、运营等不需要学习 DSL 的工作人员。产品表面使用业务语言，内部标识、版本号、hash 和运行时协议只在“技术细节”中展示。

工作区由启动 CFlow 时所在的目录决定。一个工作区可以拥有多个 Flow，但 Flow 不会跨工作区读取或写入数据。完整使用路径如下：

```text
在目标目录启动 CFlow
  -> 用自然语言描述目标
  -> 生成或编辑 Flow 草案
  -> 检查图和契约
  -> 使用临时快照测试
  -> 发布不可变 Flow 版本
  -> 运行并查看 Run Ledger
  -> 必要时通过助手分析或修改草案
```

产品刻意保持为桌面工作台：支持最小宽度 1280px 的桌面浏览器，左右面板可以收起为窄轨；不实现移动端、触控端或移动抽屉布局。

## 核心设计

### 两级自然语言编程

CFlow 将“单个 Agent 能力”和“能力之间的编排”分成两个层次：

```text
CFDraft（单个能力的自然语言描述）
  -> compileCF
  -> CFProgram / CFVersion

FlowDraft（已发布能力的组合）
  -> compileFlow
  -> FlowPlan
  -> Flow Engine
  -> Runtime 执行每个 CF
```

- **CF** 是一个有明确输入、输出、过程约束和 effects 的 Agent 能力。CF 内部没有可供 Engine 解释的控制流。
- **Flow** 是由 `cf-call`、`branch`、`join`、`approval`、`output` 节点组成的 DAG。条件、并发、汇合、审批、重试和取消都属于 Flow 层。
- 数据沿边传递完整的 Flow 输入以及已完成上游节点的输出，不维护字段级 Binding。
- 助手只能根据本轮传入的工作台快照回答问题，或返回线性的 CF 步骤草案。助手不能直接写入边、hash、审批结果、已发布版本或运行事实；服务端会重新编译并校验结果。

### 草案、检查、测试与发布分离

草案是可编辑状态，发布版本是不可变事实。检查和测试使用编译快照，不会把临时结果误当成正式版本；正式运行只能引用已保存的 Flow 版本。发布时会固定：

- FlowPlan 及其 `planHash`；
- 每个 CF 的精确 `cfId@version` 和 `programHash`；
- 每个节点使用的 Runtime Profile 版本；
- 当前工作区根目录和资源绑定。

因此，之后修改草案、Runtime 设置或 Agent manifest，不会改变已经发布版本的执行含义。

## 架构

```text
┌──────────────────────────────────────────────────────────┐
│ React 工作台                                             │
│ FlowSwitcher / GoalComposer / FlowCanvas / Check / Log   │
│ FlowAgentChat / Settings                                 │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTP JSON + SSE
┌───────────────────────▼──────────────────────────────────┐
│ Fastify Server                                             │
│ 工作区边界、API、草稿保存、编译发布、运行控制、错误处理 │
└───────┬──────────────────┬───────────────────┬────────────┘
        │                  │                   │
┌───────▼──────┐  ┌────────▼────────┐  ┌───────▼──────────┐
│ Compiler     │  │ Engine          │  │ RuntimeManager   │
│ CF / Flow    │  │ DAG 调度与恢复  │  │ ACP / CLI 适配   │
│ 契约 / hash  │  │ lease / ledger  │  │ 发现 / 健康检查  │
└───────┬──────┘  └────────┬────────┘  └───────┬──────────┘
        └──────────────────▼───────────────────┘
                    SQLite (.cflow)
                         │
                  本机 Agent 子进程
```

### 模块职责

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| 类型与领域模型 | `src/types.ts` | 定义 CF、Flow、Plan、Runtime、Run 和资源的边界 |
| CF/Flow 编译器 | `src/compiler.ts` | 校验契约和图结构，生成确定性的版本与 hash |
| 持久化 | `src/db.ts` | 保存草稿、版本、编译快照、运行、事件、job、审批和设置 |
| 执行引擎 | `src/engine.ts` | 管理节点状态、并发、分支、join、审批、重试、取消和恢复 |
| Runtime 管理 | `src/runtime.ts` | 管理 Profile，执行 ACP 握手、CLI 探测、权限分析和输出校验 |
| 进程边界 | `src/runtime-process.ts` | 解析可执行文件、使用 argv 启动进程、限制环境和 cwd、处理终止 |
| Agent manifest | `src/runtime-manifest.ts` | 合并内置、PATH ACP、npm、用户级和项目级 Runtime 配置 |
| HTTP 服务 | `src/server.ts` | 组装依赖、提供 API、固定版本、启动恢复循环和 SSE |
| React 工作台 | `web/src/` | 提供流程切换、目标输入、画布、检查、日志、设置和助手界面 |

### 运行时序

1. `/api/flow-tests` 或发布接口接收 FlowDraft，并把必要的临时 CFDraft 编译成 CFVersion。
2. `compileFlow` 检查入口、可达性、环、终点、分支和审批边，计算 `programHash` 与 `planHash`。
3. 服务端解析资源绑定并 pin 当前 Runtime Profile 版本，保存编译快照或 FlowVersion。
4. 创建 Run 和 Job。恢复循环通过 lease 领取 Job，避免进程重启后丢失排队任务。
5. Engine 校验 `planHash`，从 Run Ledger 恢复状态；发现副作用可能已发生但事实不完整的节点时，Run 进入 `needs-reconciliation`，不会盲目重放。
6. 就绪节点按 `maxConcurrency` 调度。节点完成、失败、阻塞、分支选择、审批和 Run 状态变化都写入有序 Ledger Event。
7. Engine 调用 Executor；Runtime 将 task、输入、资源和 effects 交给 Agent，要求返回符合 output contract 的 JSON，无法满足契约时 fail closed。
8. 前端通过 `/api/runs/:id/events` 的 SSE 读取事件，运行结束或连接关闭后停止推送。

## 数据与持久化

启动目录下的 `.cflow/` 是唯一数据作用域：

```text
<workspace>/.cflow/
├── cflow.sqlite       # 业务数据、版本、运行记录和事件
├── flows/             # 流程附件
├── agents.d/          # 项目级 Agent manifest，可提交到 Git
└── .gitignore         # 自动忽略数据库、WAL 文件和 flows/
```

SQLite 使用 WAL 和 busy timeout。主要数据表及用途：

| 表 | 内容 |
| --- | --- |
| `cf_drafts` / `cf_versions` | CF 草稿与不可变 CF 版本 |
| `flow_drafts` / `flow_versions` | Flow 草稿与不可变 FlowPlan |
| `flow_compilations` | preview/test 编译快照 |
| `runs` / `ledger_events` | Run 当前状态与追加式执行事实 |
| `jobs` | 带 lease 的待执行任务 |
| `approvals` | 人工审批决定 |
| `runtime_profiles` / `runtime_current` | Runtime Profile 历史与当前指针 |
| `resource_profiles` / `workspace_settings` | 资源绑定和工作区设置 |

`CF_DB` 已不再支持。设置该变量会在监听端口前退出，以保证启动目录始终是唯一数据作用域；旧版 `data/cf.sqlite` 不会自动读取、迁移或删除。

## Runtime 与安全边界

CFlow 内置 Codex 和 Claude Code，也支持通过 manifest 接入其他 ACP 或普通 CLI Agent。Runtime Profile 是不可变配置快照；更新设置会创建新版本，发布的 Flow 只引用发布时 pin 的版本。

Runtime 发现包括：内置 adapter、PATH 中的 ACP、npm 包 `cflowAgent` 字段、用户 manifest 和项目 manifest。后出现的同 ID 配置覆盖先前配置，项目级配置可以覆盖用户级配置；无效 manifest 会跳过并在设置页显示警告。

项目级 manifest 路径为 `<workspace>/.cflow/agents.d/*.json`，用户级路径为 `~/.config/cflow/agents.d/*.json`。最小配置：

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

`backend` 支持 `acp` 和 `cli`。所有进程都使用 argv 数组启动，不经过 shell 拼接。Process Runtime 提供独立子进程、工作区内限定 cwd、环境变量白名单、参数化启动、超时、取消和输出大小限制；除非具体 adapter 声明，否则不承诺网络隔离或主机级文件系统沙箱。

权限以 CF 的 effects 为依据：已声明且位于工作区内的读写和命令操作可以自动授权；未声明能力或工作区外路径会被拒绝。Flow 中的人工审批节点仍需明确批准。密钥值不写入 CFlow 数据库，只按允许的变量名从服务端环境继承。

## 安装与运行

需要 Node.js 22 或更高版本。

从 npm 启动：

```bash
npx @hmj-ai/cflow
```

或全局安装后在目标工作区启动：

```bash
npm install -g @hmj-ai/cflow
cd /path/to/your/workspace
cflow
```

从源码运行：

```bash
pnpm install
pnpm run build
pnpm start
```

默认访问 `http://127.0.0.1:3000`。服务默认只监听回环地址，因为 Runtime 可以启动本机受控进程。只有配置好外部认证和网络访问控制后，才应通过 `HOST` 改为其他监听地址。

开发模式：

```bash
pnpm run dev       # Fastify + tsx
pnpm run dev:web   # Vite，默认 127.0.0.1:5173，/api 代理到 3000
```

## API 能力概览

后端 API 按领域分组：

- `/api/workspace`：当前工作区；
- `/api/settings`、`/api/runtimes/*`：设置、Runtime 发现、健康检查和 Profile；
- `/api/cfs`、`/api/cf-drafts/*`：CF 草稿与版本；
- `/api/flows`、`/api/flow-drafts/*`、`/api/flow-compilations`：Flow 草稿、版本和编译快照；
- `/api/flow-tests`：使用临时版本执行测试；
- `/api/runs`：启动、取消、审批、查看运行详情和 SSE 事件；
- `/api/flow-agent/chat`：基于工作台快照进行回答或草案修订；
- `/api/resource-profiles/*`：资源 Profile 的管理和绑定。

## 开发与验证

```bash
pnpm test
pnpm run typecheck:web
pnpm run format:check
pnpm run build
```

技术栈：TypeScript、Fastify、React、XYFlow、better-sqlite3、Vite 和 Agent Client Protocol。生产构建输出到 `dist/`；npm 包包含 `dist`、`README.md` 和 `DESIGN.md`。

视觉令牌、组件规则和交互原则见 [`DESIGN.md`](./DESIGN.md)。产品目标和用户边界见 [`PRODUCT.md`](./PRODUCT.md)。
