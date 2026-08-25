# CF Platform —— 两级 CF/Flow 编程产品设计 v0.6

> 状态：两级语言 + 人控 DAG + 运行治理闭环加固稿  
> 依赖：[`CF-design.md`](./CF-design.md)  
> 核心：用户以自然语言维护 CF 函数源、以 Flow 维护高层 DAG；CFProgram 与 FlowPlan 分别是两级编译产物，Project 不是产品中心。

---

## 0. 一句话产品定义

**用户用自然语言定义并发布可复用 CF 能力函数，再从 CF Library 自由组装 Flow，或先给定业务目标生成初始化 Flow/CF 草案；经用户审阅、两级编译、测试和发布后，由 Flow Engine 调度 CF Runtime，在函数内部按需调用多种 agent。**

产品的主价值不是“管理一批项目”，也不是“和某个 agent 连续对话”，而是让组织以低门槛形成、校准、沉淀和复用已经验证过的智能任务流程。

**目标生成不是运行时动态规划。** 它只发生在 Flow 设计期，产物是可审阅的初始化 Flow Draft 提案；在用户接受并发布前没有执行权。

---

## 1. 产品宪章

### 1.1 Flow 是第一等产品对象

Flow 是用户进入产品后主要创建、查找、维护、协作、发布和运行的对象。产品首页、权限、版本、运行记录、搜索和复用都围绕 Flow 展开。

Flow 表达一套由人定义的高层任务章法：

```text
Flow
  = CF 节点实例
  + 节点之间的连接和分支
  + 输入输出绑定
  + executor 与能力要求
  + 资源和副作用声明
  + 审批、超时和错误策略
```

Flow 不是某个项目的附件。一个 Flow 可以跨不同资源和环境重复运行，也可以被其他团队复制、定制或作为子流程复用。

创建 Flow 有两个对等入口：

1. **从目标开始**：用户描述想达成的结果；系统检索当前可用 CF/CF Version，生成带节点、连接、绑定、executor 建议和未解决项的初始化 Flow 提案。
2. **从空白或模板开始**：用户直接从 CF Library 选择节点并人工组装。

无论入口如何，生成结果都只能成为 Flow Draft 的候选变更。系统不得在设计期提案未经用户接受时执行，也不得在运行期根据目标重新规划已发布 Flow。

### 1.2 CF 是 Flow 的原子能力节点

CF 是用户可独立编写、测试、版本化和复用的智能能力定义，例如：

- 读取并归纳客户邮件
- 分析需求并形成设计约束
- 根据方案修改代码
- 审核合同风险
- 生成周报

“原子”是产品组合意义上的原子，不等于 CFProgram 只能有一个机械步骤。一个 CF 内部可包含受限 guard、注册调用和 AgentStep；agent 在 AgentStep 中自主搜索、分析和迭代实现。当某一步需要独立复用、独立契约、独立审批、跨 executor、改变 Flow 分支或产生独立副作用时，必须拆成新的 CF 并提升到 Flow。

### 1.3 两级 DSL 都是派生物，不是维护对象

用户维护两个层次的源定义，系统分别编译：

```text
CFDraft（自然语言函数源）
  ↓ cf-compiler：LLM 语义翻译 + 纯代码校验
Candidate CFProgram
  ↓ CF Test / diff / 人确认
CFVersion + programHash

FlowDraft（已发布 CFVersion + DAG 结构）
  ↓ flow-compiler：纯代码确定性 lowering
Candidate FlowPlan
  ↓ Test Snapshot / diff / 人确认
FlowVersion + planHash
  ↓ Flow Engine → CF Runtime
Flow Run
```

普通用户不直接维护 CFProgram 或 FlowPlan。产品分别提供只读“函数编译结果”和“流程编译结果”视图；任何修改都必须回到对应 CFDraft 或 FlowDraft，否则会形成双重事实来源。

### 1.4 Project 不是一级产品对象

产品不设置以 Project 为中心的导航、成员关系或生命周期。代码仓库、目录、邮箱、数据库、知识库、工单系统等统一视为 **Resource**，在 Flow 声明需要时绑定：

```text
Flow Definition      声明需要什么资源和能力
Resource Binding     指定本次/本环境具体使用哪个资源
Flow Run             在授权边界内消费资源
```

例如“代码变更 Flow”可以在运行时绑定某个 Git Repository；“客户周报 Flow”可以绑定某个邮箱和 CRM。Repository 和 Mailbox 都服务于 Flow，不反向把 Flow 收纳进某个 Project。

### 1.5 与核心架构的对应关系

| 产品概念 | 架构概念 | 权力边界 |
|---------|---------|---------|
| 用户维护的 CFDraft | 自然语言能力函数源 | 人决定函数目标、契约、过程和授权边界 |
| CF Compiler | cf-compiler | LLM 生成候选 CFProgram，纯代码校验，人确认发布 |
| 发布的 CFVersion | authoredSnapshot + CFProgram + programHash | CF Runtime 的唯一函数权威 |
| 用户维护的 FlowDraft | 人为设计的高层 Agent Loop | 人决定 CF 组合、DAG、分支和门禁 |
| Flow Compiler | flow-compiler | 确定性 lowering/校验，不理解 CF process |
| 发布的 FlowVersion | 已确认且 hash 冻结的 FlowPlan | Flow Engine 的唯一流程权威 |
| Flow Run | Flow Engine → CF Runtime → AgentExecutor | 分层机械执行，agent 不改 Program/Flow |
| Resource Binding | needs/effects/policy grants | 资源是运行输入，不是产品中心 |

---

## 2. 产品对象模型

### 2.1 对象关系总览

```text
CF
├── CF Draft（自然语言函数源）
└── CF Version（不可变）
    ├── Authored CF Snapshot
    ├── Published Contract
    ├── Compiled CFProgram
    └── Program Hash
CF Test Snapshot（短期、沙箱、不可被 Flow 引用）
        │ 进入有界 Catalog
        ▼
Flow Proposal（可选、短期、不可执行）
        │ 用户接受为 Draft Patch
        ▼
Flow
├── Flow Draft（唯一可编辑源）
│   ├── CF Node Instances
│   ├── Connections / Branches
│   ├── Bindings
│   └── Policies / Resource Requirements
├── Test Snapshot（短期、沙箱）
└── Flow Version（不可变发布版本）
    ├── Authored Flow Snapshot
    ├── Resolved CF Versions
    ├── Compiled FlowPlan
    └── Plan Hash
          │ 执行
          ▼
       Flow Run（逻辑 runId）
       ├── Attempts / continuedFrom
       ├── Runtime Inputs / Resource Bindings
       ├── CF Calls / Steps / Agent Spans
       ├── Execution Receipt
       └── Audit / Evidence Warnings
```

### 2.2 CF

CF 是可复用能力的稳定身份，保存所有版本的共同元数据：

```typescript
interface CF {
  id: string
  name: string
  description: string
  owner: PrincipalRef
  visibility: 'private' | 'team' | 'organization'
  tags: string[]
  lifecycle: 'active' | 'deprecated' | 'archived'
  latestVersion?: string
  createdAt: string
  updatedAt: string
}
```

CF 本身不直接执行；被 Flow 引用的是具体 `CFVersion`。

### 2.3 CF Draft 与 CF Version

CF Draft 是能力的唯一可编辑源：

```typescript
interface CFDraft {
  cfId: string
  revision: number
  basedOnVersion?: string
  does: string
  input: string                       // 用户自然语言 @in
  output: string                      // 用户自然语言 @out
  inputContract: InputContract        // LLM 建议、用户接受的结构化契约
  outputContract: OutputContract
  process?: string
  defaultExecutor?: string
  requiredCapabilities: string[]
  needs: ResourceRequirement[]
  effects: EffectRequirement[]
  defaultExecutionMode: 'auto' | 'needs-review'
  defaultTimeoutMs?: number
  defaultOnError: ErrorPolicy
  updatedBy: PrincipalRef
  updatedAt: string
}
```

