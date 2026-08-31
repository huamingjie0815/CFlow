# CFlow 技术选型与实现约束 v1.0

> 状态：当前实现基线，更新于 2026-08-31。

## 1. 部署形态

CFlow 当前是本机单用户、单 Node.js 进程的模块化单体。Fastify 同时提供 REST/SSE API 与 Vite 构建后的静态前端；进程内 Engine 执行 Flow，SQLite 保存草稿、版本、Run、Ledger 和 Job Lease。

```text
桌面浏览器
  └─ React 19 + TanStack Query + XYFlow
       └─ REST / SSE
            └─ Fastify 5
                 ├─ Compiler
                 ├─ Flow Engine / CF Runtime
                 ├─ Runtime Manager
                 └─ SQLite (better-sqlite3, WAL)
                      └─ ACP 或 CLI 子进程
```

默认监听 `127.0.0.1:3000`。只有外部另行提供认证和网络访问控制时，才应通过 `HOST` 改成其他地址。

## 2. 已采用技术

| 领域        | 当前选型                        | 实现约束                                          |
| ----------- | ------------------------------- | ------------------------------------------------- |
| 语言/运行时 | TypeScript 7、Node.js ESM       | 服务端与前端共享领域类型                          |
| 包管理      | pnpm workspace                  | 当前只有根包与 `web` 工作区                       |
| HTTP        | Fastify 5                       | REST 为主；错误以 `{ error }` 返回                |
| 文件上传    | `@fastify/multipart`            | 附件流式落入临时目录，再复制到 Flow 工作区归档    |
| 前端        | React 19、Vite 8                | 单页桌面工作台                                    |
| 服务端状态  | TanStack Query                  | Run 当前用 700ms 轮询；SSE API 已提供但 UI 未接入 |
| DAG 画布    | `@xyflow/react`                 | 编辑稳定 source ID，不直接编辑 Plan index         |
| 数据库      | SQLite + `better-sqlite3`       | WAL、`busy_timeout=5000`，手写建表和兼容性迁移    |
| Contract    | Ajv 8                           | 校验受限 JSON Schema 和运行时输入/输出            |
| Hash        | 稳定键排序序列化 + SHA-256      | `programHash`、`planHash` 不包含运行时状态        |
| Agent 协议  | ACP SDK 1.4、CLI 子进程         | argv 启动，不拼接 shell 命令字符串                |
| 测试        | Node test runner + `tsx --test` | 编译器、Engine、Runtime、HTTP 和 UI 辅助逻辑      |
| 图标        | Lucide React                    | 不引入位图视觉依赖                                |

当前没有使用 Drizzle、Zod、OpenAPI 生成器、OpenTelemetry、Vitest、Playwright 或 fast-check；这些不能写成已采用技术。

## 3. 构建与发布

```text
pnpm build:web     Vite 输出到 public/
pnpm build:server  tsc 输出到 dist/
pnpm build         先构建前端，再构建服务端
pnpm start         运行 dist/src/server.js
pnpm test          运行 src/*.test.ts
```

npm 包名为 `@hmj/cflow`，命令为 `cflow`。发布内容包含 `dist` 与 `README.md`；前端构建产物由服务端从 `public/` 或打包后的 `dist/public/` 提供。

## 4. 持久化模型

当前 SQLite 表：

| 表                                     | 用途                                         |
| -------------------------------------- | -------------------------------------------- |
| `cf_drafts` / `cf_versions`            | CF 源对象与不可变发布版本                    |
| `flow_drafts` / `flow_versions`        | Flow 源对象与不可变发布 Plan                 |
| `flow_compilations`                    | preview/test 编译快照                        |
| `runs`                                 | Run 状态、输入、输出和资源快照               |
| `ledger_events`                        | 每个 Run 内单调递增的事实事件                |
| `jobs`                                 | 单 Worker 的领取状态、30 秒 lease 和 attempt |
| `approvals`                            | approval 节点的显式决定                      |
| `resource_profiles`                    | 资源绑定配置                                 |
| `runtime_profiles` / `runtime_current` | 不可变 Runtime Profile 历史与当前指针        |
| `workspace_settings`                   | 默认 Runtime、默认资源 Profile、测试超时等   |

