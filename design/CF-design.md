# CFlow 核心架构设计 v2.0

> 状态：当前实现基线，更新于 2026-08-31。
> 事实源：`src/types.ts`、`compiler.ts`、`engine.ts`、`runtime.ts`、`server.ts` 及对应测试。

## 1. 架构结论

CFlow 采用两级编程模型：

```text
CFDraft ──compileCF──> CFVersion(CFProgram + programHash)

FlowDraft ──compileFlow──> FlowPlan + planHash
    └─ 发布时 pin CFVersion 与 Runtime Profile version

Run
  └─ Flow Engine 解释 FlowPlan
       └─ CF Runtime 解释 CFProgram
            └─ AgentExecutor 执行当前 agent/call step
```

高层控制图由人编辑并在发布前冻结。Agent 可以在当前 CF step 内完成开放任务，但不能选择下一 Flow 节点、改变审批结果、扩展资源权限或改写发布版本。

## 2. 当前模块地图

| 模块                  | 职责                                               | 直接调用方                     |
| --------------------- | -------------------------------------------------- | ------------------------------ |
| `types.ts`            | 领域类型与 Runtime traits                          | 全部服务端模块、前端共享类型   |
| `contract.ts`         | Ajv Schema 编译和数据校验                          | Compiler、Engine               |
| `hash.ts`             | 稳定键排序与 SHA-256                               | Compiler、Engine、Server       |
| `compiler.ts`         | CFDraft/FlowDraft 的确定性 lowering 和图校验       | HTTP compile/test/publish      |
| `engine.ts`           | ready-set 调度、CF 解释、重试、取消、审批与 Ledger | Server、Engine tests           |
| `db.ts`               | SQLite Store、Run/Ledger/Job/Profile 持久化        | Server、Engine、RuntimeManager |
| `runtime-manifest.ts` | manifest 校验、发现和覆盖                          | RuntimeManager                 |
| `runtime.ts`          | Profile、健康检查、ACP/CLI 执行和权限适配          | Server、Engine registry        |
| `workspace.ts`        | 工作目录 realpath、读写权限与 containment          | Server、Runtime                |
| `server.ts`           | API、提案/助手语义组件、资源解析和 Engine 装配     | React 前端                     |

当前是模块化单体，不存在独立 compiler service、worker service 或 remote catalog service。

## 3. CF 领域模型

### 3.1 CFDraft

`CFDraft` 是用户可维护源对象：

```ts
interface CFDraft {
  cfId: string
  revision: number
  name: string
  does: string
  input?: string
  output?: string
  process?: string
  inputContract?: Json
  outputContract?: Json
  effects?: CapabilityEffect[]
  defaultExecutor?: string
  program?: CFProgram
}
```

当前 effect 只有三种，scope 固定为 workspace：

- `file-read`
- `file-write`
- `command`

`input`、`output` 和 `process` 是自然语言指导；真正的运行门禁是 JSON Contract、声明 effect、工作目录和 Runtime permission adapter。

### 3.2 CFProgram 0.1

`CFProgram` 是单个 CF 内的函数局部程序：

- `agent`：把 task 与解析后的 input 交给当前 Runtime；
- `call`：调用注册表中由 `target.ref.id` 指定的 executor；
- `guard`：在受限表达式上选择 `then` / `else`；
- `return`：从 input 或 `$local.<step>.output` 返回。

step index 是稳定 ID，不要求等于数组下标。Runtime 先构造 `Map<index, step>`，因此重复 index、缺 entry、坏 next、环和不可达 step 都在编译期拒绝。

当前引用能力：

- `$input` / `$inputContext`
- `$local.<index>.output`
- `$local.<index>.output.<path>`

当前 guard 操作符：

- `$eq`
- `$and`
- `$or`
- `$get`

没有任意 JavaScript eval。

### 3.3 默认编译

当 CFDraft 没有显式 `program` 时，`compileCF` 生成两步程序：