CF Version 是不可变能力契约：

```typescript
interface PublishedCFContract {
  inputContract: InputContract
  outputContract: OutputContract
  defaultExecutor?: string
  requiredCapabilities: string[]
  needs: ResourceRequirement[]
  effects: EffectRequirement[]
  defaultExecutionMode: 'auto' | 'needs-review'
  defaultTimeoutMs?: number
  defaultOnError: ErrorPolicy
}

interface CFVersion {
  cfId: string
  version: string
  status: 'published' | 'deprecated' | 'revoked'
  authoredSnapshot: Readonly<CFDraft>   // 用户自然语言函数源
  publishedContract: Readonly<PublishedCFContract>
  compiledProgram: Readonly<CFProgram>
  programHash: string                  // canonical(contract + program)
  createdBy: PrincipalRef
  createdAt: string
}
```

用户修改 CFDraft 后，`cf-compiler` 把自然语言 `does/input/output/process` 编译成候选 CFProgram；纯代码检查局部控制流、引用、注册目标、effects 和返回契约。发布时只从 authoredSnapshot 确定性生成一份 `publishedContract`，避免和 Draft 字段双写漂移。`programHash` 使用 SHA-256 + 固定 JSON canonicalization 对 `{publishedContract, compiledProgram}` 计算；自然语言源、契约、内部程序、权限或默认策略变化都必须重新编译并产生新版本。

### 2.4 CFProgram（CF Version 的编译产物）

CFProgram 是单个 CF 的函数局部运行表示，不是 Flow DAG：

```text
CFDraft（自然语言函数源）
  → LLM 生成候选 CFProgram
  → 纯代码校验 + 测试 + 用户确认
  → CFVersion 固化 authoredSnapshot + CFProgram + programHash
```

CFProgram 可以包含受限条件、注册 script/service 调用、skill 引用、agent 智能步骤和 return；不能引用其他 CF、Flow node、Flow branch 或下一节点。它只允许 `$input`、`$local`、`$resource`、`$secret` 等函数作用域引用，执行结束只有 return value 和显式 effects 对外可见。

#### 2.4.1 CF Test Snapshot

CF 测试不能直接执行持续变化的 CFDraft。点击“测试”时创建短期不可变快照：

```typescript
interface CFTestSnapshot {
  id: string
  cfId: string
  sourceRevision: number
  publishedContract: Readonly<PublishedCFContract>
  candidateProgram: Readonly<CFProgram>
  programHash: string
  executor?: { id: string; profileVersion: string }
  sandboxPolicy: CFTestPolicy
  expiresAt: string
  createdBy: PrincipalRef
  createdAt: string
}
```

Snapshot 只允许维护者在沙箱和受限 effects 下运行，不进入 CF Library，也不能被 Flow 引用。CFDraft revision 变化后必须生成新 Snapshot；旧 Snapshot 只用于解释历史测试结果。

### 2.5 Flow

Flow 是产品第一等身份对象：

```typescript
interface Flow {
  id: string
  name: string
  description: string
  objective?: string                  // 维护者确认的业务目标/高层意图
  owner: PrincipalRef
  visibility: 'private' | 'team' | 'organization'
  tags: string[]
  lifecycle: 'active' | 'deprecated' | 'archived'
  draftRevision: number
  latestPublishedVersion?: string
  createdAt: string
  updatedAt: string
}
```

Flow 列表、收藏、最近使用、所有权、协作者、版本和运行统计都围绕该身份聚合。

### 2.6 Flow Draft

Flow Draft 是用户唯一直接编辑的 Flow 源模型：

```typescript
interface FlowDraft {
  flowId: string
  revision: number
  basedOnVersion?: string
  objective: string                   // Flow 的高层目标；可由 Proposal 初始化
  inputs: FlowInputDefinition[]
  outputs: FlowOutputDefinition[]
  nodes: FlowDraftNode[]               // 已发布 CF 实例或显式 unresolved placeholder
  controls: FlowControlElement[]       // branch / join / approval / terminal
  edges: FlowControlEdge[]             // 控制依赖：何时激活下游
  bindings: FlowBinding[]              // 数据依赖：给下游传什么
  resourceRequirements: ResourceRequirement[]
  policies: FlowPolicySet
  updatedBy: PrincipalRef
  updatedAt: string
}

type FlowDraftNode = FlowCFNode | FlowUnresolvedCFNode

interface FlowCFNode {
  kind: 'cf-node'
  id: string                         // Flow 内稳定实例 ID，不使用数组下标
  cfRef: { cfId: string; version: string }
  name?: string                      // Flow 内显示名
  executor?: { id: string; profileVersion?: string } // Draft 可选版本；发布时必须解析精确版本
  inputOverrides?: Record<string, unknown>
  executionMode?: 'auto' | 'needs-review'
  timeoutMs?: number
  onError?: ErrorPolicy
  position?: { x: number; y: number }
}

interface FlowUnresolvedCFNode {
  kind: 'unresolved-cf'
  id: string                         // 保留边和 binding 的稳定位置
  name: string
  proposedCFDraftId?: string
  reason: string
  status: 'unresolved'
  position?: { x: number; y: number }
}
```

产品源模型使用稳定 node ID；编译器可以在 FlowPlan 内生成机械 index，但 index 不应成为用户编辑或版本 diff 的身份依据。

实例级覆盖不能改写 CFVersion：executor 必须满足全部 requiredCapabilities；inputOverrides 必须通过输入契约且不能注入 secret；executionMode 只能在政策允许范围内加强审批；timeout 只能在 CF/组织允许范围内解析；Flow onError 只处理整个 CF Call。input/output contract、needs、effects、CFProgram 和 programHash 均不可覆盖。任何扩大能力或副作用的需求必须发布新 CFVersion。

### 2.7 Flow DAG：能力节点、控制元素、边与 Binding

“CF 是 Flow 的原子”指能力原子。DAG 另有三个结构层：

1. **CF Node** 定义“执行哪项能力”；
2. **Control Element / Edge** 定义“何时允许执行”；
3. **Binding** 定义“传递什么数据”。

```typescript
type FlowControlElement =
  | {
      id: string
      type: 'branch'
      condition: RestrictedCondition   // 只读取本控件 $input
      cases: Array<{ id: string; label: string }>
    }
  | {
      id: string
      type: 'join'
      mode: 'all' | 'any' | 'quorum'
      quorum?: number
      onUpstreamFailure: 'fail' | 'continue-eligible'
      resultMode: 'status-only' | 'canonical-results'
      maxResultBytes?: number
      remaining?: 'drain' | 'cancel' 
    }
  | {
      id: string
      type: 'approval'
      policyRef: string
      inputDefaults?: unknown
    }
  | {
      id: string
      type: 'terminal'
      outputId: string                // 引用 FlowOutputDefinition
      inputDefaults?: unknown
    }

type FlowControlEdge = {
  id: string
  from: '$entry' | string            // CF node ID 或 control element ID
  to: string                         // CF node ID 或 control element ID
  when:
    | { outcome: 'completed' }
    | { outcome: 'branch-case'; caseId: string }
    | { outcome: 'approved' | 'rejected' }
    | { outcome: 'failed'; code?: string }
}

type FlowBinding = {
  id: string
  from: FlowValueRef                 // flow input / CF canonical return / resource context
  to: FlowValueRef                   // CF/control/terminal input
  required: boolean
  default?: unknown                  // required=false 时必须显式声明
  maxBytes?: number                  // 省略时由 Flow policy 确定性补齐
}
```

**DAG 与 CF 的接口不变量：**

