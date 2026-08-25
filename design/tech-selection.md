# CF Platform 技术选型与实现约束 v0.1

> 适用范围：个人本机版首发（M0–M2）
>
> 目标：把 `CF-design.md`、`product-design.md`、`frontend-design.md` 和 `llm-prompt-design.md` 中的架构边界落成一套可实现、可验证、可演进的技术方案。

## 1. 评审结论

现有设计的核心边界成立，不调整以下原则：

- Flow/CF 分属两级源对象，CFProgram/FlowPlan 是不可变编译产物；
- Flow Engine 只解释已发布 FlowPlan，Agent 只能在 AgentStep 内自主执行；
- `programHash`/`planHash`、权限、DAG、Binding 和运行状态由纯代码负责；
- Run Ledger 是运行事实权威，Trace 只是可丢失的观测投影；
- 外部副作用不承诺 exactly-once，未知结果必须进入 `needs-reconciliation`。

当前设计需要补充的主要实现决策：

1. 持久化、恢复、任务租约和事件回放尚未具体化；
2. `zod` 不能独立承担用户自定义 JSON Contract 的运行时校验；
3. `BranchNode.cond: string` 可能导致表达式执行不安全且难以保证确定性；
4. 本机进程不能提供强网络隔离，Executor 的安全能力必须区分“平台强制”和“adapter 声明”；
5. Ledger、Trace、实时事件和 Run Viewer 投影需要统一事件模型。

## 2. 总体架构

采用“模块化单体 + 独立执行 Worker”，首版不拆微服务，不引入 Temporal、Kubernetes 或 Redis。

```text
React/Vite Web UI
        │ REST + SSE
Fastify API / Application Service
        │
SQLite（Ledger、Draft、Version、Run、Job）
        │
Flow Engine（确定性 DAG 解释器）
        │
CF Runtime
        │
受控子进程 / LLM API / Agent SDK Adapter
```

代码按模块组织，但保持单机部署：

- `core`：领域类型、错误码、权限和版本模型；
- `compiler`：CF Compiler、Flow Compiler、Validator、Hash；
- `engine`：Flow Engine、CF Runtime、恢复、重试和取消；
- `adapters`：AgentExecutor、脚本、服务和 LLM provider adapters；
- `server`：REST、SSE、资源和凭据接口；
- `web`：Flow、CF、Run 业务界面。

## 3. 已确定技术选型

| 子系统        | 选型                                               | 实施约束                                                                                           |
| ------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 运行时        | Node.js LTS + TypeScript strict                    | 复用现有 DSL 和 Agent SDK 生态                                                                     |
| 包管理        | pnpm workspace                                     | 以模块边界替代微服务边界                                                                           |
| HTTP API      | Fastify + REST + OpenAPI                           | 不使用 GraphQL；接口版本化                                                                         |
| 实时事件      | SSE                                                | 事件带单调递增序号，支持断线续传                                                                   |
| 前端          | React + Vite + TanStack Query（M1）                | M0 使用无构建依赖的静态 HTML/DOM 工作台，保持本机首发可直接运行；业务状态边界按 React 迁移目标设计 |
| DAG 编辑      | `@xyflow/react`                                    | 只负责画布交互，不能直接编辑 FlowPlan/内部 index                                                   |
| 数据库        | SQLite（WAL）                                      | 单用户本机；所有状态提交使用事务                                                                   |
| 数据访问      | `better-sqlite3` + Drizzle ORM                     | 通过 migration 管理 schema                                                                         |
| 调度          | 自研持久化 Scheduler + SQLite Job Lease            | 首版不依赖 Redis/BullMQ                                                                            |
| Flow 执行     | 自研事件驱动 DAG Engine                            | ready-set、并发、失败传播和终止语义由代码实现                                                      |
| 并发          | Engine 内置 semaphore                              | 默认单 Run 2、全局 4，可配置且写入 Receipt                                                         |
| 外部进程      | Node `child_process`                               | timeout、abort、进程树终止、cwd 白名单、env scrubbing                                              |
| Contract      | Zod + Ajv 8                                        | Zod 校验平台内部对象；Ajv 校验动态 JSON Schema                                                     |
| Branch 表达式 | 受限 JSONLogic AST                                 | 禁止任意字符串 `eval`；只读取节点自身 input                                                        |
| Hash          | RFC 8785 JCS + SHA-256                             | 禁止依赖对象插入顺序、时间戳或环境值                                                               |
| ID            | UUIDv7                                             | 便于 Ledger 和 Run 按时间排序                                                                      |
| 大对象        | 本地 content-addressed 文件目录                    | SQLite 只保存 metadata、hash 和引用                                                                |
| Secret        | OS Keychain（如 keytar）                           | 数据库只保存 credential reference，不存明文                                                        |
| 日志          | Pino structured logging                            | 不把日志当作治理事实                                                                               |
| Trace         | OpenTelemetry（可选投影）                          | Trace 缺失不能改变业务结果                                                                         |
| 测试          | Vitest + Playwright + fast-check + golden fixtures | 覆盖确定性、恢复、契约和主流程                                                                     |