```text
0 agent(task = does + input/output/process guidance, input = $inputContext)
1 return($local.0.output)
```

默认 limits：

| 限制                |    值 |
| ------------------- | ----: |
| `maxStepExecutions` |     8 |
| `maxExternalCalls`  |     2 |
| `maxOutputBytes`    | 65536 |

`maxExternalCalls` 当前被校验并写入 IR，但解释器尚未单独计数执行；实际外部执行仍受 step 上限、Runtime timeout 和输出上限约束。这是已知实现缺口，不能把它描述成已执行门禁。

### 3.4 CFVersion 与完整性

版本号当前直接由 draft revision 生成：`<revision>.0.0`。

`programHash` 覆盖：

```text
inputContract + outputContract + program
```

执行前 Engine 重算 hash；不一致时以 `PROGRAM_HASH_MISMATCH` 失败。当前 hash 使用递归对象键排序的 canonical JSON，不声称完整实现 RFC 8785。

## 4. Flow 领域模型

### 4.1 FlowDraft

`FlowDraft` 是当前主要维护对象：

```ts
interface FlowDraft {
  flowId: string
  revision: number
  name: string
  objective: string
  workspaceRoot: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  resources?: ResourceRequirement[]
  limits?: {
    maxConcurrency?: number
    maxNodeDispatches?: number
  }
}
```

`bindings` 字段仍为兼容旧数据保留，但已标记 deprecated。当前正式数据交接是把完整 Flow 输入和所有已激活上游输出组装成节点输入上下文：

```json
{
  "flowInput": {},
  "upstream": [
    {
      "nodeId": "step-1",
      "nodeName": "能力名称",
      "output": {}
    }
  ]
}
```

没有上游时，可附加节点 `inputDefaults`。Engine 仍能读取旧 Plan 中的 field binding，但新设计不再依赖它。

### 4.2 节点

| kind       | 当前语义                                                                |
| ---------- | ----------------------------------------------------------------------- |
| `cf-call`  | 调用固定 CFVersion；可选 executor、contract override 和 stop/retry 策略 |
| `branch`   | 计算受限 `cond`，返回 case id；每个 case 对应一条 `branch-case` edge    |
| `join`     | `all` 等全部激活上游；`any` 任一激活上游完成即可进入                    |
| `approval` | Run 暂停，等待显式 approved/rejected                                    |
| `output`   | 终止节点；单上游时直接返回其 output，否则返回完整输入上下文             |

`join.onUpstreamFailure = continue-eligible` 可忽略普通失败依赖，让仍然可激活的路径继续。

### 4.3 Edge

控制边从 `$entry` 或节点 ID 指向节点 ID。可选 outcome：

- `completed`
- `failed`
- `branch-case` + `caseId`
- `approved`
- `rejected`

branch-case 只能从 branch 发出；approved/rejected 只能从 approval 发出。

### 4.4 Flow 编译门禁

`compileFlow` 当前验证：

1. workspaceRoot 非空；
2. 节点非空、ID 非空且不重复；
3. 每个 CF 引用存在；
4. CF 节点 contract 可由 Ajv 编译；
5. 至少一个 `$entry` edge；
6. edge ID 唯一且两端存在；
7. 全图无环，所有节点从 entry 可达；
8. 至少一个 output，且 output 无出边；
9. 所有非 output 节点至少有一条出边；
10. branch case 唯一、完整，并与出边一一对应；
11. resource requirement ID 唯一且 type 非空；
12. concurrency 与 dispatch limit 为正数。

当前编译器允许多个 output，只要图仍满足上述约束；Engine 在第一个完成的 output 成为 terminal candidate 后停止接纳新节点，并等待已在执行的节点排空。这不等价于编译期证明“所有路径唯一终止”，文档和 UI 不应作更强承诺。

### 4.5 FlowPlan 0.5

编译把 source node ID 映射为稳定数组 index，edge 端点改成 index，并把 CF `programHash` 写入节点。