- CF 不声明 `dependsOn`，也不知道自己位于哪个 Flow；依赖属于 Flow Node Instance 和 DAG。
- Flow Draft 使用 `$entry` 控制边表达起点；编译器把这些边降级为 Plan 的 `entries[]`，PlanEdge 不重复保存 `$entry` 边。
- Binding 只能读取 CF 的正式 canonical return、Flow input 或显式 ResourceContext；不能越过 CF 边界读取 Agent 原始文本、tool transcript、`$local` 或 secret。需要原文时必须成为 CF 输出契约中的显式字段。branch condition 只读自身 `$input`，approval/terminal 的运行值同样由 Binding 或字面量 default 构造。
- Binding 引用某个上游 CF 输出时，编译器自动确保存在相应控制依赖；没有控制可达关系的 binding 是编译错误。branch、approval 和 terminal 的跨节点数据也必须形成显式 Binding。
- 控制边可以不传数据，例如“审核通过后启动发布 CF”；数据 binding 不能绕过控制图。
- 一个节点有多个 `completed` 下游边即表示并行 fan-out，不需要额外 fork 节点。
- 多个 eligible 上游汇合到一个普通 CF 时默认要求全部完成；branch 未选路径会先变为 inactive，因此简单互斥分支可直接合流。并行分支若需要 `any`、`quorum`、允许部分失败或明确汇合策略，必须经过显式 join 元素。Join 默认只产生状态；需要聚合业务值时必须选择 `canonical-results`，按稳定 source ID 汇集正式 CF return。
- branch 只发出一个已声明 case outcome；匹配控制边 activated，其余 case 边 inactive。普通节点等所有静态入边 resolved 后再判断：至少一条 activated 才可执行，全部 inactive 才把节点标记 inactive；因此互斥分支的共享下游不会被误淡出。
- terminal、branch、join、approval 都是 Flow 结构控件，不进入 CF Library，也不被当作可售卖能力。
- Flow 错误转移也必须显示为 failed 控制边；onError 只能引用现有错误边，不能隐藏 goto。
- Approval 控件表示会影响业务路径的人工决定；节点 `needs-review` 只表示执行 grants/effects 前授权，拒绝后按节点失败处理。

编译器把稳定 Flow node/control ID 降级为 Plan index、control edges 和 bindings；产品 diff、错误和审计始终映射回源 ID。

### 2.8 Flow Version

Flow Version 是一次发布的完整、不可变、可执行定义：

```typescript
interface FlowVersion {
  flowId: string
  version: string
  objective: string
  status: 'published' | 'deprecated' | 'revoked'
  authoredSnapshot: Readonly<FlowDraft>
  resolvedCFVersions: Array<{
    nodeId: string
    cfId: string
    version: string
    programHash: string
  }>
  compiledPlan: FlowPlan
  planHash: string
  releaseNotes?: string
  confirmedBy: PrincipalRef
  confirmedAt: string
}
```

发布版本必须 pin 住每个 CF 的精确版本/programHash，并在 FlowPlan 中 pin 每个 Agent 型 CF Call 的 Executor Profile 版本。某个 CF 发布新版后，已有 Flow Version 不自动变化；Flow Draft 可以收到升级提示，由维护者查看影响、选择升级、重新编译和发布。

### 2.9 Test Snapshot

Test Snapshot 是从某个 Flow Draft revision 派生的短期不可变测试对象：

```typescript
interface TestSnapshot {
  id: string
  flowId: string
  sourceRevision: number
  resolvedCFVersions: Array<{
    nodeId: string
    cfId: string
    version: string
    programHash: string
  }>
  compiledPlan: FlowPlan
  planHash: string
  sandboxPolicy: FlowPolicySet
  expiresAt: string
  createdBy: PrincipalRef
  createdAt: string
}
```

Test Snapshot 不是 Flow Version，不能被普通运行入口、定时触发器或其他 Flow 引用；它只允许维护者在沙箱和受限 effects 下执行。Draft revision 一旦变化，旧 Snapshot 仍可用于解释已完成测试，但不能代表新 Draft。

### 2.10 Flow Proposal（目标生成的短期设计提案）

Flow Proposal 是“目标 → 初始化 Flow”过程的短期、无执行权产物：

```typescript
interface FlowProposal {
  id: string
  goal: string
  targetFlowId?: string              // 为空表示建议创建新 Flow
  baseRevision?: number              // 修改现有 Draft 时用于防止应用到过期版本
  proposedInputs: FlowInputDefinition[]
  proposedOutputs: FlowOutputDefinition[]
  proposedNodes: ProposedFlowNode[]
  proposedControls: FlowControlElement[]
  proposedEdges: FlowControlEdge[]
  proposedBindings: FlowBinding[]
  proposedResourceRequirements: ResourceRequirement[]
  proposedCFDrafts: ProposedCFDraft[]  // Catalog 缺口的显式能力草案，无执行权
  assumptions: string[]
  unresolved: Array<{
    code: 'MISSING_CF' | 'PROPOSED_CF_REQUIRED' | 'AMBIGUOUS_CF' | 'UNBOUND_INPUT' | 'RESOURCE_REQUIRED' | 'EXECUTOR_REQUIRED' 
    message: string
    affectedIds?: string[]
  }>
  sourceCatalogRevision: string      // 生成时使用的 CF Library 快照
  generatedAt: string
  expiresAt: string
}

interface ProposedCFDraft {
  tempId: string
  name: string
  does: string
  input: string
  output: string
  process: string
  rationale: string
  status: 'needs-user-review'
}

type ProposedFlowNode = ProposedExistingCFNode | ProposedMissingCFNode

interface ProposedExistingCFNode extends FlowCFNode {
  kind: 'existing-cf'
  rationale: string
  alternatives?: Array<{ cfId: string; version: string; reason: string }>
  confidence?: number
}

interface ProposedMissingCFNode {
  kind: 'missing-cf'
  id: string                         // Proposal 内稳定 placeholder ID
  proposedCFTempId: string           // 引用 ProposedCFDraft.tempId
  name: string
  rationale: string
  status: 'unresolved'
  position?: { x: number; y: number }
}
```

Flow Proposal 不是 Flow Draft、Test Snapshot 或 Flow Version：

- 它不能被 flow-engine 执行，也不能被普通运行入口引用。
- `existing-cf` 节点必须引用当前 Library 中真实、可见、已发布的精确 CFVersion；找不到匹配能力时只能生成 `missing-cf` placeholder + unresolved + ProposedCFDraft。能力草案必须经过用户编辑、CF 编译、测试和发布后，才能替换 Flow 中的 unresolved placeholder。不能静默伪造可执行 CF。
- 用户必须在 Flow Editor 中查看目标、CF 选择理由、替代项、bindings、资源、effects 和未解决项；接受后由应用层以结构化 patch 写入 Flow Draft 并增加 revision。
- CF Library 或目标 Flow Draft 已变化时，必须检测 `sourceCatalogRevision/baseRevision` 冲突并重新生成或重放选择，不能盲目应用旧提案。

### 2.11 Flow Run

Flow Run 是某个已发布 Flow Version 的一次运行记录，不是新的维护对象：

```typescript
interface FlowRun {
  id: string                           // 逻辑 runId；恢复后保持不变
  flowId: string
  flowVersion: string
  planHash: string
  mode: 'test' | 'released'
  status:
    | 'queued' | 'running' | 'waiting-approval'
    | 'completed' | 'failed' | 'aborted' | 'timeout' | 'budget-exhausted'
    | 'needs-reconciliation' 
  inputs: Record<string, unknown>
  resourceBindings: ResourceBinding[]
  startedBy: PrincipalRef
  attempts: FlowRunAttempt[]
  latestAttempt: number
  output?: { outputId: string; value: unknown }
  receipt?: FlowExecutionReceipt
}

interface FlowRunAttempt {
  attempt: number
  traceId: string
  rootSpanId: string
  continuedFrom?: { attempt: number; traceId: string; rootSpanId: string }
  status: FlowRun['status']
  startedAt: string
  finishedAt?: string
  checkpointRef?: string
  ledgerIntegrity: 'verified' | 'partial' | 'invalid'
  telemetry: 'complete' | 'partial' | 'unavailable'
  evidenceWarnings: EvidenceWarning[]
}

interface EvidenceWarning {
  code:
    | 'TRACE_INCOMPLETE' | 'TIMING_UNAVAILABLE' | 'USAGE_UNAVAILABLE'
    | 'DETAILS_REDACTED' | 'LAYOUT_DEGRADED' | 'SCHEMA_PARTIAL'
  message: string
  affectedIds?: string[]
}
```