## 4. 持久化与恢复约束

当前实现已将 Resource Profile 纳入运行闭环：Flow 发布时冻结资源需求，创建 Run 时通过 `resourceProfileId` 解析并校验必需绑定、资源类型和唯一性；解析后的绑定写入 Run 快照，执行前传入 Executor，并以 `resources.bound` / `resource.access` Ledger 事件审计。Profile 后续修改不会影响已经创建的 Run。

至少实现以下持久化实体或等价结构：

- `cf_drafts`、`cf_versions`；
- `flow_drafts`、`flow_versions`；
- `runs`、`run_attempts`、`node_attempts`；
- `ledger_events`；
- `jobs`（状态、lease、attempt、nextRunAt）；
- `approvals`；
- `resource_profiles`、`credential_refs`；
- `blob_refs`。

状态推进、CF return、edge outcome、approval、effect marker 和 checkpoint 必须在同一个 SQLite 事务中提交。Worker 领取 Job 时写入 lease；lease 超时后允许恢复领取。恢复依据 Ledger commit position，不依据 Trace span 是否结束。

如果存在 `effect-start` 但没有 `effect-commit`，节点和 Run 必须进入 `needs-reconciliation`，关闭下游 admission，禁止自动重试。

Run Viewer 使用同一 ViewModel 支持四种来源：`live`（SSE）、`result`（数据库投影）、`trace`（诊断数据）、`combined`（合并但保留 evidence warning）。

## 5. 必须修正的 DSL/安全约束

### 5.1 Branch 条件

将 `BranchNode.cond: string` 改为受限、可序列化的 JSONLogic AST，并限制：

- 只能访问该节点的 `$input`；
- 操作符使用白名单；
- 限制嵌套深度、数组长度和执行时间；
- 编译期验证所有 case 必须在边定义中出现。

### 5.2 Contract 校验

- Zod 只用于平台内部固定结构（CFProgram、FlowPlan、Ledger event）；
- 用户定义的 `InputContract`/`OutputContract` 使用 Ajv 8 执行 JSON Schema 校验；
- 明确 JSON Schema 版本、最大深度、最大 payload 和错误码；
- Contract 不通过时不得提交 canonical return，也不得解锁下游。

### 5.3 本机执行隔离

首版只能承诺受控本机进程：独立子进程、工作目录限制、环境清理、超时/取消、工具 allowlist。不得在 UI 中笼统宣称“网络沙箱”。需要强网络或文件系统隔离时，后续增加 Docker/Firecracker Executor，并在 `ExecutorRuntimeTraits` 中明确标注强制等级。

## 6. 暂不采用与升级路径

首版暂不采用：

- Temporal 等外部工作流引擎；
- Redis/BullMQ；
- Kubernetes 和微服务部署；
- GraphQL；
- Tauri/Electron 桌面封装；
- 通用 API connector 平台；
- 团队、多租户和复杂治理模型。

达到以下条件再升级：

| 触发条件                       | 升级方向                                               |
| ------------------------------ | ------------------------------------------------------ |
| 需要多用户或远程访问           | SQLite → PostgreSQL；增加认证、租户和权限服务          |
| 并发或任务量超过单 Worker 能力 | Job Lease → Redis/托管队列；拆分 Worker                |
| 需要长时间、跨机器恢复         | 评估 Temporal；保留当前 FlowPlan/CFProgram 作为业务 IR |
| 需要强沙箱                     | 本机进程 → Docker/Firecracker Executor                 |
| Trace/Blob 规模增长            | 本地文件 → 对象存储，Ledger 仍保持独立                 |

## 7. 验收测试

- 相同 Draft、Registry 和 Compiler 版本产生相同 `programHash`/`planHash`；
- 非法引用、缺失 Binding、环、不可达节点和非终止路径在编译期拒绝；
- branch、all/any/quorum join、失败传播和 inactive 路径符合设计语义；
- 进程崩溃后可依据 Ledger 恢复，已提交节点不会重复执行；
- 未知副作用结果进入 `needs-reconciliation`，不得自动 retry 或推进下游；
- abort、timeout、预算耗尽能传播到 AgentExecutor 和子进程；
- SSE 断线后可按事件序号补发，状态不重复、不倒退；
- Trace 删除或缺失不会改变 Run 结果和 Receipt；
- Agent 输出不满足 Contract 时不能解锁下游；
- Prompt injection、结构化输出失败、未注册 executor 和能力不匹配均 fail closed；
- Playwright 覆盖“创建 Flow → 测试 → 发布 → 运行 → 查看结果”主闭环。

## 8. 默认假设

- 首版是本机单用户产品；
- 通过 localhost 浏览器访问，不封装桌面壳；
- 只运行一个 Scheduler/Worker 进程；
- 不承诺外部副作用 exactly-once；
- 未来云端迁移路径为 SQLite → PostgreSQL、SQLite Job Lease → 托管队列/Temporal、文件目录 → 对象存储。