默认 limits：

- `maxConcurrency = 2`
- `maxNodeDispatches = 32`

发布和测试时 Server 会进一步解析每个 CF 节点使用的 Runtime，检查健康状态，写入：

```ts
executorProfile: {
  id: string
  profileVersion: number
}
```

随后重算 `planHash`。运行时若重算不一致，Run 以 `PLAN_HASH_MISMATCH` 失败。

## 5. 测试、发布与运行

### 5.1 编译预览

`POST /api/flow-compilations` 编译 candidate CF 与 FlowDraft，固定可用 Runtime Profile，保存 `mode: preview` 的 `FlowCompilationSnapshot`。它不发布、不创建 Run。

### 5.2 测试

`POST /api/flow-tests`：

1. 验证工作目录；
2. 在内存中编译 candidate CF；
3. 编译 Flow 并固定 Runtime Profile；
4. 解析 Resource Profile；
5. 保存 `mode: test` 编译快照；
6. 创建 `test:<runId>` 临时 Plan/Catalog；
7. 启动真实 Engine Run。

测试不会写入 `cf_versions` 或 `flow_versions`。服务进程重启后，内存中的 test Plan/Catalog 不保证恢复。

### 5.3 发布

前端先发布 candidate CFDraft，再用得到的精确 CFVersion 更新 FlowDraft 引用并发布 Flow。服务端保存 FlowDraft 与 `flowId@flowVersion` 的不可变 FlowPlan。

UI 门禁要求当前草稿测试通过才显示可发布；服务端 `POST /api/flows` 本身不会查询并验证某次 passing test snapshot。因此“测试后才能发布”当前主要是产品层门禁，不应误写成服务端强制不变量。

### 5.4 运行

`POST /api/runs` 只接受已发布 FlowVersion。它重新验证 workspaceRoot，解析资源绑定，创建 Run/Job 后启动 Engine。

## 6. Engine 调度语义

### 6.1 ready-set

Engine 根据 incoming edge 状态计算节点：

- active：上游 outcome 与边条件匹配；
- inactive：上游已结束但条件不匹配；
- pending：上游尚未结束。

普通节点等待所有 incoming edge settle，且至少一条 active。join-any 在任一 active incoming 出现后即可 ready。

### 6.2 并发和终止

- 同时执行数不超过 `maxConcurrency`；
- dispatch 数达到 `maxNodeDispatches` 时失败；
- output 完成后关闭 admission，不再启动新节点；
- 已经 in-flight 的节点会排空后再提交 `run.completed`；
- 没有 terminal output 时以 `NO_TERMINAL_OUTPUT` 或 `FLOW_STALLED` 失败。

### 6.3 错误和重试

Flow 层 `cf-call.onError = retry` 会从 CF 入口重新执行整个 CF，最大次数由 `maxAttempts` 限定。Runtime error 若明确 `retryable: false` 或 `effectState: unknown`，不会自动重试。

CF step 层还支持：

- `retry`：重试当前 step；
- `continue`：写入 fallback 后继续；
- `fail-cf`：失败退出。

当前解释器不会在使用 continue fallback 前单独执行 step-level outputContract 校验；最终仍由 CF/Flow output contract 校验。不能把更细粒度门禁写成已实现。

### 6.4 审批

approval 节点第一次 ready 时写入 `approval.requested`，Run 进入 `waiting-approval` 并返回。审批 API 验证 Run 状态和节点 kind，写入 `approval.approved/rejected` 后重新启动 Engine。恢复逻辑把决定视为该节点的 completed value，后续只激活匹配的 edge。

测试 Run 在当前 UI 中会自动批准 waiting approval；正式 Run 要求用户操作。

### 6.5 取消与未知副作用

取消通过 AbortSignal 传递到 executor。ACP/CLI 子进程先 SIGTERM，之后 SIGKILL。若 file-write/command 已经可能开始，取消或超时的 `effectState` 可以是 unknown；Engine 将 Run 置为 `needs-reconciliation`，不继续下游。