运行历史始终从 Flow 进入查看，同时提供跨 Flow 的全局 Runs 页面用于运维排障。恢复执行复用逻辑 `runId`，增加 attempt 和新的 trace/root span，并通过 `continuedFrom` 连接；不得把恢复伪装成原 attempt 的连续日志。`ledgerIntegrity` 回答治理事实是否可验证；`telemetry` 回答 timing/token/tool 等诊断证据是否完整，二者不能合并成一个状态。

### 2.12 Flow Execution Receipt（实际执行收据）

Execution Receipt 是运行完成后由权威 Run Ledger 生成的事实摘要；Trace 只补充 timing、LLM/tool span 和 token/cost 等诊断信息。不读取 agent 自述来推断“已执行/已审核”：

```typescript
interface RunLedgerEntry {
  sequence: number
  runId: string
  attempt: number
  kind:
    | 'node-state-committed' | 'cf-return-committed' | 'edge-outcome'
    | 'approval-decided' | 'effect-committed' | 'resource-accessed'
    | 'checkpoint-committed' | 'run-finished'
  sourceId: string
  idempotencyKey?: string
  payloadHash?: string
  timestamp: string
}

interface FlowExecutionReceipt {
  id: string
  runId: string
  attempt: number
  flowRef: { flowId: string; version: string; planHash: string }
  cfCalls: Array<{
    flowNodeId: string
    cfId: string
    cfVersion: string
    programHash: string
    executor: { id: string; profileVersion: string }
    actualBackend?: { adapterVersion?: string; model?: string; provider?: string }
    attempts: number
    status: string
  }>
  activatedEdges: string[]
  inactiveEdges: string[]
  effectsPerformed: Array<EffectReceipt & {
    state: 'committed' | 'compensated' | 'unknown'
    idempotencyKey?: string
  }>
  approvals: ApprovalReceipt[]
  resourcesAccessed: ResourceAccessReceipt[]
  usage: { inputTokens?: number; outputTokens?: number; cost?: number; durationMs: number }
  ledgerIntegrity: 'verified' | 'partial'
  telemetry: 'complete' | 'partial' | 'unavailable'
  missingTelemetry?: string[]
}
```

Receipt 用于对照“已发布计划”与“实际发生”：CFVersion/programHash、executor、重试、激活路径、effects、审批和资源访问。治理结论以 Run Ledger/Receipt 为准；Trace 缺失只让诊断证据降级为 partial，不能抹掉已经提交的治理事实。agent 输出里写“已经审查”不能替代真实审核节点、approval 或依赖链。Ledger 缺失/校验失败时不得生成 `ledgerIntegrity=verified` Receipt；Trace 缺失只降低 telemetry，不改变已由 Ledger 证明的 edge/effect/approval 事实。

### 2.13 Resource 与 Resource Binding

Resource 是外部资源的可授权引用，不是 Project：

```typescript
interface Resource {
  id: string
  type: 'repository' | 'directory' | 'mailbox' | 'database' | 'knowledge-base' | 'api' | string
  name: string
  provider: string
  metadata: Record<string, unknown>
}

interface ResourceBinding {
  requirementId: string
  resourceId: string
  scope: string[]
  credentialRef?: string
  environment?: string
}
```

Flow 声明抽象 requirement，例如“一个只读邮箱”或“一个可写代码仓库”；运行环境或运行者把 requirement 绑定到具体 Resource。这样同一 Flow 可以在开发、测试、生产或不同团队资源上复用。

---

## 3. 核心用户心智

产品应让用户形成下面的简单认识：

```text
CF：我用自然语言定义、编译并发布的一项能力函数
CFProgram：系统为单个 CF 生成的函数内部程序，我通常只看语义摘要
Flow：我把这些函数按章法组织起来的任务流程
CFVersion：我已经验证并允许复用的函数版本
FlowVersion：我已经验证并允许复用的流程快照
Run：这个版本的一次逻辑执行，可包含恢复后的多个 Attempt
Receipt：系统根据实际执行证据生成的事实收据
Resource：这次执行获准使用的外部数据或工作对象
DSL：系统为执行生成的内部程序，我通常不用维护
```

用户不需要先创建 Project 才能创建 CF 或 Flow，也不需要理解 agent session。创建产品资产有两条一等路径：“描述目标 → 审阅初始化 Flow 提案 → 编辑 Flow → 编译发布”，或“编写/选择 CF → 直接组装 Flow → 编译发布”。

---

## 4. 核心用户旅程

### 4.1 从目标生成初始化 Flow

这是面向普通用户的推荐入口，但不是唯一入口：

1. 用户输入业务目标，例如：“读取本周客户邮件，识别紧急需求，形成按客户分类的周报；高风险事项先人工审核。”
2. 用户选择可选约束：期望输出、可用团队 CF 范围、允许的 executor、资源类型、成本/时限偏好。未选择的约束不能由系统推断成额外权限。
3. **Flow Composer** 读取一个有界、结构化的 CF Catalog Manifest，只包含用户可见的已发布 CF：`cfId/version/name/does/input/output/capabilities/needs/effects/defaultExecutor/验证状态`，不读取实现提示词、凭据或工具实现。
4. Composer 生成 `FlowProposal`：选择已有 CF、建议顺序/分支/bindings/executor/resource requirements，并为每个选择提供理由、替代项和置信度。
5. 系统用纯代码验证提案：CF Version 是否真实可见、契约能否连接、图是否终止、effects 是否显式、资源需求是否完整。无法满足的部分进入 `unresolved`；Composer 可以提出 `ProposedCFDraft`，但它不是可执行节点，必须先经过 CF 编译、测试和发布。
6. Flow Editor 用三个同步视角展示提案：**目标解释**（阶段/假设/未解决项）、**DAG 预览**（节点/并行/门禁）、**语义 Diff**（将如何修改 Draft）。每个 CF 节点显示选择理由、精确版本、替代项、置信度以及新增 needs/effects。
7. 用户可逐项接受、替换、删除、改线或“全部接受”。所有操作都生成 FlowDraft Patch；不允许直接编辑或运行 Proposal/FlowPlan。
8. 用户点击“接受为 Draft”后，系统把已接受的结构化 patch 写入 Flow Draft 并产生新 revision；随后仍走既有的编译、Test Snapshot、发布门禁和 Flow Version 流程。

```text
业务目标 + 可选约束 + 有界 CF Catalog
              ↓ Flow Composer（LLM 只提议）
         Flow Proposal（不可执行）
              ↓ 纯代码验证 + 可视化 diff
        用户编辑、替换、接受
              ↓
          Flow Draft（唯一编辑源）
              ↓ 既有编译/测试/发布流程
          Flow Version + FlowPlan
```

这个入口借鉴动态工作流的“目标驱动规划”，但明确改变权力边界：**OMA 在运行时用 Coordinator 生成 DAG；CF Platform 在设计期生成可编辑 Flow 提案，最终高层 Loop 仍由人维护和发布。**

### 4.2 编写 CF

用户可以从全局 CF Library 创建 CF，也可以在编辑 Flow 时选择“新建 CF”。无论入口在哪里，最终都会形成独立 CF 身份，而不是埋在某个 Project 或某次对话中。