数据库默认位于 `data/cf.sqlite`，可用 `CF_DB` 覆盖。Schema 目前通过 `CREATE TABLE IF NOT EXISTS` 与列检查演进，没有独立 migration 框架。

## 5. 调度、恢复与实时事件

- `Engine.start` 在同一进程内异步执行，`maxConcurrency` 默认 2。
- Job 由 250ms 定时器领取；lease 为 30 秒。
- Ledger 已提交的 completed/failed/inactive/approval 状态可恢复。
- 进程恢复时若发现只记录 `node.started` 而没有终态，不自动重放，Run 进入 `needs-reconciliation`。
- 写文件或命令执行在取消/超时后可能产生未知副作用，Runtime 以 `effectState: unknown` 上报并停止下游 admission。
- `/api/runs/:id/events` 提供带 `id` 的 SSE 增量事件；当前 React 工作台仍轮询 `/api/runs/:id`。

这不是多 Worker 一致性实现：没有 lease 心跳、分布式锁、跨进程 executor 协调或跨机器恢复。

## 6. Runtime 与进程边界

Runtime 来源按后者覆盖前者：PATH ACP、内置 Codex/Claude Code、npm package manifest、用户 manifest、项目 manifest。具体格式见 [`../docs/agent-manifests.md`](../docs/agent-manifests.md)。

- ACP 只有完成真实 `initialize` 握手才是 available。
- CLI 通过无副作用的 `versionArgs` 探测可用性。
- 认证状态默认为 unknown，不通过可能计费的模型请求猜测。
- 环境变量只从 `envAllowlist` 继承；参数以 argv 数组传递。
- CLI 依据 effect 映射 `none/read/write/full` 权限参数。
- ACP permission request 会校验声明的 effect 与工作区路径。
- 取消先发 SIGTERM，1 秒后补 SIGKILL。

安全表述必须精确：当前只提供独立子进程、工作目录约束、环境清理、超时/取消、输出上限和部分权限校验；不能宣称通用网络隔离或主机级文件系统沙箱。

## 7. 工作目录与附件

- 每个 Flow 必须有绝对、存在、可读写的 `workspaceRoot`。
- Flow 首次保存后工作目录不可更改；测试、发布、运行和 Flow 助手会重新验证该目录。
- 普通草稿在目录暂时不可用时仍可编辑保存，但 Agent、测试、发布和运行暂停。
- skill 附件只接受文本类扩展名，拒绝隐藏路径、`..`、`.git` 和 `node_modules`。
- 附件分析最多把 400,000 个字符放入有界 Prompt；成功后归档到 `<workspace>/.cflow/flows/<flowId>/attachments`。
- 带附件的提案要求每个生成阶段提供可在原文中找到的 `sourceQuote`，否则 fail closed。

## 8. 当前明确不做

- 移动端、触控端和窄屏响应式布局；
- 原生 Tauri/Electron 壳；
- 云端多租户、团队与 RBAC；
- PostgreSQL、Redis、Temporal、Kubernetes 或微服务；
- 强网络隔离、容器或 VM 沙箱；
- 通用凭据保险库与 Connector 平台；
- exactly-once 外部副作用；
- 全量 Prompt Registry、离线评测平台和 token/cost 账单。

## 9. 升级条件

| 触发条件         | 可能演进                                           |
| ---------------- | -------------------------------------------------- |
| 需要远程多用户   | 增加认证/租户；SQLite 迁移 PostgreSQL              |
| 单进程吞吐不足   | 独立 Worker、可靠队列和 lease 心跳                 |
| 需要跨机器长任务 | 评估 Temporal，同时保留 CFProgram/FlowPlan 业务 IR |
| 需要强隔离       | 增加容器/VM Executor，并让 traits 反映真实强制能力 |
| Run 量明显增长   | UI 接入 SSE、增加分页与归档策略                    |

## 10. 验收基线

- `pnpm test` 全部通过；
- `pnpm typecheck:web` 与 `pnpm build` 通过；
- 同一输入产生稳定 hash，篡改 Plan/Program 时 fail closed；
- 环、不可达节点、缺 entry/output、非法 branch/approval edge 在编译期拒绝；
- branch、join all/any、重试、取消、审批、资源解析和恢复行为有测试覆盖；
- Runtime 不可用、输出非 JSON、Contract 不匹配和越权操作均不解锁下游。