## 7. Run Ledger 与恢复

Ledger event 在单个 Run 内以事务分配递增 `seq`。主要事件：

- `run.started/completed/failed/cancelled/needs-reconciliation`
- `node.started/completed/failed/retry/inactive/blocked`
- `approval.requested/approved/rejected`
- `resources.bound`
- `resource.access`

Job 领取使用 SQLite lease。恢复时 Engine 重放 Ledger 中的节点终态；发现开始但没有提交终态的节点时不自动重放，而是进入 `needs-reconciliation`。

当前没有独立 CF-call/step audit 表、attempt 表、effect-start/effect-commit 两阶段事件或完整 Execution Receipt 对象。Run 行和 Ledger 共同组成当前证据。

## 8. Resource 与 workspace

`ResourceRequirement` 随 FlowPlan 冻结；创建 Run 时通过 Resource Profile 解析：

- 未知 requirement 拒绝；
- 同一 requirement 多个 binding 拒绝；
- required 缺失拒绝；
- type 不匹配拒绝；
- resourceId 为空拒绝。

解析后的 `ResolvedResource` 快照写入 Run，并传给 executor。当前资源仍是声明性标识，不存在通用 Connector 层替用户实际挂载邮箱、数据库或对象存储。

每个 Flow 固定一个可读写的绝对 `workspaceRoot`。首次存储后不能更换；路径 realpath 或权限失效时，操作型 API fail closed。

## 9. Runtime 边界

- Builtin echo 仅用于内部测试，不出现在用户可选 Runtime 中。
- Codex 与 Claude Code 是内置 manifest，实际通过 ACP server。
- 其他 Agent 通过 PATH ACP、package/user/project manifest 发现。
- 发布/test compile 只接受 health 为 available 的 Runtime。
- Agent 请求只包含当前 CF task、当前 input、声明 effect、授权资源和 output schema；不包含完整 FlowPlan 供其改写。
- JSON Runtime 输出必须能解析；CF/Flow Contract 之后再次校验。

## 10. 当前不变量

| ID     | 不变量                                             |
| ------ | -------------------------------------------------- |
| INV-1  | 用户编辑 Draft，不直接编辑 Program/Plan index。    |
| INV-2  | Flow Engine 决定调度；Agent 不决定下一节点。       |
| INV-3  | Program/Plan 执行前都校验 hash。                   |
| INV-4  | 图结构和 edge source kind 由编译器验证。           |
| INV-5  | Runtime Profile 在 test/publish 时固定到精确版本。 |
| INV-6  | 已发布 Run 不调用 Flow 提案组件重新规划。          |
| INV-7  | 工作目录首次绑定后不可变，运行前重新验证。         |
| INV-8  | 必需 Resource 未绑定时不创建可运行 Run。           |
| INV-9  | Agent 文本不能伪造审批、Ledger 或成功状态。        |
| INV-10 | started 未 commit 的恢复节点不自动重放。           |
| INV-11 | 未知副作用关闭下游并进入人工核对状态。             |
| INV-12 | output contract 不通过时不提交节点完成。           |

## 11. 已知限制与后续演进

当前明确限制：

- 服务端没有强制“passing test snapshot 才可发布”；
- `maxExternalCalls` 尚未计数；
- CF step `outputContract` 与 continue fallback 未逐步校验；
- test Plan/Catalog 保存在进程内，重启后不可恢复；
- field-level binding 只保留兼容路径，新模型传完整上游输出；
- branch 条件语言很小，没有独立静态类型检查；
- 多 output 的唯一终止性没有编译期证明；
- 只有单 Worker/单进程恢复语义。

后续实现上述能力时，应先补测试和领域类型，再更新本文。团队、多租户、云端调度、强沙箱、通用 Connector 和 Flow-as-CF 都属于规划，不是当前设计基线。