最小编辑界面：

1. **做什么**：这项能力完成什么目标。
2. **需要什么**：业务输入和资源要求。
3. **产出什么**：输出契约和关键断言。
4. **如何完成**：节点内方法提示，可选。
5. **谁来执行**：默认 executor 或 capability 要求。
6. **允许做什么**：needs、effects、审批模式和超时。

编辑器用自然语言为主，同时实时生成结构化契约草案。LLM 可以建议字段，但用户接受后才进入 CF Draft。

CF 的发布流程是：

```text
CFDraft
  → 编译候选 CFProgram
  → 展示函数内部步骤、注册调用、条件、return、effects 语义摘要
  → 创建不可变 CF Test Snapshot
  → 沙箱测试（含 agent/script/service mock 或真实受限调用）
  → 用户确认
  → 发布不可变 CFVersion + programHash
```

普通用户不直接维护 CFProgram；任何自动修复必须回到 CFDraft 或形成可审阅的 CF Draft Patch。

### 4.3 组装 Flow

用户进入 Flow Editor 后可以：

- 从 CF Library 搜索、筛选并拖入已发布 CF。
- 在当前位置创建新 CF，并立即作为节点引用。
- 连接控制边；一个节点连向多个下游即表示并行执行。
- 添加 branch、join、approval 和 terminal 结构控件。
- 将上游 CF 的正式 return 字段映射到下游输入；原始 Agent/Tool 输出不会出现在 Binding 选择器中。
- 当 CFProgram 含 AgentStep 时，为节点选择 executor 或沿用 CF 默认；纯 service/script 型 CF 不强制 executor。
- 配置资源要求、effects、超时和错误策略。
- 选择一个现有 Flow 作为模板复制，但复制后得到独立 Flow Draft。

“自由组装”意味着用户可以自由设计高层章法，不意味着任何节点都必然兼容。编辑器负责尽早提示，编译器负责严格阻止不可执行组合。

### 4.4 设计 DAG、并行与汇合

Flow Editor 将“控制依赖”和“数据 Binding”分别显示，避免用户把“等谁完成”和“拿谁的数据”混成一条不可解释的线：

- **控制线**：表示目标节点何时 ready；显示 completed、branch case、approved/rejected、failed(code) 等标签。
- **数据线**：表示 canonical return 的具体字段如何进入下游输入；可配置 required/default 和大小限制，但不能选择 Agent raw output。
- 从一个节点拉出多个 completed 控制线时，编辑器提示“这些分支将并行运行”。
- 多分支汇合时，编辑器必须要求用户选择：全部成功（all）、任一成功（any）、满足数量（quorum），以及上游失败策略。
- 一个 CF 同时消费多个上游输出时，可把 CF 本身作为 `all` barrier；需要 any/quorum 时必须插入 join 控件。
- branch 未命中的分支在运行视图中显示 inactive，而不是 failed/skipped；join 只等待其语义要求的 eligible 分支。

画布应提供关键路径、可并行节点和潜在高成本 fan-out 提示，但不能替用户改变 DAG。

### 4.5 连接契约

节点连接后，产品按以下顺序辅助绑定：

1. 精确字段名和类型匹配时自动建议。
2. 存在多个候选时展示映射建议，由用户选择。
3. 需要转换、摘要或提取原始执行内容时建议增加/修改显式 CF，而不是在 binding 中隐藏智能转换或绕过 CF return。
4. 绑定接受后写入 Flow Draft，并在画布/表格中可见。
5. Flow 发布时把 binding 固化进不可变版本和 DSL。

绑定是 Flow 的重要源设计，不能只存在于编译器生成的隐藏 JSON 中。

### 4.6 编译与修复

Flow Draft 每次结构变化后触发增量检查，但只有用户主动“编译/验证”才生成完整 Candidate FlowPlan：

```text
Flow Draft
  → 拒绝尚未 resolve 到已发布 CFVersion 的节点
  → 解析全部 CFVersion/programHash 与 Executor Profile
  → 检查契约、资源、能力、控制边、并行汇合、终止路径
  → 分析可达性、环、关键路径和最大并发 fan-out
  → 生成 Candidate FlowPlan
  → 展示错误、警告和语义摘要
```

错误定位回 Flow 源对象，例如“节点「生成周报」的 `analysis` 输入未绑定”，而不是只显示“DSL node 7 BAD_REFERENCE”。高级详情可以同时给出编译节点信息。

### 4.7 测试 Flow

为了允许维护者在发布前验证 Flow，又不让 flow-engine 执行可变 Draft，测试采用不可变 Test Snapshot：

1. 维护者点击“测试”。
2. 系统基于当前 Draft 生成不可变 Candidate FlowPlan 和 hash。
3. 维护者确认本次测试摘要。
4. 系统创建短期 Test Snapshot。
5. Test Snapshot 默认运行在沙箱，禁止或逐项审批高风险 effects。
6. 测试结果关联回 Draft revision，但不能被普通用户当作正式 Flow Version 复用。

### 4.8 发布 Flow

发布页面以产品语义展示变更：

- 新增、删除或替换了哪些 CF。
- 每个节点 pin 到哪个 CF Version。
- 顺序、分支和终止路径如何变化。
- bindings 如何变化。
- executor、needs、effects 和审批要求如何变化。
- 超时和错误策略如何变化。
- 测试是否通过、验证人是谁。

发布成功后生成不可变 FlowVersion、Compiled FlowPlan 和 `planHash = sha256(canonical(FlowPlan))`。普通使用者复用该版本时不需要重新设计或重新确认高层 Loop。

### 4.9 运行 Flow

运行者执行 Flow 时只需要处理该版本暴露出来的运行参数：

1. 选择 Flow Version，默认最新可用版本。
2. 填写 Flow 输入。
3. 绑定或选择预配置 Resource Profile。
4. 查看运行前摘要：planHash、CF/executor 清单、最大并发、预算范围、高风险 effects 和所需审批。
5. 处理本次运行需要的审批并启动。
6. 在同一 Run Viewer 中查看实时状态；完成后切换为最终 trace/receipt 事实。

运行者不能在启动页面临时改节点、分支或 executor。需要改变高层 Loop 时必须回到 Flow Draft，形成新版本。

### 4.10 检查运行证据

Run Viewer 使用渐进式披露，避免把运行时内部结构强加给普通用户：

- **业务视图（默认）**：Flow DAG，回答“执行了哪条业务路径、哪里等待/失败、最终产物是什么”。
- **性能视图**：Waterfall，回答“时间和成本花在哪里、哪些 CF/Agent/Tool 并行”。
- **Evidence Inspector**：点击对象查看结构化事实；默认展示业务摘要，切换“技术证据”后才显示 hash、span、tool 和底层错误。

钻取层级保持与运行时一致：

```text
Flow DAG Node
  → CF Call（CFVersion / programHash / executor / attempt）
    → CFProgram Step（guard / call / agent / return）
      → Agent / LLM / Tool Span
```

DAG 与 Waterfall 共享选择状态：在 DAG 选中 CF 时，Waterfall 展开并定位对应 span；在 Waterfall 选择失败 Tool 时，DAG 高亮所属 CF。默认自动选中首个失败或等待审批对象。

节点状态统一为：`pending / ready / running / waiting-approval / needs-reconciliation / completed / failed / blocked / inactive / cancelled`。`failed` 表示节点自身执行失败，`blocked` 表示必要上游失败导致本节点未执行，`inactive` 表示分支路径未选择；`needs-reconciliation` 表示外部副作用结果未知，必须人工/幂等回读处理。四者不能混用。

顶部默认只显示 Status、Duration、Cost、当前/失败节点和待审批事项；FlowVersion/planHash、Attempt、Peak Concurrency、Tokens、Effects 放入可展开技术摘要。支持按 status、CF、executor、kind、resource、effect、attempt 搜索过滤，以及“只看失败路径/副作用/重试/等待审批/关键路径”。

“Published vs Actually Executed”区域展示 FlowVersion 中的计划和 Execution Receipt 中的事实差异。恢复后的 attempts 分区展示，并标记 checkpoint、continuedFrom、复用结果和需要人工处理的非幂等步骤。`needs-reconciliation` 节点提供“回读确认已提交 / 执行补偿 / 确认安全重试 / 终止”操作，且要求相应治理权限。

### 4.11 维护与升级

维护者从 Flow 页面查看：

- 当前 Draft 与最新发布版本的差异。
- 所引用 CF 是否有新版本或已弃用。
- 升级某个 CF 对契约、权限和测试的影响。
- 最近运行成功率、成本、耗时和常见失败节点。
- 当前版本被哪些团队、触发器或其他 Flow 使用。

CF 升级采用显式动作：选择目标版本 → 影响分析 → 修改 Draft → 测试 → 发布新 Flow Version。绝不自动改变已发布 Flow。

---

## 5. 信息架构

### 5.1 一级导航

```text
Flows          默认首页，产品核心
CF Library     可复用能力库
Runs           跨 Flow 运行与排障
Resources      外部资源、连接和凭据授权
Governance     审批、策略、审计和组织设置
```

不设置 `Projects` 一级入口。

### 5.2 Flows 首页

Flows 首页优先支持维护和复用：

- 最近编辑
- 我维护的
- 团队共享
- 已发布
- 草稿待处理
- 运行异常
- 收藏
- 按 owner、tag、CF、executor、状态筛选

主操作是“新建 Flow”，进入后先让用户选择：**描述目标生成初稿 / 从模板创建 / 从空白创建 / 导入 Flow 定义**。目标生成应是普通用户的推荐入口，但空白组装和模板复制保持一等能力。

### 5.3 Flow 详情页

建议标签页：

| 标签 | 主要内容 |
|------|---------|
| Design | Flow 画布、节点、连接、bindings、Draft 编辑 |
| Validate | 编译结果、错误、契约和权限检查 |
| Test | Test Snapshot、测试输入和结果 |
| Versions | 发布版本、语义 diff、回滚/弃用 |
| Runs | DAG/Waterfall、Execution Receipt、Attempt、节点/步骤证据和指标 |
| Usage | 被哪些触发器、团队或 Flow 引用 |
| Settings | 所有者、协作者、可见性、默认 Resource Profile |

Flow 详情页顶部始终显示：当前 Draft 状态、最新发布版本、最近运行健康度和主要操作（测试、发布、运行）。

### 5.4 Runs 与 Run Viewer

全局 Runs 页面用于跨 Flow 运维，Flow 详情中的 Runs 标签保留业务上下文。列表至少支持 status、Flow、CF、executor、resource、effect、时间和 evidence completeness 过滤。

单次 Run 页面采用稳定的 Operate 布局：

```text
┌─ Run 摘要 / Attempt / Published vs Actual ──────────────────┐
├─ DAG | Waterfall ───────────────┬─ Evidence Inspector ──────┤
│  主工作区                        │  Overview                  │
│  搜索 / 筛选 / Fit / 关键路径    │  I/O & Binding provenance  │
│                                 │  Program steps / spans     │
│                                 │  Grants / Effects / Approval│
│                                 │  Error / Trace / Receipt   │
└─────────────────────────────────┴────────────────────────────┘
```

实时事件和运行后 TraceStore 必须生成同一个 Run Viewer ViewModel，避免“运行中”和“运行后”出现两套状态解释。ViewModel 显式标记 `sourceMode: live | result | trace | combined`；Trace 不完整时保留 result/receipt 可证明的内容，同时显示 evidence warning，不伪造缺失 timing、token 或 tool facts。

交互状态不能只依赖颜色；状态 pill、图标和文本同时表达结果。DAG/Waterfall tabs 支持键盘导航，Inspector 选中关系通过 aria 状态表达；`prefers-reduced-motion` 下取消非必要动画。窄屏退化为“主视图在上、Inspector 在下”，不强行缩小 DAG 节点。

Run 可导出脱敏静态证据包：自包含 HTML Viewer + Execution Receipt JSON + Flow/CF hash 清单 + 审批/effect 摘要。导出物禁止网络请求，嵌入数据先统一脱敏并进行脚本上下文转义；原始 I/O 是否包含由数据分级策略决定。

### 5.5 CF Library

CF Library 不是“插件商店”的附属页面，而是 Flow 组装的原材料库：

- 搜索 `does/input/output/capabilities/tags`。
- 查看契约、权限、副作用和兼容 executor。
- 查看版本、programHash、函数编译语义摘要、维护者、验证状态和被哪些 Flow 使用。
- 创建、复制、编译、测试、弃用和发布 CF。
- 在不打开 Flow 的情况下独立测试单个 CF。

### 5.6 CF 详情页

CF 作为一级语言资产需要独立的发布工作台，建议标签页：

| 标签 | 主要内容 |
|---|---|
| Source | @what/@in/@out/process、needs/effects、默认 executor |
| Compile | Candidate CFProgram 语义步骤、source map、结构错误，只读 DSL |
| Test | CF Test Snapshot、沙箱输入、step 结果和契约校验 |
| Versions | authored/contract/program 语义 diff、programHash、弃用/撤销 |
| Usage | 被哪些 FlowVersion 引用、executor 兼容性和运行质量 |

默认界面仍以自然语言 Source 和语义步骤摘要为主；完整 CFProgram JSON、step index 和底层 trace 放在高级视图中。发布按钮必须显示 Candidate Program、publishedContract、effects 和测试状态，不能只显示自然语言文本。

### 5.7 Flow Editor

Flow Editor 同时提供三种视角，但共享同一 Flow Draft：

- **画布视角**：适合组装、分支和整体阅读。
- **大纲视角**：适合自然语言顺序编辑和普通用户。
- **绑定表视角**：适合检查跨节点数据映射。

DSL 只能作为第四种只读“编译视图”，不作为编辑源。

---

## 6. Flow 编辑器交互原则

### 6.1 先表达任务章法，再暴露技术细节

节点默认卡片只显示：CF 名称、做什么、executor、输入是否就绪、输出去向和当前校验状态。needs、effects、重试、schema 等放在可展开面板中，避免画布变成配置表。

### 6.2 自然语言与结构化编辑双向同步

自然语言辅助有两种模式，共用 `FlowProposal / FlowDraftPatch` 安全边界：

- **目标初始化**：在新建 Flow 时输入完整业务目标，系统结合有界 CF Catalog 生成初始化 Flow Proposal。
- **局部修改**：在现有 Flow Draft 中输入“在生成周报前增加风险审核”之类的意图，系统生成局部 Draft Patch。

例如用户可以输入：

> 读取客户邮件；如果没有邮件就直接返回；否则分析要点并生成周报。

产品必须先显示结构化 diff：将添加/替换哪些 CF、分支和 binding，采用了哪些 executor、needs/effects，哪些问题仍未解决；用户接受后才修改 Draft。LLM 不能直接改已发布版本或运行中的 Flow，也不能在缺少合适 CF 时把自然语言任务偷偷塞进通用 agent 节点绕过 CF Library。

### 6.3 CF 节点实例与 CF 定义分离

修改 Flow 节点的显示名、位置、输入常量或允许的运行策略覆盖，只影响该 Flow Draft。修改 CF 的目标或契约则进入 CF 编辑器并创建新 CF Version。产品必须明确提示影响范围，避免用户误以为修改一个节点会改变所有 Flow。

### 6.4 分支是有限集合

用户可以声明“当风险等级为 high 时进入人工审核，否则继续”，但 branch 的目标必须在画布上可见。agent 可以输出 `riskLevel`，不能输出可执行的任意 `nextNode`。

### 6.5 任何隐式智能都应可见

如果系统需要用 LLM 完成字段转换、内容修复、摘要或决策，这项智能应成为显式 CF，显示在 Flow 中。编译器和引擎不能暗中插入业务智能步骤。

---

## 7. 版本、复用与依赖

### 7.1 两级版本

| 对象 | 草稿 | 发布版本 | 发布后变化 |
|------|------|---------|-----------|
| CF | 可编辑 CF Draft | 不可变 CF Version | 新建版本 |
| Flow | 可编辑 Flow Draft | 不可变 Flow Version | 新建版本 |

CFProgram 和 FlowPlan 都不由用户独立版本化：前者随 CFVersion 以 `programHash` 固化，后者随 FlowVersion 以 `planHash` 固化。

### 7.2 Flow 对 CF 的依赖规则

- Draft 编辑期间始终引用一个明确 CF Version；产品可以提示有新的兼容版本，但升级必须由维护者显式执行。
- Test Snapshot 和 FlowVersion 必须解析并 pin 到精确 CFVersion + programHash。
- CF 新版不自动进入任何已发布 Flow。
- CF 被弃用时通知 Flow owner，但不破坏历史运行的可解释性。
- CF 被撤销时受影响 Flow Version 停止新运行，并给出迁移路径；历史审计保留。

### 7.3 Flow 复用方式

按产品早期复杂度，复用优先级如下：

1. **直接运行已发布 Flow Version**：不修改章法。
2. **复制为新 Flow**：形成独立维护线，适合深度定制。
3. **从模板创建**：模板是带说明和推荐绑定的 Flow 起点。
4. **Flow 作为子流程 CF**：后续能力；对外暴露稳定 I/O 契约，内部仍 pin 住 Flow Version。

早期不引入复杂的 Flow 继承和多层覆盖，以免版本依赖变得不可解释。

### 7.4 替换 CF

用户在 Flow 中替换 CF 时，产品必须先做影响分析：

- 新 CF 输入能否由现有 bindings 满足。
- 新 CF 输出是否满足所有下游。
- required capabilities 和 executor 是否可用。
- needs/effects 是否扩大。
- 错误策略和审批是否变化。

替换只修改 Draft。通过编译、测试和发布后才影响新 Flow Version。

---

## 8. 资源模型：服务 Flow，而非建立 Project 中心

### 8.1 Resource Requirement

CF/Flow 声明抽象需求，而不是写死具体资源：

```typescript
interface ResourceRequirement {
  id: string
  type: string
  access: 'read' | 'write' | 'admin'
  scope?: string[]
  required: boolean
  description: string
}
```

例如 CF 声明 `repository/read-write`，Flow 发布版本保留该需求，实际运行再绑定 `repo:customer-service`。

### 8.2 Resource Profile

Resource Profile 是便捷运行配置，不是 Project：

```typescript
interface ResourceProfile {
  id: string
  name: string
  flowId?: string
  environment: 'development' | 'test' | 'production' | string
  bindings: ResourceBinding[]
  visibility: 'private' | 'team' | 'organization'
}
```

它可以保存“这个 Flow 在生产环境通常绑定哪些资源”，但不拥有 Flow，也不成为页面层级父节点。

### 8.3 代码类 Flow

代码仓库是最容易重新滑向 Project 中心的场景，因此明确：

- Repository 是 Resource。
- 工作目录是某次 Run 的授权执行范围。
- Repository 索引/代码库摘要是本次 Run 的 ResourceContext，可由 Flow 中显式 CF 生成。
- 同一个代码审查 Flow 可以运行在多个 Repository 上。
- Repository 页面最多展示“可用于哪些 Flow/最近有哪些 Run”，不负责收纳和维护 Flow。

---

## 9. 权限与治理对象

### 9.1 权限层次

| 权限 | 作用 |
|------|------|
| CF view/edit/publish | 查看、修改、发布能力版本 |
| Flow view/edit/test/publish/run | 分离维护、发布和运行权限 |
| Resource use/admin | 使用或管理外部资源与凭据 |
| Run approve | 批准某次高风险副作用 |
| Audit view | 查看脱敏或完整审计 |

拥有 Flow run 权限不代表可以编辑 Flow；拥有 Flow edit 权限也不代表可以使用所有 Resource。

### 9.2 发布确认

Flow publisher 对高层 Loop 负责，确认的是：

- CF 选择和精确版本。
- 流程结构和终止路径。
- 数据 bindings。
- executor/capability 要求。
- resources/effects 和审批规则。
- 错误策略。

普通运行者不需要重复确认这些设计，但本次 Run 的高风险 effect 仍可能需要独立审批。

### 9.3 审计入口与因果模型

审计可以全局检索，但主要上下文仍是 Flow：

```text
Flow → FlowVersion/planHash → Run/Attempt
  → CF Call/CFVersion/programHash
    → CF Step
      → Agent / LLM / Tool
```

生命周期包含关系使用 parent/child；非树形因果使用显式 links：

- `depends_on`：PlanEdge 或 required Binding；
- `consumed`：下游消费某个 CF return；
- `delegated_from`：AgentStep 内部子代理委派；
- `continued_from`：checkpoint 恢复后的 attempt；
- `authorized_by`：审批或政策授权。

权威 Run Ledger 保存状态提交、return、edge、approval、effect、resource access 和 checkpoint commit；Trace 是从运行事件导出的可观测投影。系统只展示安全属性白名单，原始输入输出按数据分级脱敏、加密或只保留 hash。观测数据丢失不得改变业务运行结果；删除 trace 不得删除 Ledger、checkpoint、Receipt 或运行事实。

这样审计回答的是“一套被维护的 Flow 实际执行了什么”，而不是相信 agent 的自然语言声明。

### 9.4 Executor Registry 与后端能力

Executor 不作为一级产品对象，但 Governance 提供 Registry 管理 Native LLM、ACP、Process、dsh 和 Custom SDK adapter。每个 executor 除业务 capabilities 外，还必须声明运行时特征：

```typescript
interface ExecutorRuntimeTraits {
  backendKind: 'native-llm' | 'acp' | 'process' | 'dsh' | 'custom-sdk'
  sessionMode: 'stateless' | 'per-cf-call' | 'persistent'
  structuredOutput: boolean
  streaming: boolean
  toolEvents: boolean
  permissionPrompts: boolean
  tokenAccounting: 'exact' | 'approximate' | 'unavailable'
  cancellation: 'cooperative' | 'process-kill' | 'unsupported'
  filesystemIsolation: 'sandboxed' | 'cwd-scoped' | 'host-permissions'
  networkIsolation: 'enforced' | 'adapter-declared' | 'unenforced'
}
```

配置页面必须区分“平台可以强制”“协议/adapter 声称支持”“只能依赖 OS/容器”“无法约束”。例如 process backend 没有协议级 permission prompt，ACP permission 也不等于文件系统或网络沙箱；UI 不得笼统显示“安全沙箱”。

Executor Profile 是不可变配置版本，包含 backend、capability、安全和默认模型策略；编辑配置会生成新 Profile 版本。Executor 详情展示健康状态、Profile 版本、adapter build、能力、session 行为、取消方式、usage 精度和权限边界。Flow 发布和运行前若 executor 无法满足 required capabilities 或关键安全特征，必须 fail loud；usage unavailable 时成本不能显示为零，只能显示“未上报/估算不可用”。

### 9.5 OMA 借鉴边界

本产品吸收 OMA 已验证的交互与证据模式，但不复制其动态 Team 产品模型：

| OMA 模式 | 本产品中的安全映射 |
|---|---|
| `planOnly` / Plan Preview | Flow Proposal + 目标解释 + DAG 预览 + 语义 Diff；接受后只修改 FlowDraft |
| DAG + Waterfall Viewer | Flow/CF/Step/Agent 分层 Run Viewer |
| Execution Receipt | Published FlowPlan 与实际 CF/effect/approval 事实对照 |
| runId / attempt / trace links | FlowRun/Attempt/continuedFrom 恢复证据链 |
| ACP / process AgentBackend | AgentExecutor RuntimeTraits 与显式安全边界 |
| progress events + offline viewer | 实时与运行后共用 ViewModel |

明确不采用：直接编辑/运行 PlanArtifact、运行时 Coordinator 建图、Shared Memory 替代 Binding、自动改 executor、隐式 Coordinator synthesis。需要综合结果时必须在 Flow 中使用显式 CF。

---

## 10. 产品不变量

| ID | 产品不变量 |
|----|-----------|
| P-INV-1 | Flow 是默认首页和第一等维护对象，不能要求用户先创建 Project。 |
| P-INV-2 | CF 是独立、可版本化、可复用的能力原子，不属于某个 Flow 或 Project。 |
| P-INV-3 | 用户只编辑 CFDraft/FlowDraft；CFProgram/FlowPlan 是只读编译产物。 |
| P-INV-4 | FlowVersion 必须 pin 精确 CFVersion、programHash 和 planHash。 |
| P-INV-5 | CF 新版不能自动改变已发布 Flow。 |
| P-INV-6 | Flow 结构变化必须进入 Draft、编译、测试/确认和发布链路。 |
| P-INV-7 | 运行者不能在 Run 启动时临时修改节点、分支或 executor。 |
| P-INV-8 | branch、join、terminal、approval 是 Flow 结构，不进入 CF 能力库。 |
| P-INV-9 | Repository、Mailbox、Database 等都是可绑定 Resource，不拥有 Flow。 |
| P-INV-10 | LLM 可以建议 Flow 变化，但只有用户接受后的结构化 diff 才能修改 Draft。 |
| P-INV-11 | 任何隐藏的业务智能步骤都必须提升为显式 CF。 |
| P-INV-12 | 产品错误必须优先定位到用户认识的 Flow/CF 对象，而不是只暴露 DSL index。 |
| P-INV-13 | 目标生成只产生无执行权的 Flow Proposal；未经用户接受不得修改 Flow Draft，未经发布不得执行。 |
| P-INV-14 | Flow Composer 只能引用用户可见、已发布的真实 CF Version；缺失能力必须显式 unresolved，不得伪造隐藏 CF。 |
| P-INV-15 | 控制依赖与数据 Binding 是独立源对象；数据依赖不能绕过控制图。 |
| P-INV-16 | 并行 fan-out、join 模式、部分失败策略必须在 Flow Draft 中显式可见。 |
| P-INV-17 | CF 的自然语言源与 CFProgram 是独立层次；CFProgram 随 CF Version 冻结并以 hash 校验。 |
| P-INV-18 | CFProgram 只能表达函数局部逻辑，不能引用或操纵 Flow DAG；FlowPlan 只调用已发布 CFVersion。 |
| P-INV-19 | Composer 可提出 CFDraft；FlowDraft 可保存显式 unresolved 节点，但未经 CF 编译、测试、发布和 resolve，不能生成可发布 FlowPlan。 |
| P-INV-20 | “实际执行/治理结论”只来自 Run Ledger 与 Execution Receipt；Trace 仅补充诊断证据，agent 文本不能证明执行事实。 |
| P-INV-21 | 恢复执行保留 runId、增加 attempt/traceId，并用 continuedFrom 建立证据链。 |
| P-INV-22 | 运行失败、ledgerIntegrity、telemetry 完整性和 UI 布局降级必须分别显示，不能静默补造事实。 |
| P-INV-23 | DAG 与 Waterfall 使用同一 ViewModel 和选择状态，并支持 Flow→CF Call→CF Step→Agent Span 钻取。 |
| P-INV-24 | Executor 必须声明并版本化 RuntimeTraits/Profile；FlowPlan pin 精确 Profile，实际 adapter/model 进入 Receipt。权限、隔离、usage 或 cancellation 不支持时必须明确展示。 |
| P-INV-25 | 导出的 Run Report 必须脱敏、自包含且禁止网络请求；导出不等于原始 I/O 查看授权。 |
| P-INV-26 | Flow Binding 只能传 canonical CF return、Flow input 或 ResourceContext；Agent raw、CF local、tool transcript 和 secret 不可选。 |
| P-INV-27 | Run Ledger 是 Execution Receipt 和治理事实的权威来源；Trace 缺失只降低诊断证据完整性。 |
| P-INV-28 | Flow 节点实例覆盖不能改变 CFVersion 的 contracts、needs、effects、CFProgram 或 programHash。 |
| P-INV-29 | 业务 Approval 控件与调用前 grants 审批必须在 UI 和运行状态中区分。 |
| P-INV-30 | 外部副作用不宣称 exactly-once；结果未知时必须进入 needs-reconciliation，禁止自动重试和下游推进。 |
| P-INV-31 | programHash/planHash 使用固定 JSON canonicalization；UI/审计可验证，不受字段顺序影响。 |

---

## 11. MVP 产品范围

### M0：对象模型成立

- CFDraft → Candidate CFProgram → CFVersion 编译发布闭环。
- FlowDraft → Candidate FlowPlan → FlowVersion 编译发布闭环。
- Flow 引用精确 CFVersion + programHash。
- Candidate CFProgram/FlowPlan 分别只读查看。
- 无 Project 前置依赖。

### M1：Flow 维护闭环

- CF Library。
- Flow 列表和 Flow Editor。
- **目标 + CF Catalog → Flow Proposal；缺口 → ProposedCFDraft → CF 发布 → 用户接受为 FlowDraft。**
- 顺序连接、并行 fan-out、有限 branch、all/any join、terminal。
- 控制边与 binding 分离编辑、DAG 静态校验。
- Test Snapshot。
- 发布不可变 Flow Version。

### M2：运行、证据与资源闭环

- 运行已发布 Flow，支持 runId/attempt/trace 身份。
- Resource Requirement / Binding / Profile。
- 节点级状态、取消、错误策略和 waiting-approval。
- DAG + Waterfall 双视图、Evidence Inspector 和跨层联动。
- Flow Execution Receipt 与 Published vs Actually Executed。
- Executor RuntimeTraits、健康状态和安全边界展示。
- Flow 内 Runs 页面和全局 Runs 页面。

### M3：复用与治理闭环

- 团队共享、可见性和发布权限。
- CF 升级影响分析。
- Flow 语义 diff。
- effects 审批和因果审计。
- checkpoint/attempt 恢复证据。
- 脱敏静态 Run Report 导出。
- Flow 模板和复制。

### MVP 明确不做

- Project 管理。
- Flow 继承、多层 override 和复杂依赖解析。
- 通用 API connector 市场。
- agent 动态创建或修改 Flow。
- 普通用户直接编辑 DSL 或导出的 Plan JSON。
- 以共享内存替代显式 Binding。
- 隐式 Coordinator 最终综合；需要汇总时必须使用显式 CF。
- 自动升级已发布 Flow 中的 CF。

---

## 12. 成功判断

产品设计是否成立，不以“画布能拖节点”或“Dashboard 看起来完整”作为标准，而看用户能否完成下面的稳定闭环：

```text
编写一个 CF
  → 在多个 Flow 中复用
  → 组装并看懂高层章法
  → 发现不兼容 binding
  → 测试并发布不可变 Flow Version
  → 在不同 Resource 上重复运行
  → 升级 CF 时明确知道哪些 Flow 会受影响
  → 从 Flow 维度观察质量、成本和失败
```

当这个闭环成立时，产品沉淀的是组织的 **Flow 资产和 CF 能力资产**，而不是项目目录、agent 会话或一次性的 prompt。
