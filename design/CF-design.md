# CF (Capability Function) 引擎 —— 架构设计文档 v1.7

> 底座: 多 agent 异构（Claude Code / Codex / dsh / 裸 LLM ...）· TypeScript
> 状态: 两级语言 + 人控 DAG + 一致性语义加固稿 v1.7
> 定位: 两级自然语言编程与多 agent 执行平台 —— CF 是函数语言，Flow 是组合语言
> 产品设计: [`product-design.md`](./product-design.md)

---

## 0. 产品定位（一句话）

**面向普通用户/企业内部：用户用自然语言编写 CF 能力函数并编译为 CFProgram，再将已发布 CFVersion 组合为人控 Flow DAG；也可先给定目标生成可编辑 Flow/CF 草案。经两级编译、测试和发布后，Flow Engine 调度 CF Runtime，由异构 agent 完成函数内智能步骤。**

核心卖点：**高层流程人为掌控；一次验证、全员复用；多 agent 各干所长；流程骨架确定；执行全程可审计。**

产品对象主链：

```text
用户编写自然语言 CFDraft
  → cf-compiler → Candidate CFProgram → 测试/确认 → CFVersion
  → 描述目标生成 Flow Proposal/ProposedCFDraft，或直接组装已发布 CFVersion
  → 用户维护 FlowDraft DAG
  → flow-compiler → Candidate FlowPlan → 测试/确认 → FlowVersion
  → Flow Engine 创建 Run → CF Runtime 执行函数 → AgentExecutor 执行 AgentStep
```

**CFDraft 与 FlowDraft 是两级产品源对象；CFProgram 与 FlowPlan 是各自只读编译产物；CFVersion/FlowVersion 分别冻结 programHash/planHash；Flow Run 是运行记录。Resource 按 Flow 绑定，产品不建立 Project 中心模型。**

> 与 n8n 的关系：**产品重心不同。** n8n 以 API、事件和确定性逻辑集成为核心；CF 引擎以"人为设计高层任务章法、agent 自主完成局部开放任务"为核心。平台可以包含少量分支、脚本、服务调用等支撑节点，但不建设通用连接器自动化平台，也不让这些能力取代 CF 成为产品中心。

---

## 1. 架构宪章（最高优先级，一切决策的"魂"）

> **把原本封闭在 agent 内部、由 agent 临场决定的高层 Agent Loop，外化为人维护的 Flow。Flow 发布时被编译成不可变 FlowPlan，由 flow-engine 机械执行；agent 只拥有单个 CF 节点内部的问题求解自主权，不拥有流程级的下一步决定权。**

### 1.1 双层 Agent Loop

```text
高层 Agent Loop（任务级）
  人在 Flow Draft 中定义目标、CF 节点、分支、绑定与门禁
      → flow-compiler 生成候选 FlowPlan
      → 人确认并发布 Flow Version
      → flow-engine 按该版本的 FlowPlan 决定下一节点

低层函数/Agent Loop（CF 级）
  Flow Engine 调用 CF Runtime
      → CF Runtime 按 CFProgram 执行 guard/call/agent/return
      → AgentExecutor 只在 AgentStep 内自主观察/思考/调用授权工具
      → CF Runtime 返回函数结果
      → Flow Engine 校验并决定是否解锁 DAG 下游
```

这不是消灭 Agent Loop，而是对 Agent Loop 进行**分层与权力重构**：

| 层级 | 权威 | 可以决定什么 | 不可以决定什么 |
|------|------|--------------|----------------|
| 产品源设计 | 有权限的人维护的 Flow Draft | CF 选择、步骤、顺序、分支、绑定和策略 | 不直接作为正式运行程序 |
| 高层任务 Loop | 已发布 Flow Version 及其 FlowPlan | 固化步骤、分支空间、门禁、终止条件 | 运行时不得被 agent 擅自改写 |
| DAG 调度 | flow-engine | ready-set、control edge、Flow binding、外层门禁和失败传播 | 不理解 CF 内部语义，不临场发明步骤 |
| 函数内 Loop | CF Runtime + AgentExecutor | 按 CFProgram 执行函数局部逻辑；agent 在 AgentStep 内自主完成语义任务 | 不选择下一个 CF，不扩张权限，不改写 Flow/CFProgram |
| 目标规划辅助 | Flow Composer 中的 LLM | 根据目标和有界 CF Catalog 生成初始化 Flow Proposal | 不执行提案、不伪造 CF、不绕过用户成为高层 Loop 作者 |
| 编辑辅助 | Flow Editor 中的 LLM | 把人的自然语言翻译为 Flow Draft Patch 建议 | 不直接生成/修改 DSL；未经用户接受不改变 Draft |

### 1.2 不可破坏的架构原则

- **高层 Loop 必须最终来自人维护的 Flow。** 可以从空白、模板或“目标 + CF Catalog”生成的 Flow Proposal 开始，也可以由 LLM 辅助修改；但新增/替换 CF、步骤、分支、binding、副作用和权限都必须先成为 Flow Draft 的可见变化，并由有权限的设计者/发布者确认。
- **两级事实来源与权威必须分开。** CFVersion 的 CFProgram 是函数运行权威；FlowVersion 的 FlowPlan 是高层 DAG 权威。CFDraft/FlowDraft 可维护，两个 DSL 都只读；agent 输出不能直接改写任一程序。
- **agent 保留 AgentStep 内自主性。** CFProgram 规定函数局部逻辑边界，但不微编排 agent 的思考和每一次工具调用；否则 CF 会退化成传统脚本语言。
- **agent 是可插拔的异构执行器。** Claude Code（写代码）、Codex（写方案）、dsh（查资料/数据）、裸 LLM（通用生成）…… 每个 CF 在 Plan 中绑定具体 executor。
- 产品牺牲 agent 的**流程级泛化自主性**，换取"流程骨架确定 + 边界可验证 + 过程可审计"；不承诺生成内容本身确定。
- **轻量契约、硬性门禁。** 契约只验证存在性、基本形状和少量关键断言，不企图证明语义完全正确；但契约一旦声明，其门禁必须被执行，未通过不得静默流入下游。
- **动态性必须被圈定。** agent 可以为预先声明的 branch 提供结构化判断，也可以在节点内部动态使用工具；它不能生成任意下一节点或在运行时改写 Flow。
- **副作用必须分层授权。** CFDraft 声明 effects，CFProgram 只能使用其子集；Flow Engine 做调用级策略/审批，CF Runtime 对每个局部 step 再收窄授权，executor 沙箱最终实施。
- **Flow 是产品中心，CF 是组合原子。** 首页、维护、版本、发布、运行、审计和复用围绕 Flow 组织；CF Library 为 Flow 提供可复用能力节点。
- **Resource 服务于 Flow，不拥有 Flow。** 代码仓库、目录、邮箱、数据库和知识库都在运行时按 requirement 绑定，不形成 Project → Flow 的父子关系。
- 这是平台位：团队/第三方可在其上沉淀 Flow 资产与 CF 能力资产（能力 + 契约 + 编排 = 生态）。

### 1.3 非目标

- 不做一个让 agent 自主拆解目标、动态创建子任务并决定何时结束的通用 Autonomous Agent。
- 不把 agent 节点内的每次思考、文件读取和工具调用都编译成 Flow 节点。
- 不建设以海量 API connector、事件触发器和数据搬运为中心的通用自动化平台。
- 不承诺相同输入得到相同自然语言内容；承诺的是同一已确认 Plan 的流程边界、授权规则和推进逻辑一致。
- 不把“通过结构契约”宣传成“业务语义一定正确”；语义质量仍需评测、冒烟测试和人审。
- 不让用户直接编辑 CFProgram 或 FlowPlan；它们分别是 CFVersion 和 FlowVersion 的派生运行表示，不是第二份产品源代码。
- 不把“目标生成 Flow”实现成运行时动态规划；它只产生设计期 Flow Proposal，不能执行或直接发布。
- 不允许 Composer 在 CF Library 不足时偷偷生成隐藏万能节点；可生成显式 ProposedCFDraft，但必须走 CF 编译、测试和发布链。
- 不要求用户先创建 Project 才能编写 CF、维护 Flow 或执行 Flow。

---

## 2. 落地决策（多 agent，弱依赖 dsh）

| 决策 | 内容 |
|------|------|
| 底座 | **不强依赖 dsh**。dsh 只是执行器之一（查资料/数据）；Claude Code / Codex / 裸 LLM 等皆可接入 |
| 核心抽象 | **CF Runtime + AgentExecutor 接口**：Flow 只调用 CFVersion；CF Runtime 执行 CFProgram，并通过 AgentExecutor 接入异构 agent |
| 实现方式 | cf-compiler（LLM语义编译+确定校验）+ flow-compiler（确定性 lowering）+ Flow Engine + CF Runtime + executor adapters |
| 运行时耦合 | flow-engine 只面向 CF Runtime；CF Runtime 面向 AgentExecutor/script/service registry，不写死任一 agent |
| 严格程度 | 轻量契约、硬性门禁：少量关键规则必须执行；过程约束为可选增强 |
| 控制边界 | 人设计高层 Loop；flow-engine 推进；agent 只在 CF 节点内自主 |
| 产品主对象 | **Flow**：维护、版本、发布、运行和审计的第一等对象 |
| 组合原子 | **CF Version**：可独立编写、发布、测试并被多个 Flow 引用 |
| DSL 定位 | CFProgram/FlowPlan 分别是 CFVersion/FlowVersion 的只读编译产物，不是用户维护对象 |
| 资源定位 | Repository/Mailbox/Database 等作为 Resource 绑定到 Flow Run，不建立 Project 中心 |

---

## 3. 核心概念

### 3.0 什么是 CF？

> **CF = Capability Function（能力函数）**，本设计的核心抽象。
> **CF = 用自然语言定义、由契约和授权边界包裹的可编译智能能力函数。** 用户写清“做什么、输入、输出、过程”；系统将其编译为 CFProgram。FlowPlan 只调度已发布 CFVersion，CF Runtime 执行函数，CF 之间的逻辑骨架由 Flow 明确表达。

**CF 的四个关键含义：**
1. **Flow 的能力原子** —— "读邮件""生成方案""写代码"各是一个 CF；用户可以把已发布 CF 自由组装进多个 Flow。
2. **高于 agent 的能力边界** —— CF 约束单次 agent 执行的目标、I/O、权限与交付；Flow 承载 CF 之间的高层编排权。
3. **不是 skill** —— skill 是纯知识(markdown、靠 agent 自觉)；CF 是带 I/O 契约、有逻辑骨架、被调度执行的可编排单元。
4. **是函数边界，不是 agent 微步骤** —— CFProgram 规定受限局部逻辑；AgentStep 内如何完成开放任务仍由 agent 自主解决。

**与 skill 对比：**

| | Skill | CF |
|---|-------|-----|
| 本质 | 声明式知识/方法论 | 智能能力边界（自然语言任务 + 契约 + 授权） |
| 流程边界 | ❌ 主要靠 agent 自觉 | ✅ 引擎强制执行节点边界与门禁 |
| 可编排 | ❌ 不可拆 | ✅ 可组合成 Flow |
| 谁写 | 开发者/markdown | 普通用户自然语言 |

### 3.1 Capability Function (CF) 结构

```typescript
interface CFDraft {
  cfId: string
  revision: number
  basedOnVersion?: string
  name: string
  does: string                    // @what 做什么
  input: string                   // @in 自然语言输入
  output: string                  // @out 自然语言输出
  process?: string                // 函数局部方法/约束，不承载跨-CF跳转
  inputContract: InputContract    // LLM 建议、用户接受的结构化契约
  outputContract: OutputContract
  defaultExecutor?: string
  requiredCapabilities: string[]
  uses: Array<{ kind: 'skill' | 'script' | 'service'; ref: string; note?: string }>
  needs: ResourceRequirement[]
  effects: EffectRequirement[]
  defaultExecutionMode: 'auto' | 'needs-review'
  defaultTimeoutMs?: number
  defaultOnError: ErrorPolicy
}
```

`input` / `output` 是用户自然语言编辑面；`inputContract/outputContract` 是 LLM 建议、用户接受的结构化契约。发布时从 CFDraft 确定性生成唯一 `PublishedCFContract`，不在 CFVersion 顶层重复维护同义字段。`defaultExecutor` 可以省略，但进入 FlowPlan 前必须解析为具体 executor ID；运行时不存在由 LLM 临场决定的 auto executor。

`process` 可以描述“先核对约束、调用固定脚本、必要时让 agent 分析、最后返回”等函数内局部逻辑，并由 cf-compiler 编译为 CFProgram。如果其中出现跨 executor 协作、对下游可见的条件分支、独立审批、未声明副作用或独立可复用产物，cf-compiler 必须拒绝候选 Program并建议拆成多个 CF/Flow 结构；它不能自行修改 Flow，flow-compiler 也不读取 `process`。

CF 具有独立身份和不可变版本：

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

interface CFVersionArtifact {
  cfId: string
  version: string
  authoredSnapshot: Readonly<CFDraft>
  publishedContract: Readonly<PublishedCFContract>
  compiledProgram: Readonly<CFProgram>
  programHash: string
}
```

`programHash = sha256(JCS({ publishedContract, compiledProgram }))`，其中 JCS 表示固定 UTF-8 JSON canonicalization；禁止依赖对象插入顺序、时间戳或环境值。Flow 节点实例引用具体 CFVersion；修改 CF 的目标、契约、Program 或权限必须创建新版本。已发布 FlowVersion pin 精确 CFVersion + programHash，不能跟随 latest。

### 3.2 CFProgram（单个 CF 的函数局部 DSL）

> CFProgram 是 CFDraft 经 LLM 语义编译、纯代码校验和用户确认后形成的函数内部程序。它随 CFVersion 冻结，不是 Flow DAG。

```typescript
interface CFProgram {
  version: '0.1'
  cfId: string
  sourceRevision: number
  entry: number
  steps: CFStep[]
  sourceMap: Record<number, { sourceField: 'does' | 'input' | 'output' | 'process'; excerpt?: string }>
  limits: {
    maxStepExecutions: number
    maxExternalCalls: number
    maxAgentTurns?: number
    maxOutputBytes: number
  }
}

type CFStep = AgentStep | CallStep | GuardStep | ReturnStep

type AgentStep = {
  index: number
  kind: 'agent'
  task: string
  input: unknown
  skills?: Array<{ id: string; version: string }>
  requiredCapabilities?: string[]
  effects?: Effect[]
  outputContract?: OutputContract
  timeoutMs?: number
  next: number
  onError?: LocalErrorPolicy
}

type CallStep = {
  index: number
  kind: 'call'
  target: {
    type: 'script' | 'service'
    ref: { id: string; version: string; contentHash?: string }
  }
  input: unknown
  requiredCapabilities?: string[]
  effects?: Effect[]
  outputContract?: OutputContract
  timeoutMs?: number
  next: number
  onError?: LocalErrorPolicy
}

type GuardStep = {
  index: number
  kind: 'guard'
  cond: string
  then: number
  else: number
}

type ReturnStep = {
  index: number
  kind: 'return'
  source: unknown
}

type LocalErrorPolicy =
  | { action: 'fail-cf' }
  | { action: 'retry'; maxAttempts: number; backoffMs?: number }
  | { action: 'continue'; fallback: unknown }
```

`continue` 只有在 fallback 通过当前 step 的 outputContract 时才允许进入 `next`；局部策略不能 goto 任意 step、调用其他 CF 或改变 Flow。CFProgram 的 step index 是稳定 ID，不要求等于数组下标；解释器必须先构建 `Map<index, step>` 并拒绝重复/缺失 index。

CFProgram 只允许函数作用域引用：`$input.x`、`$local.N.output`、`$resource.x`、`$secret.x`。禁止 `$flow`、其他 CF node ID、Flow branch、下一节点或任意 executor ID。AgentStep 使用 Flow 调用时已绑定的 executor；一个 CF 若需要跨 executor 协作，应拆成多个 CF 并提升到 Flow。

### 3.3 AgentExecutor 接口（CF Runtime 的智能执行抽象）

> AgentExecutor 由 CF Runtime 在 `AgentStep` 中调用。它不认识 CFProgram 其余步骤，更不认识 FlowPlan。每个 agent 通过一个 adapter 实现它。

```typescript
interface AgentExecutor {
  id: string
  capabilities: string[]
  execute(req: ExecutorRequest): Promise<ExecutorResult>
}
```

**接入方式：** 每个 agent 一个 adapter（Claude Code / Codex / dsh agent / 裸 LLM API）。加新 agent = 加一个 adapter，flow DSL 不改。接口的完整请求、结果与取消语义见 §15。

### 3.4 FlowPlan（外层 DAG DSL / 中间表示）

> FlowPlan 是 Flow Version 编译得到的数据结构（JSON），由 flow-engine 遍历执行。它是运行时中间表示，不是用户维护的产品对象。

**3 类节点（按职责分组）：**

```typescript
interface FlowPlan {
  version: '0.4'
  flowId: string
  flowVersion: string
  objective: string
  sourceRevision: number
  entries: number[]                    // 可并行启动的根节点
  nodes: FlowPlanNode[]
  edges: PlanEdge[]                    // 控制依赖：何时激活下游
  bindings: Binding[]                  // 数据依赖：给下游传什么
  sourceMap: Record<number, PlanSourceRef>
  limits: {
    maxConcurrency: number
    maxNodeDispatches: number
    maxHandoffBytes: number
  }
}

type PlanSourceRef =
  | {
      kind: 'cf-node'
      flowNodeId: string
      cfRef: { cfId: string; version: string }
    }
  | {
      kind: 'flow-structure'
      flowElementId: string
      elementType: 'branch' | 'join' | 'terminal' | 'approval' 
    }

type FlowPlanNode = CallCFNode | BranchNode | JoinNode | ApprovalNode | OutputNode

type Effect = { id: string; resource?: string }

type PlanEdge = {
  id: string
  from: number
  to: number
  when:
    | { outcome: 'completed' }
    | { outcome: 'branch-case'; caseId: string }
    | { outcome: 'approved' | 'rejected' }
    | { outcome: 'failed'; code?: string }
}

type Binding = {
  id: string
  from: string                       // $user.x / $N.output.y / $context.x
  to: string                         // $N.input 或 $N.input.x
  required: boolean
  default?: unknown                  // required=false 时必须显式声明
  maxBytes: number                   // 编译时必须有界；不得运行时无限注入
}

type ExecutorRef = { id: string; profileVersion: string }

type CallCFNode = {
  index: number
  kind: 'cf-call'
  cfRef: { cfId: string; version: string }
  programHash: string
  executor?: ExecutorRef            // 含 AgentStep 时 pin 精确 Profile；纯 CF 可省略
  inputDefaults?: unknown           // 仅字面量默认值；跨节点/用户数据一律来自 Binding
  inputContract: InputContract      // 从 CFVersion 固化
  outputContract: OutputContract
  requiredCapabilities?: string[]
  needs?: string[]
  effects?: Effect[]
  executionMode?: 'auto' | 'needs-review'
  timeoutMs?: number
  onError?: ErrorPolicy
  priority?: 'low' | 'normal' | 'high' | 'critical'
}

type BranchNode = {
  index: number
  kind: 'control'
  op: 'branch'
  inputDefaults?: unknown
  cond: string                     // 只允许读取 $input；跨节点值由 Binding 注入
  cases: string[]                  // 输出 caseId；目标由 PlanEdge 声明
}

type JoinNode = {
  index: number
  kind: 'control'
  op: 'join'
  mode: 'all' | 'any' | 'quorum'
  quorum?: number
  onUpstreamFailure: 'fail' | 'continue-eligible'
  resultMode: 'status-only' | 'canonical-results'
  maxResultBytes?: number
  remaining?: 'drain' | 'cancel'  // any/quorum 达成后如何处理仍在运行分支
}

type ApprovalNode = {
  index: number
  kind: 'control'
  op: 'approval'
  policyRef: string
  inputDefaults?: unknown          // 审批材料跨节点部分由 Binding 注入
}

type OutputNode = {
  index: number
  kind: 'output'
  outputId: string                 // 对应 FlowOutputDefinition
  inputDefaults?: unknown          // 最终值由 Binding 或字面量默认值形成
  contract: OutputContract
}

type ErrorPolicy =
  | { action: 'stop' }
  | { action: 'retry'; maxAttempts: number; backoffMs?: number }
  | { action: 'skip'; fallback: unknown }
  | { action: 'route'; edgeId: string }
```

**引用语法：** 跨节点/用户/上下文引用只允许出现在 `Binding.from`：`$N.output`、`$user.xxx`、`$context.xxx`；目标统一为 `$N.input.xxx`。节点表达式只读取自己的 `$input`。`$secret` 不作为 Flow 数据流传递，只由 CF Runtime 在最短调用边界按授权解析。

Flow Draft 中的稳定 node ID、controls、control edges 和 bindings 是用户源设计；编译器把它们降级成 Plan index、`PlanEdge[]`、`input` 中的 `$引用` 和只读 `bindings` 索引。Plan 中重复表达的数据依赖必须保持一致，编译器发现 edge/binding 不可达或引用矛盾时拒绝发布。错误和语义 diff 必须能通过 source map 映射回 Flow node/control ID，不能只向用户暴露机械 index。

**DAG 与 CF 接口语义：**

- CFVersion/CallCFNode 定义“调用哪个已编译能力函数”；`PlanEdge` 定义“何时激活”；`Binding` 定义“传什么数据”。三者不能互相替代。
- CF 不声明 `dependsOn`，也不感知所在 Flow；依赖由 Flow Draft 的 control edges 编译为 Plan edges。Flow Draft 的 `$entry` 边只用于推导 `entries[]`，不重复保留为 PlanEdge。
- 数据 binding 只传 CF 的 canonical return、Flow input 或显式 ResourceContext；不得传 AgentExecutor 原始输出、CF `$local`、tool transcript 或 secret。需要原文时，CF 必须把它定义为正式输出字段。
- binding 自动要求生产者先成功完成；binding 若没有控制可达关系，编译失败。控制边可以不传数据。所有 branch/approval/output 的跨节点输入也必须经 Binding，不得隐藏在表达式引用中。
- 一个节点有多个满足条件的出边即 fan-out 并行，不需要 `fork` 节点。
- 多入边普通 cf-call 等待所有 eligible 前置边；branch 未选路径先标记 inactive，因此互斥分支可直接合流。并行分支需要 `any/quorum`、允许部分失败或显式汇合策略时必须使用 `join`。
- branch 仅生成预定义 `caseId`；未命中 case 的边及其不可达子图标记为 `inactive`，不作为失败。
- `any/quorum` join 的 source set 由其静态入 PlanEdge 唯一推导，JoinNode 不重复保存 `sources`；branch inactive 后形成 eligible set。`quorum` 编译时不得超过静态入边数，运行时 eligible 数低于 quorum 时明确失败。Join 默认只输出状态；只有显式 `canonical-results` 才按稳定 source ID 汇集上游 canonical return，并受 maxResultBytes 限制。
- `any/quorum` join 必须声明达成后对未完成分支 `drain/cancel` 的策略，避免 Flow 已返回但副作用仍在后台执行。
- `output` 是正常流程的终止候选。flow-engine 命中 output 后停止接纳新节点，并按 Plan/Run 政策 drain 或 cancel 已在途节点；只有终止策略完成后 Run 才是 completed。
- 每一条可达路径必须到达 `output`；MVP 控制图是 DAG，节点级重试由有界 `onError` 表达。错误转移只能引用当前节点的显式 failed PlanEdge，不能用隐藏 goto 绕过控制图。
- FlowPlan 不直接调用 script/service/skill/agent；这些属于 CFProgram 的局部步骤。FlowPlan 只调用固定 CFVersion，并校验 programHash。若 CFProgram 含任一可达 AgentStep，flow-compiler 必须解析并 pin 精确 Executor Profile；纯 Call/Guard/Return CF 不强制绑定 executor。`effects`、审批、超时、错误策略和 DAG 限额仍是外层调用门禁。

### 3.5 Flow（编排）

> Flow = 产品的第一等维护对象，也是人设计的高层 Agent Loop：CF 节点实例 + 允许的控制分支 + 契约绑定 + 门禁策略。用户决定任务章法，编译器将其降级为 Plan，引擎负责忠实执行。

Flow 可以由用户从空白开始自由组装 CF，也可以从目标提案或共享模板开始。Flow Draft 的 DAG 由稳定 CF node、control element、control edge 和 binding 组成，是唯一可编辑源；**正式运行只允许已发布的不可变 Flow Version，发布前测试只允许短期不可变 Test Snapshot**，绝不直接执行可变 Draft。确认发生在版本发布时，不要求每次运行重复确认：普通用户可以直接复用已经由有权限角色验证并发布的版本；一旦定制或发生语义变化，就必须修改 Draft、生成新候选版本、展示差异并重新确认。运行中的 Flow 不接受 agent 增删节点。

```text
CF Library（独立 CF / CF Version）
        ↓ 选择、引用、实例级配置
Flow Draft（用户唯一编辑源）
        ↓ 编译、校验、测试、发布
Flow Version（不可变产品版本）
        ├── authored Flow snapshot
        ├── resolved CF versions
        └── FlowPlan / plan hash
                  ↓
               Flow Run
```

branch、terminal、approval 等属于 Flow 结构控件，不进入 CF Library；CF 是能力原子，不是所有画布元素的统称。

### 3.6 CF 与 Flow 的边界

判断标准不是“有几个动作”，而是**该决策是否需要进入高层 Loop 的治理范围**：

| 留在 CF 节点内，由 agent 自主 | 提升为 Flow/Plan 节点，由人设计 |
|------------------------------|--------------------------------|
| 为完成当前目标而读哪些已授权文件 | 调用另一个 executor 或独立能力 |
| 如何分析、搜索、写作或编码 | 会改变下游路径的业务分支 |
| 已授权工具的调用顺序 | 需要独立契约、审计、重试或人工审批的步骤 |
| 局部自检和实现迭代 | 新增副作用、权限范围或对外产物 |
| 不影响下游契约的中间态 | 需要被多个下游复用或替换的中间产物 |

这个边界同时防止两种偏航：把所有微动作外化会使系统退化为脚本工作流；把跨节点决策藏进 CFProgram 或 agent prompt 又会把高层编排权还给函数内部。

```text
CFDraft → CFProgram       负责单个能力函数如何执行
FlowDraft → FlowPlan      负责多个能力函数如何组合
FlowPlan → CF Runtime     调用函数
CF Runtime → AgentExecutor/Script/Service  执行函数局部步骤
```

CFProgram 不能调用其他 CF；CF 之间的调用只能出现在 FlowPlan。这样 CF 的函数边界、版本复用和 DAG 治理保持清晰。

---

## 4. 核心执行模型（flow DSL 调度，agent 是执行器）

```
用户在 Flow Draft 中编写/选择 CF 并组装高层任务 Loop
   ↓ flow-compiler（把结构化 Flow 源模型确定性降级为 FlowPlan）
候选 FlowPlan DAG
   ↓ 静态校验 + Test Snapshot + 人确认发布
Flow Version + 已冻结 FlowPlan（本次运行的流程权威）
   ↓ flow-engine（ready-set + 并发调度）
flow-engine 执行:
   ├─ 根据 PlanEdge / Binding / Join 计算 ready nodes
   ├─ cf-call → CF Runtime 验证并执行已发布 CFProgram
   │    ├─ agent step → AgentExecutor 节点内自主执行
   │    └─ call step → 注册 script/service 受控执行
   ├─ control/branch → 产生预定义 case outcome 并激活对应边
   ├─ control/join → all/any/quorum 汇合，处理部分失败和剩余分支
   ├─ control/approval → 持久化门禁，产生 approved/rejected outcome
   └─ output → 校验终止结果，停止 admission 并 drain/cancel in-flight
```

**铁律：**
1. 高层编排权来自人维护并发布的 Flow Version；运行时推进权属于 flow-engine 对该版本 FlowPlan 的解释；agent 从不直接驱动流程。
2. 喂给 agent 的只是当前 AgentStep 的自然语言任务、函数局部入参、授权能力和输出契约，绝非完整 CFProgram 或 FlowPlan。
3. FlowPlan 是给引擎的程序；节点任务是给 agent 的局部问题。agent 看不到不必要的全局控制信息，也不能返回可执行 Plan。
4. agent 返回的分支建议、`nextActions`、工具结果都是数据；只有 Plan 中预设的控制节点才能把数据变成流程跳转。
5. 所谓“确定”仅指已确认的流程结构、调度规则和门禁行为确定；agent 生成内容仍具非确定性。

---

## 5. flow-engine 定位（调度员）

> flow-engine = 人为设计的高层 Agent Loop 的机械解释器。它调度已确认的 FlowPlan DAG，在节点 ready 时调用 CF Runtime，实施外层契约、权限和错误门禁，并推进流程。

- 通过 CF Runtime 调用已发布 CFProgram；CF Runtime 再通过 AgentExecutor 接入异构 agent。
- 持有 DAG 状态（pending/ready/running/completed/inactive）、各 CF return 和 in-flight 集合。
- 权威靠**主动调度**：依据 FlowPlan 决定“哪个 CF 调用何时 ready、是否允许副作用、return 能否进入下游、哪些预设边被激活”。executor 已在 FlowVersion 中冻结，不由调度器临场选择。
- 不做语义规划：不临场理解用户目标、不生成下一步、不替 agent 完成节点内工作。
- 产品保持 **agent-first**：分支、脚本和服务调用只为智能任务流程提供必要支撑，不扩张成通用自动化连接器平台。

---

## 6. 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│ 【产品层 - 以 Flow 为中心】                                   │
│  - Flows 首页（目标生成初稿 / 空白 / 模板 / 导入）            │
│  - Flow Composer（目标 + CF Catalog → 可编辑 Flow Proposal） │
│  - Flow Editor（审阅提案，或从 CF Library 自由组装）          │
│  - CF Library / CF 设计器（独立能力与版本）                  │
│  - Runs / Resources / Governance                             │
├─────────────────────────────────────────────────────────────┤
│ 【源模型与发布层】                                            │
│  flow-composer 目标 + 有界 CF Catalog → Flow Proposal        │
│  cf-registry   CFDraft / CFProgram / CFVersion / Catalog     │
│  flow-registry Proposal / FlowDraft / FlowVersion 管理       │
│  cf-compiler   CFDraft → Candidate CFProgram（LLM+确定校验） │
│  flow-compiler FlowDraft + CFVersion → Candidate FlowPlan    │
│  program/plan-release  Test + 语义 diff + 人确认 + hash 冻结 │
│  resource-registry 资源需求/绑定/授权                        │
├─────────────────────────────────────────────────────────────┤
│ 【调度与函数运行时】                                         │
│  flow-engine  解释 FlowPlan DAG + ready-set + 外层门禁       │
│  cf-runtime   校验 programHash + 执行 CFProgram + 局部门禁   │
│  executor-adapter  只为 AgentStep 包装异构 agent             │
├─────────────────────────────────────────────────────────────┤
│ 【执行层 - 可插拔异构 agent】                               │
│  Claude Code（写代码）│ Codex（写方案）│ dsh（查资料/数据）  │
│  │ 裸 LLM（通用生成）│ 未来更多 agent ...                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 上下文管理（契约传递，非共享 session）

> 异构 agent 之间没有共享 session（Claude Code 的上下文和 Codex 的上下文是隔离的），所以"共享上下文"收敛为**"CF 间结构化契约传递"** —— 每个 CF 的输出（结构化出参）作为下一个 CF 的输入。

| 数据角色 | 处理 |
|---------|------|
| CF 出参（跨节点传递） | 结构化契约，作为下一 CF 入参 |
| CF 内部中间态 | CF Runtime 的 `$local` 函数作用域；AgentExecutor 仅持有当前 AgentStep 内部状态，函数 return 后均不跨 CF 外传 |
| 审计日志 | FlowPlan/CFProgram hash、CF Call/Step、executor、授权和门禁结果分层记录（可追溯） |
| 超长出参 | spill/截断/摘要后再传下游 |

**优点：** 异构 agent 反而逼你把"上下文共享"收敛为"契约传递"——更干净、更可验证、天然支持多 agent。交接内容始终是数据，不携带流程控制权。

---

## 8. 关键架构决策（DD）—— 自洽完整

| DD | 决策 |
|----|------|
| DD-1 | 产品 = 多 agent 异构编排调度平台；**Flow 是第一等维护对象**，承载从 agent 内部外化的人为高层 Loop |
| DD-2 | 不强依赖 dsh：dsh 只是执行器之一；Claude Code/Codex/裸 LLM 皆可接入 |
| DD-3 | CF = Flow 的可复用能力原子：自然语言目标 + I/O 契约 + 授权边界；不是 agent 内部微步骤 |
| DD-4 | 产品编排权固化在已发布 Flow Version；其 FlowPlan 是运行时权威表示；flow-engine 推进，agent 执行节点 |
| DD-5 | executor 只接收当前 AgentStep、函数局部入参、授权和契约，不接收完整 CFProgram 或 FlowPlan |
| DD-6 | 用户可以自由组装 CF 创建 Flow，也可从已验证模板开始；Flow Draft 是唯一编辑源，修改后重新编译发布 |
| DD-7 | 用户维护 CF/Flow，不维护 DSL；对内只执行通过静态校验、经人确认且随 Flow Version 冻结的 FlowPlan |
| DD-8 | CF 按函数边界设计，无/少副作用；`effects` 是权限申请，必须经策略/审批和 executor 沙箱授权 |
| DD-9 | 上下文管理 = CF 间结构化契约传递（非共享 session）；handoff 是数据，不是流程指令 |
| DD-10 | 严格程度 = 轻量契约、硬性门禁；不证明语义正确，但契约、授权或明确成功状态失败时不得静默推进 |
| DD-11 | CF 间连接 = 契约驱动的后向推导；编译期生成显式绑定并静态检查每条路径的可达性与可替换性 |
| DD-12 | 参数对齐 = LLM 提议绑定、纯代码校验、人确认；运行时机械解析。换 CF 必须生成差异、重新确认并冒烟测试 |
| DD-13 | CF 描述 = 函数注释风格（@what/@in/@out）；LLM 可推导参数关系，但推导结果只是待确认候选 |
| DD-14 | 运行时只校验存在性/基本形状/关键断言；校验范围轻，但失败门禁硬。内容正确性另由冒烟测试、评测和人审承担 |
| DD-15 | **运行时抽象 = CF Runtime + AgentExecutor**：FlowPlan 只调用 CFVersion；CF Runtime 执行 CFProgram，AgentStep 通过 adapter 接入具体 agent |
| DD-16 | 产品坚持 agent-first，不建设通用自动化平台；branch/script/service 只作为 CF 流程的受控支撑能力 |
| DD-17 | 多 agent 上下文 = **ResourceContext + ContextHandoff**，非共享 session、非 Project 容器；资源理解是 Flow 中显式可选 CF，补读只能发生在 Run 已绑定并授权的 Resource scope 内 |
| DD-18 | 动态决策只能在 Plan 预设的闭集内发生：agent 输出结构化判断，control 节点机械选支；agent 不得生成任意 next node |
| DD-19 | `output` 是终止节点；MVP 控制图为 DAG，重试必须有界。每条可达路径必须落到唯一一次终止输出 |
| DD-20 | 审计目标是可追溯与尽力复现，不承诺非确定 agent 和外部副作用的位级重放；Plan/hash、版本、输入、授权、结果必须留痕 |
| DD-21 | Flow Version pin 精确 CF Version；CF 新版不能自动改变已发布 Flow，只能经影响分析升级 Draft 后重新发布 |
| DD-22 | Repository/Mailbox/Database 等都是 Resource；Resource 按 requirement 绑定到 Run，不存在 Project 对 Flow 的所有权 |
| DD-23 | Flow Draft 使用稳定 node ID；DSL index 只是编译实现细节，错误、diff 和审计必须映射回产品源对象 |
| DD-24 | 用户可用业务目标和约束触发 Flow Composer；Composer 只能基于有界、可见、已发布 CF Catalog 生成不可执行 Flow Proposal。用户接受后才写入 Draft，后续仍走确定性编译、测试和发布门禁 |
| DD-25 | CF Flow 采用冻结 DAG：CF 定义能力接口，PlanEdge 定义控制依赖，Binding 定义数据依赖；CF 本身不携带 Flow dependsOn |
| DD-26 | DAG 调度吸收 OMA 的 event-driven ready-set / in-flight / failure propagation / structured handoff，但不吸收运行时建图、自适应追加任务或自动改 executor |
| DD-27 | fan-out 由多出边表达，无 fork 节点；多入边默认 all，any/quorum/部分失败必须显式 join；branch 未选路径是 inactive 而非 failed |
| DD-28 | output 命中后停止新 admission，并按策略 drain/cancel 在途工作；没有完成终止策略的 Run 不得标记 completed |
| DD-29 | 系统采用两级语言：CFDraft 编译为函数局部 CFProgram，FlowDraft 编译为外层 DAG FlowPlan；二者拥有不同 schema、compiler、hash 和 runtime |
| DD-30 | FlowPlan 的能力节点只能调用精确 CFVersion + programHash，不直接调用 agent/script/service/skill；这些目标只存在于 CFProgram 内部 |
| DD-31 | CFProgram 严格函数作用域，不能引用其他 CF、Flow node、Flow branch 或下一节点；跨 CF/跨 executor 逻辑必须提升到 Flow |
| DD-32 | Flow Engine 只调度 FlowPlan 并调用 CF Runtime；CF Runtime 执行 CFProgram；AgentExecutor 只执行 AgentStep |
| DD-33 | Composer 缺少能力时可提议 ProposedCFDraft，但它无执行权，必须经过 CF 编译、测试和发布后才能进入 Flow |
| DD-34 | Flow Binding 只传 CF canonical return/Flow input/ResourceContext；Agent raw、CF local、tool transcript、secret 永不跨 CF 边界 |
| DD-35 | Run Ledger 是状态、approval、effect、resource 和 Receipt 的权威来源；Trace 是可丢失诊断投影 |
| DD-36 | Run/Flow Call/CF Step/Adapter 的 deadline、retry、error 分层；取消优先，重试共享预算，effects 默认不自动重试 |
| DD-37 | Flow 错误转移必须使用显式 failed PlanEdge；业务 ApprovalNode 与调用前 grants 审批是不同语义 |

---

## 9. 里程碑

| 里程碑 | 内容 | 备注 |
|--------|------|------|
| M0 | 定义 CFDraft/CFProgram/CFVersion、FlowDraft/FlowPlan/FlowVersion、CF Runtime 和一个 AgentExecutor | 验证两级语言、两级编译与运行时分层 |
| M1 | 完成 CF Library → 目标生成/自由组装 DAG Flow → 并行、branch、join → Test Snapshot → 发布 → event-driven 运行 | **验证低门槛初始化、人控 DAG 与执行语义同时成立** |
| M2 | Resource Binding + 第二个 executor；同一 Flow 在不同资源上运行 | 验证无 Project 依赖和异构可替换性 |
| M3 | CF 升级影响分析 + I/O/effects 门禁 + 语义 diff + 审计 | 验证复用与企业治理边界 |
| M4 | Flow 模板、团队共享、使用关系和 Flow 质量/成本分析 | 形成 Flow/CF 资产生态 |

---

## 10. 风险与对策

| 风险 | 级别 | 对策 |
|------|------|------|
| 多 agent 成本/权限管理 | 高 | 每 agent 独立 key/配额管理，审计"哪个 agent 干了什么" |
| 异构 agent 能力差异导致输出不稳 | 中 | 轻量契约硬门禁 + 冒烟测试 + 按 CF 选 executor |
| LLM Flow Proposal / Draft Patch 越权改变高层 Loop | 高 | Proposal 无执行权；应用前展示 Flow 源 diff；新增/替换 CF、分支、bindings、effects、权限必须由用户接受 |
| 自然语言编辑建议不可靠 | 中 | Patch schema + 源模型校验 + 用户接受；Plan 仍由纯代码确定性编译 |
| 上下文在异构 agent 间传递 | 中 | 结构化契约传递（DD-9），超长出参 spill/摘要 |
| 外部脚本/副作用安全 | 高 | 固定引用注册表 + effects 申请 + 审批门禁 + 最小权限沙箱 |
| handoff 或提示注入试图操纵流程 | 高 | handoff 只作为数据；不解析其中的节点指令；executor 不接收完整 Plan |
| "严格"与"普通用户门槛"平衡 | 中 | 模板组件为主 + 自然语言前端 |
| 产品重新滑向 Project 中心 | 高 | Flows 为默认首页；外部对象统一建模为 Resource Binding，不允许 Project 拥有 Flow |
| DSL 反向成为用户源模型 | 高 | Flow Draft 使用稳定 ID；DSL 只读；编译错误和 diff 映射回 Flow/CF |
| Composer 伪造不存在能力或过度编排 | 高 | 只提供有界 Catalog；可执行节点必须引用真实 CFVersion；缺口写 unresolved/ProposedCFDraft；草案必须走 CF 编译发布链 |
| DAG 控制边与数据 binding 漂移 | 高 | 分离建模、编译期双向一致性检查；binding 必须有控制可达关系 |
| any/quorum 提前推进后遗留副作用 | 高 | join 强制声明 drain/cancel；output 终止前处理所有 in-flight 工作 |
| 并行 fan-out 造成成本/容量爆炸 | 高 | Plan 限制 maxConcurrency/maxNodeDispatches/maxHandoffBytes；发布时展示关键路径和最大并发宽度 |
| CF 升级破坏既有 Flow | 高 | Flow Version pin 精确 CF Version；显式影响分析、测试和重新发布 |
| Agent raw/local 数据绕过 CF 契约 | 高 | Flow Binding 只暴露 canonical return；原始执行内容仅审计可见 |
| 局部 retry × Flow retry 导致调用和副作用放大 | 高 | 共享 deadline/attempt budget；effects 默认禁止自动重试；稳定 idempotency key |
| Trace 被误当成治理事实 | 高 | Run Ledger/Receipt 为权威；Trace 只补诊断信息并允许 partial |

---

## 11. 工程结构

```
cf-platform/                  # 独立 git 仓库
├── packages/
│   ├── flow-engine/          # 外层：FlowPlan DAG ready-set 调度
│   ├── cf-runtime/           # 内层：CFProgram 函数解释器
│   ├── flow-composer/        # 目标 + CF Catalog → Flow Proposal / Draft Patch
│   ├── cf-compiler/            # 自然语言 CFDraft → Candidate CFProgram
│   ├── flow-compiler/          # Flow + CFVersion → FlowPlan（纯代码确定性降级）
│   ├── cf-contracts/         # I/O 契约定义与校验
│   ├── cf-registry/          # CF Draft / CF Version / 使用关系
│   ├── flow-registry/        # Flow Draft / Flow Version / 发布
│   ├── flow-testing/         # Test Snapshot / 沙箱验证
│   ├── resource-registry/    # Resource Requirement / Binding / Profile
│   ├── governance/           # 权限、审批、策略、审计
│   └── executors/            # AgentExecutor adapter 层
│       ├── claude-code/      #   Claude Code executor
│       ├── codex/            #   Codex executor
│       ├── dsh/              #   dsh executor
│       └── llm/              #   裸 LLM executor
├── apps/
│   └── web/                  # Flows / CF Library / Runs / Resources / Governance
├── e2e/                      # 端到端测试（多 executor 矩阵）
└── package.json
```

---

## 12. 待决问题（后续推进）

1. 多 agent 的成本/配额/权限管理细节（每 executor 的 key、审计、限流）。
2. CF Library 与 Flow 模板的发布、可见性和审批细节。
3. CF 内部是否需要可观测子步骤；子步骤不得获得高层 Flow 跳转语义。
4. ~~"auto" executor 路由策略~~ → ✅ **已解决**（§14.3：用户指定为主，未写才用默认，不做 LLM 自动路由）。
5. ~~每个 executor 的"能力声明"规范~~ → ✅ **部分解决**（§15：稳定 capability ID + fail loud 能力门控；能力命名表细节待定）。
6. Flow 被其他 Flow 作为子流程复用的版本和契约模型（MVP 后）。

---

## 13. 架构图

### 13.1 总览分层图

```
┌──────────────────────────────────────────────────────────────────────┐
│                    【产品对象 · 面向企业用户】                         │
│  Flows（默认首页）│ CF Library │ Runs │ Resources │ Governance      │
│  Flow Editor: 从 CF Library 选取能力节点，自由连接、分支和绑定       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ Flow Draft（唯一可编辑源）
┌───────────────────────────────▼──────────────────────────────────────┐
│                   【设计辅助、编译与发布层】                           │
│                                                                      │
│  Flow Composer  目标 + 有界 CF Catalog → 不可执行 Flow Proposal      │
│       ↓ 用户审阅、替换和接受为 Flow Draft                            │
│  resolve      pin 每个节点引用的精确 CF Version                       │
│       ↓                                                              │
│  cf-compiler    CF 自然语言源 → Candidate CFProgram                       │
│  flow-compiler  Flow 源结构 + CFVersion → Candidate FlowPlan              │
│       ↓                                                              │
│  Test Snapshot → 语义差异 → 人确认 → 发布 Flow Version               │
│       ↓                                                              │
│  ╔════════════ Flow Version 内冻结的 FlowPlan ═════════════════╗    │
│  ║ 冻结 DAG: cf-call + branch/join/approval + output          ║    │
│  ║ + control edges + bindings + CFVersion/programHash          ║    │
│  ╚════════════════════════════╤═══════════════════════════════════╝    │
└───────────────────────────────┼──────────────────────────────────────┘
                                │ 创建 Flow Run + Resource Bindings
┌───────────────────────────────▼──────────────────────────────────────┐
│                    【调度与运行时】                                    │
│       ↓ 遍历 + 路由                                                  │
│  flow-engine  Event-driven DAG：ready-set / in-flight / 依赖解锁       │
│       ↓                                                              │
│  gate         轻量契约 + 权限/审批 + 明确成功状态（硬门禁）            │
│       ↓                                                              │
│  Flow Engine ──cf-call──→ CF Runtime ──AgentStep──→ AgentExecutor │
│                         └─CallStep──→ Script/Service Registry      │
└─────────────────┼──────────────┼──────────────┼──────────────────────┘
                  ↓              ↓              ↓
┌─────────────────▼──────────────▼──────────────▼──────────────────────┐
│        【执行层 · 可插拔异构 agent】                                  │
│   Claude Code     Codex          dsh            裸 LLM / 未来...      │
│   (写代码)        (写方案)       (查资料/数据)   (通用生成)           │
│   adapter 包装    adapter 包装   adapter 包装   adapter 包装          │
└──────────────────────────────────────────────────────────────────────┘
```

### 13.2 核心执行流程（flow DSL 调度多 agent）

```
① 用户可以先给出目标，由 Flow Composer 从 CF Library 生成初始化提案；
   也可以直接选择节点。在用户审阅/修改后，Flow Draft 形成高层 Loop：
   读邮件 → 生成方案 → 写代码 → 生成报告
   每个 CF 声明 executor：
     读邮件   → executor: dsh         （查资料/读数据）
     生成方案 → executor: codex       （写方案）
     写代码   → executor: claude-code （写代码）
     生成报告 → executor: llm         （通用生成）

② 编译器解析精确 CF Version，生成候选 FlowPlan；Test Snapshot 验证后，
   发布界面展示步骤/分支/绑定/executor/effects 差异并冻结 Flow Version/hash。

③ 运行者为该 Flow Version 提供输入和 Resource Bindings，flow-engine 遍历其 FlowPlan：
   ┌──────────────────────────────────────────────────────────┐
   │  node=cf-call → Flow gate → CF Runtime 验证 programHash   │
   │       ↓                                                   │
   │  执行 CFProgram：guard/call/agent/return                  │
   │       ↓ AgentStep 才调用绑定 AgentExecutor                │
   │  CF return 契约 → Flow 节点输出门禁                       │
   │       ↓ 失败按对应层预设策略处理                          │
   │       ↓                                                   │
   │  出参 → 绑定映射表 → 作为下一 CF 入参                     │
   └──────────────────────────────────────────────────────────┘

④ 审计：记录 { flow/version, planHash, cf/version, resource, executor, 授权, I/O, 门禁, 成本 }
```

### 13.3 核心关系图（谁管谁、谁依赖谁）

```
        ┌─────────────── 你造（Flow 中心产品）──────────────────┐
        │  CF Library（可复用能力原子）                          │
        │       │ 目标检索 / 直接选择                              │
        │  Flow Proposal（系统提议、无执行权、可编辑）             │
        │       │ 用户接受/替换/修订                               │
        │  Flow Draft（人维护的高层 Loop 唯一源设计）              │
        │       │ 编译 + 测试 + 发布                              │
        │  Flow Version（产品事实）                              │
        │       │ 包含冻结 FlowPlan（运行表示）                    │
        │       │ 驱动                                           │
        │  flow-engine（推进权威）──→ gate（契约/权限/错误门禁） │
        │       │ 路由                                          │
        │       ▼                                               │
        │  CF Runtime → AgentExecutor 接口（抽象）              │
        └───────┬───────────────────────────────────────────────┘
                │ adapter（每种 agent 一个）
     ┌──────────┴──────────┬───────────┬───────────┐
     ▼          ▼          ▼           ▼
  Claude Code   Codex      dsh        裸 LLM / ...
  (执行器)      (执行器)   (执行器)    (执行器)
```

> **一句话：你造的是以 Flow 为核心的智能流程产品。用户维护 Flow、复用 CF；发布时 Flow 被编译成冻结 DSL；运行时 flow-engine 解释外层 Loop，agent 只在 CF 内层 Loop 中自主工作。**

### 13.4 DAG 与 CF 接口关系图

```text
                     Flow Draft（用户源设计）
┌─────────────────────────────────────────────────────────────┐
│ CF Node Instances          调用哪个已发布 CFVersion          │
│ Control Elements           branch / join / approval / output│
│ Control Edges              何时激活下游                      │
│ Bindings                   给下游传什么                      │
└───────────────┬─────────────────────────────────────────────┘
                │ 确定性编译 + 静态图分析
                ▼
                     FlowPlan v0.4（冻结 DAG）
┌─────────────────────────────────────────────────────────────┐
│ entries[]                                                   │
│  nodes[]      cf-call / branch / join / approval / output    │
│ edges[]      completed / branch-case / approved / rejected  │
│ bindings[]   canonical return / Flow input / context + bounds│
└───────────────┬─────────────────────────────────────────────┘
                │ event-driven ready-set
                ▼
┌─────────────────────────────────────────────────────────────┐
│ flow-engine                                                 │
│ readiness = eligible control predecessors + required inputs │
│ fan-out = 多条出边；fan-in = all 或显式 any/quorum join      │
│ CF Runtime 只接收当前 CFVersion/input/grants，不知道 DAG      │
└─────────────────────────────────────────────────────────────┘
```

> **接口铁律：CFDraft/CFProgram 定义函数，Edge 定义控制，Binding 定义数据。** CFVersion 可在不同 Flow/DAG 位置复用而无需修改；DAG 更换节点所引用的 CFVersion 时必须重新执行契约、programHash、能力和影响分析。

---

## 14. 两级编译体系：cf-compiler + flow-compiler

### 14.1 总览

```text
CF 语言链：
  CFDraft（自然语言函数源）
    → cf-compiler（LLM 语义编译 + 纯代码校验）
    → Candidate CFProgram
    → CF Test + 人确认
    → CFVersion + programHash

Flow 语言链：
  FlowDraft（结构化 DAG 源）+ 已发布 CFVersion
    → flow-compiler（纯代码确定性降级）
    → Candidate FlowPlan
    → Test Snapshot + 人确认
    → FlowVersion + planHash
```

两级编译不可互相越权：cf-compiler 不能创建 Flow 节点或引用其他 CF；flow-compiler 不能理解并重写 CF 的 `process`，只消费已发布 CFVersion 和 programHash。

### 14.2 cf-compiler：自然语言 CF → CFProgram

cf-compiler 的输入是 CFDraft 的 `does/input/output/process`、结构化 I/O 契约，以及该用户可用的 skill/script/service 清单和 executor capability。LLM 负责把自然语言伪代码翻译成候选 CFProgram：

```text
“从绑定邮箱读取邮件；为空则直接返回空列表；
 否则调用 mail-parser 脚本解析，再让 agent 提取客户诉求并返回结构化结果”

              ↓ LLM 编译

CallStep(mail.fetch)
  → GuardStep($local.0.output.length == 0)
      ├─ ReturnStep([])
      └─ CallStep(script:mail-parser)
           → AgentStep(提取客户诉求, skills:[customer-analysis])
                → ReturnStep($local.3.output)
```

LLM 产物只是 Candidate CFProgram。纯代码必须校验：

1. 结构符合 CFProgram schema；
2. 所有 step index、next/then/else 引用存在；
3. 所有可达路径有界并到达某个 ReturnStep；允许多个 return，但每个返回值都必须满足同一 outputContract；MVP 不允许控制流环；
4. `$input/$local/$resource/$secret` 引用合法，禁止 Flow/其他 CF 引用；
5. script/service/skill ref 解析为精确不可变版本（必要时含 contentHash），目标已注册且当前用户/组织可用；
6. 调用所需 capabilities、needs、effects 不超出 CFDraft 声明；
7. AgentStep 只使用调用时绑定 executor，不硬编码其他 executor；
8. 每个 ReturnStep 的来源在类型/形状上可静态兼容 CF outputContract；真实值在 CF Runtime return gate 再校验；
9. 不存在隐藏的跨 CF 调用、Flow branch、approval 或外层副作用门禁。

校验失败时，错误通过 source map 定位到 CFDraft 的 `does/input/output/process` 片段。LLM 可以基于结构化错误生成 CF Draft Patch 或重新编译候选 Program，但不能直接修复已发布 CFProgram。

### 14.3 CF 发布门禁

CFVersion 发布前必须展示函数级语义摘要：

- 自然语言源与候选步骤的对应关系；
- 会调用哪些 agent/skill/script/service；
- 条件和所有 return 路径；
- 所需资源、secret 和 effects；
- 超时、重试和最大步骤/turn；
- 与上一 CF Version 的语义 diff。

点击测试时先冻结短期 `CFTestSnapshot { sourceRevision, publishedContract, candidateProgram, programHash, executor, sandboxPolicy }`；不直接执行可变 CFDraft。测试通过并经用户确认后，固化 `{ authoredSnapshot, publishedContract, compiledProgram, programHash }`。`programHash` 对 canonical `{ publishedContract, compiledProgram }` 计算，因此契约、授权声明、注册引用或程序任一变化都会改变 hash。Flow 只能引用已发布 CFVersion；hash 不匹配时 Flow 编译或运行必须失败。

### 14.4 flow-compiler 定位

flow-compiler 位于 Flow 源模型和运行时 DAG 之间，是“FlowDraft + 已解析 CFVersion/CFProgram hash → 候选 FlowPlan”的确定性降级编译器，而不是高层 Loop 的作者：

```
人维护 Flow 源定义 → 解析精确 CFVersion + programHash → flow-compiler → 候选 FlowPlan
  → 静态校验 + source map
  → 语义差异展示 → 人确认 → 版本/hash 冻结 → flow-engine 执行
```

**核心职责：忠实地把 Flow Draft 的稳定节点、结构关系和 bindings 降级成机器可检查的候选 FlowPlan，并把错误映射回 Flow 源对象。它可以补全机械结构，不得擅自增加业务步骤、扩大分支空间、引入副作用或提升权限。**

### 14.5 Flow 编辑辅助 + 确定性编译 + 发布门禁

| 阶段 | 谁干 | 输入 | 输出 | 性质 |
|------|------|------|------|------|
| 编辑辅助（可选） | LLM | 用户自然语言 + 当前 Flow Draft + 可用 CF | 结构化 Flow Draft 变更建议 | 不确定；用户接受后才修改 Draft |
| 编译阶段1 | 纯代码（resolve + lower） | Flow Draft + pin 后的 CF Version | 规范化候选 FlowPlan + source map | 确定；把源模型机械降级为 IR |
| 编译阶段2 | 纯代码（validate） | 候选 FlowPlan + 注册表/策略 | 通过静态校验的 Candidate FlowPlan | 确定；检查结构、语义、控制图和权限 |
| 发布门禁 | 人 + 纯代码 | Flow 源 diff + Candidate FlowPlan + Test Snapshot | Flow Version + hash 冻结的 FlowPlan | 人拥有最终高层编排权 |

**为什么必须两阶段：**
- LLM 适合把自然语言意图转成可审阅的 Flow 变更建议，但不适合成为 DSL 的事实来源。
- Flow Draft 已经结构化后，节点降级、引用生成和控制图构造必须由纯代码确定性完成。
- 没有发布门禁，LLM 或自动修复仍可能成为高层 Loop 的隐形作者。
- **在 Flow 链中，LLM 只辅助编辑，纯代码负责 lowering/校验；在 CF 链中，LLM 负责自然语言到 Candidate CFProgram 的语义编译，纯代码负责校验；两条链都由人确认发布**。

### 14.6 可选 Flow 编辑辅助：自然语言 → Flow Draft 变更建议

**输入：**
1. 用户对 Flow 的自然语言修改意图。
2. 当前 Flow Draft（稳定 node ID、CF nodes、controls、control edges、bindings）。
3. 可用 CF/CF Version 的名称、契约、capabilities、needs 和 effects。
4. Flow Draft Patch 的 JSON Schema。

**输出要求（Flow Draft Patch）：**
```json
{
  "operations": [
    { "op": "addCFNode", "tempId": "analyze-mails", "cfRef": { "cfId": "mail-analysis", "version": "1.2.0" } },
    { "op": "connect", "from": "read-mails", "to": "analyze-mails" },
    { "op": "bind", "from": "read-mails.output", "to": "analyze-mails.input.mails" }
  ],
  "unresolvedSuggestions": []
}
```

**实现要点：**
- 变更建议必须在 Flow Editor 中显示 CF、结构、binding、资源和权限 diff。
- 用户接受后才由应用层把 patch 应用到 Flow Draft，并产生新 revision。
- LLM 不直接生成 Plan index、`$N.output`、source map 或 plan hash。
- LLM 不得静默创造 CF、effects、script/service ref 或权限；缺少现有 CF 时只能建议用户创建 CF。
- executor 以 CF 默认值或用户实例级配置为准；确定性规则可补默认值，LLM 不在编译时临场路由。

### 14.7 FlowPlan 确定性编译与四层校验（纯代码）

编译阶段1先解析依赖并机械降级：

1. 拒绝任何 unresolved Flow node；pin 每个已解析 Flow node 引用的精确 CFVersion，并验证 CFProgram/programHash。
2. 为稳定 Flow node ID 和结构元素分配 Plan index。
3. 把 branch/join/approval/terminal controls 降级为 Plan control/output 节点。
4. 把 Flow control edges 降级为 `PlanEdge[]`，为 `$entry` 生成 `entries[]`。
5. 把 Flow bindings 降级为 `$引用` 和有界 Plan bindings；校验每条数据依赖都有控制可达路径。
6. 对多入边节点生成默认 all barrier；只有源 Flow 的显式 join 才能生成 any/quorum/部分失败语义。
7. 计算可达性、拓扑序、关键路径、最大并发宽度和 handoff 上限。
8. 合并 CF 默认策略与合法实例覆盖：executor 必须覆盖 requiredCapabilities；实例不能改 contracts/needs/effects/Program；审批只能按政策加强；timeout 在 CF/组织允许范围内解析；onError 只作用于整个 CF Call。
9. 生成 `sourceMap[index] → flowNodeId/cfRef/flowElementId`。

**技术选型：** zod（层1-2 语法/类型）+ 手写函数（层3-4 语义/完整性）

| 层 | 校验内容 | 实现 | 失败级别 |
|----|---------|------|---------|
| 1 语法 | JSON 合法、顶层结构对（nodes 数组）| zod schema | 严格拦截 |
| 2 类型/字段 | 每节点类型合法、必填字段存在、字段类型对 | zod（每节点类型一个 schema，switch 分派）| 严格拦截 |
| 3 语义 | target/ref 已注册、精确能力匹配、引用只指向可用数据、effects 有政策覆盖 | 手写（注册表 + 引用/权限分析）| 严格拦截 |
| 4 DAG/控制图 | entries 合法、所有节点可达、无环、每条激活路径可终止、edge outcome 合法、join 输入与模式一致、binding 有控制可达关系、error route 引用当前节点 failed edge | 手写（图分析 + 拓扑排序）| 严格拦截 |

**错误结构（修复循环的关键）：**
```typescript
interface ValidationError {
  node?: number           // 哪个节点（0-based）
  flowNodeId?: string     // 优先面向产品源对象定位
  cfRef?: { cfId: string; version: string }
  flowElementId?: string
  field?: string          // 哪个字段
  code: string            // SYNTAX | UNKNOWN_TARGET | CAPABILITY_MISMATCH | BAD_REFERENCE | EFFECT_NOT_ALLOWED | NON_TERMINATING_PATH | ...
  message: string         // 人类可读描述
  suggest?: string        // 建议值（可用 executor / 可用引用等）
}
```

**修复循环：**
```
Flow Draft → 确定性编译 → 四层校验
  ├─ 通过 → Candidate FlowPlan → Test Snapshot → 语义差异 → 发布
  └─ 失败 → 用 source map 把错误定位到 Flow/CF 源对象
            → 代码给出确定性修复建议，或 LLM 生成 Flow Draft Patch 建议
            → 用户接受/手工修改 Draft → 新 revision → 重新完整编译
```

任何修复都回到 Flow Draft，不能原地修 Plan。Candidate FlowPlan 一旦生成即只读；Draft revision 变化就丢弃旧 Candidate FlowPlan。

**校验规则来源：** 两级 DSL 静态定义（CFStep / FlowPlanNode zod schema）+ CF/target/executor/policy 注册表。CF 编译校验局部 Program；Flow 编译校验版本/hash、DAG、bindings 和运行政策。

### 14.8 Flow 发布门禁：把高层 Loop 的最终权力交还给人

候选 FlowPlan 通过静态校验后仍然是 `draft`，不可被 flow-engine 执行。发布界面必须展示**语义差异**，而不只是 JSON 文本差异：

| 差异类别 | 必须展示的内容 |
|---------|----------------|
| 流程结构 | 新增/删除 CF、并行 fan-out、branch、join 模式、approval 与终止路径；关键路径和最大并发宽度变化 |
| 数据绑定 | 哪个上游字段被绑定到哪个下游输入，是否发生自动字段映射 |
| 执行器 | executor 变更、capability 要求变化 |
| 权限与副作用 | CFVersion 升级带来的 needs/effects/capability 变化、节点审批模式变化；CF 内部 script/service ref 只在 CF 发布 diff 中展示 |
| 运行策略 | deadline、重试预算、skip fallback、failed edge route 变化 |

有发布权限的设计者/审批者确认后生成 `{ flowVersion, planHash, confirmedBy, confirmedAt }`。`planHash = sha256(JCS(compiledFlowPlan))`，覆盖 nodes/edges/bindings/limits/sourceMap、精确 CFVersion/programHash 和 Executor Profile；运行输入、具体 Resource Binding、时间戳不进入 planHash。同一不可变版本只需确认一次，之后可被授权用户重复执行，实现“一次验证、全员复用”；任何定制或 Flow Draft 字段变化都会生成新版本并使原确认不再适用于新版本。flow-engine 启动时必须重新计算 hash 并验证发布状态。任何修复都必须回到 Flow Draft，重新编译并经过发布门禁。

**核心原则：** CFDraft 和 FlowDraft 分别管理函数源与流程源；LLM 可编译候选 CFProgram、也可建议 Flow Patch，但纯代码负责 schema/引用/安全/图校验，人分别拥有 CF 函数语义和 Flow 高层 Loop 的最终发布权。

---

### 14.9 完整示例 Walkthrough：客户邮件 + CRM 周报 DAG

#### 用户目标

> 读取本周客户邮件和 CRM 更新，并行提取信息后汇总风险；高风险事项必须人工审核，通过后生成正式周报。

用户可以由 Flow Composer 生成初稿，也可以人工组装。先看其中“读取客户邮件”CF 的一级语言编译：

```text
CFDraft
  @what 从绑定邮箱读取指定时间范围的客户邮件并归纳
  @in  mailbox、dateRange
  @out { mails, summary }
  process:
    1. 调用注册服务 mail.fetch 获取邮件
    2. 如果为空，返回空列表和空摘要
    3. 否则使用 customer-mail-analysis skill 让 agent 归纳
    4. 返回结构化结果

      ↓ cf-compiler + 校验 + CF Test Snapshot + 人确认

CFProgram
  0 CallStep(service:mail.fetch@1) → 1
  1 GuardStep($local.0.output.length == 0) → 2 / 3
  2 ReturnStep({mails: [], summary: ""})
  3 AgentStep(skill:customer-mail-analysis@2) → 4
  4 ReturnStep($local.3.output)

CFVersion read-customer-mails@1.0.0
  programHash = hash(publishedContract + compiledProgram)
```

FlowPlan 只会调用这个 CFVersion，不会看到或调度其内部 0–4 步。以下是用户维护的 Flow 源模型摘要：

```json
{
  "flowId": "customer-weekly-report",
  "revision": 9,
  "objective": "汇总客户邮件与 CRM 数据，识别高风险事项并生成周报",
  "nodes": [
    { "id": "read-mails", "cfRef": { "cfId": "read-customer-mails", "version": "1.0.0" } },
    { "id": "read-crm", "cfRef": { "cfId": "read-crm-updates", "version": "1.1.0" } },
    { "id": "analyze", "cfRef": { "cfId": "analyze-customer-status", "version": "2.0.0" } },
    { "id": "write-report", "cfRef": { "cfId": "write-weekly-report", "version": "2.1.0" } }
  ],
  "controls": [
    { "id": "source-join", "type": "join", "mode": "all", "onUpstreamFailure": "fail", "resultMode": "status-only" },
    { "id": "risk-branch", "type": "branch", "condition": "$input.riskLevel", "cases": [
      { "id": "high", "label": "高风险" }, { "id": "normal", "label": "正常" }
    ] },
    { "id": "risk-approval", "type": "approval", "policyRef": "customer-risk-review" },
    { "id": "report-output", "type": "terminal", "outputId": "report" },
    { "id": "rejected-output", "type": "terminal", "outputId": "rejected", "inputDefaults": { "status": "rejected" } }
  ],
  "edges": [
    { "id": "start-mail", "from": "$entry", "to": "read-mails", "when": { "outcome": "completed" } },
    { "id": "start-crm", "from": "$entry", "to": "read-crm", "when": { "outcome": "completed" } },
    { "id": "mail-join", "from": "read-mails", "to": "source-join", "when": { "outcome": "completed" } },
    { "id": "crm-join", "from": "read-crm", "to": "source-join", "when": { "outcome": "completed" } },
    { "id": "join-analyze", "from": "source-join", "to": "analyze", "when": { "outcome": "completed" } },
    { "id": "analyze-risk", "from": "analyze", "to": "risk-branch", "when": { "outcome": "completed" } },
    { "id": "high-review", "from": "risk-branch", "to": "risk-approval", "when": { "outcome": "branch-case", "caseId": "high" } },
    { "id": "normal-report", "from": "risk-branch", "to": "write-report", "when": { "outcome": "branch-case", "caseId": "normal" } },
    { "id": "approved-report", "from": "risk-approval", "to": "write-report", "when": { "outcome": "approved" } },
    { "id": "rejected-end", "from": "risk-approval", "to": "rejected-output", "when": { "outcome": "rejected" } },
    { "id": "report-end", "from": "write-report", "to": "report-output", "when": { "outcome": "completed" } }
  ],
  "bindings": [
    { "id": "mailbox", "from": "flow.input.mailbox", "to": "read-mails.input.mailbox", "required": true },
    { "id": "crm-scope", "from": "flow.input.customerScope", "to": "read-crm.input.customerScope", "required": true },
    { "id": "mail-data", "from": "read-mails.output", "to": "analyze.input.mailData", "required": true },
    { "id": "crm-data", "from": "read-crm.output", "to": "analyze.input.crmData", "required": true },
    { "id": "risk-level", "from": "analyze.output.riskLevel", "to": "risk-branch.input.riskLevel", "required": true },
    { "id": "risk-items", "from": "analyze.output.riskItems", "to": "risk-approval.input.riskItems", "required": true },
    { "id": "report-data", "from": "analyze.output.reportData", "to": "write-report.input.reportData", "required": true },
    { "id": "report-result", "from": "write-report.output", "to": "report-output.input.value", "required": true }
  ]
}
```

控制边决定两项读取何时启动和汇合；Bindings 独立定义数据如何进入分析 CF。即使遗漏 `mail-join` 控制边，`mail-data` binding 也会令编译失败，而不是在运行时碰运气。

#### 编译后：FlowPlan DSL v0.4（摘要）

```json
{
  "version": "0.4",
  "flowId": "customer-weekly-report",
  "flowVersion": "1.0.0",
  "objective": "汇总客户邮件与 CRM 数据，识别高风险事项并生成周报",
  "sourceRevision": 9,
  "entries": [0, 1],
  "limits": { "maxConcurrency": 2, "maxNodeDispatches": 32, "maxHandoffBytes": 65536 },
  "nodes": [
    { "index": 0, "kind": "cf-call",
      "cfRef": { "cfId": "read-customer-mails", "version": "1.0.0" },
      "programHash": "sha256:mail-program", "executor": { "id": "dsh", "profileVersion": "1.0.0" },
      "inputContract": { "type": "object" }, "outputContract": { "type": "object" },
      "requiredCapabilities": ["mail.read"], "onError": { "action": "stop" } },
    { "index": 1, "kind": "cf-call",
      "cfRef": { "cfId": "read-crm-updates", "version": "1.1.0" },
      "programHash": "sha256:crm-program", "executor": { "id": "dsh", "profileVersion": "1.0.0" },
      "inputContract": { "type": "object" }, "outputContract": { "type": "object" },
      "requiredCapabilities": ["crm.read"], "onError": { "action": "stop" } },
    { "index": 2, "kind": "control", "op": "join", "mode": "all",
      "onUpstreamFailure": "fail", "resultMode": "status-only", "remaining": "drain" },
    { "index": 3, "kind": "cf-call",
      "cfRef": { "cfId": "analyze-customer-status", "version": "2.0.0" },
      "programHash": "sha256:analysis-program", "executor": { "id": "codex", "profileVersion": "1.1.0" },
      "inputContract": { "type": "object", "required": ["mailData", "crmData"] },
      "outputContract": { "type": "object", "required": ["reportData", "riskLevel", "riskItems"] },
      "requiredCapabilities": ["business.analyze"] },
    { "index": 4, "kind": "control", "op": "branch", "cond": "$input.riskLevel",
      "cases": ["high", "normal"] },
    { "index": 5, "kind": "control", "op": "approval", "policyRef": "customer-risk-review" },
    { "index": 6, "kind": "cf-call",
      "cfRef": { "cfId": "write-weekly-report", "version": "2.1.0" },
      "programHash": "sha256:report-program", "executor": { "id": "llm", "profileVersion": "2.0.0" },
      "inputContract": { "type": "object", "required": ["reportData"] },
      "outputContract": { "type": "string", "minLength": 1 },
      "requiredCapabilities": ["text.generate"] },
    { "index": 7, "kind": "output", "outputId": "report",
      "contract": { "type": "string", "minLength": 1 } },
    { "index": 8, "kind": "output", "outputId": "rejected", "inputDefaults": { "status": "rejected" },
      "contract": { "type": "object", "required": ["status"] } }
  ],
  "edges": [
    { "id": "e0", "from": 0, "to": 2, "when": { "outcome": "completed" } },
    { "id": "e1", "from": 1, "to": 2, "when": { "outcome": "completed" } },
    { "id": "e2", "from": 2, "to": 3, "when": { "outcome": "completed" } },
    { "id": "e3", "from": 3, "to": 4, "when": { "outcome": "completed" } },
    { "id": "e4", "from": 4, "to": 5, "when": { "outcome": "branch-case", "caseId": "high" } },
    { "id": "e5", "from": 4, "to": 6, "when": { "outcome": "branch-case", "caseId": "normal" } },
    { "id": "e6", "from": 5, "to": 6, "when": { "outcome": "approved" } },
    { "id": "e7", "from": 5, "to": 8, "when": { "outcome": "rejected" } },
    { "id": "e8", "from": 6, "to": 7, "when": { "outcome": "completed" } }
  ],
  "bindings": [
    { "id": "b0", "from": "$user.mailbox", "to": "$0.input.mailbox", "required": true, "maxBytes": 4096 },
    { "id": "b1", "from": "$0.output", "to": "$3.input.mailData", "required": true, "maxBytes": 32768 },
    { "id": "b2", "from": "$1.output", "to": "$3.input.crmData", "required": true, "maxBytes": 32768 },
    { "id": "b3", "from": "$3.output.riskLevel", "to": "$4.input.riskLevel", "required": true, "maxBytes": 256 },
    { "id": "b4", "from": "$3.output.riskItems", "to": "$5.input.riskItems", "required": true, "maxBytes": 8192 },
    { "id": "b5", "from": "$3.output.reportData", "to": "$6.input.reportData", "required": true, "maxBytes": 32768 },
    { "id": "b6", "from": "$6.output", "to": "$7.input", "required": true, "maxBytes": 32768 }
  ]
}
```

#### 事件驱动执行

```text
Run 启动
  → entries {0,1} 同时 ready
  → 节点0(读取邮件 CF) 与节点1(读取 CRM CF)并发执行；各自由 CF Runtime 执行 CFProgram
  → 任一先完成，只提交自己的 output；join 尚未 ready
  → 两者都成功后 join/all ready 并立即完成
  → 解锁节点3分析
  → 节点4 branch 只激活 high 或 normal 一条边
  → high 路径等待 approval；normal 路径直接生成报告
  → rejected 路径到 output 8；approved/normal 路径到 output 7
  → 命中 output 后停止 admission，处理 in-flight 后完成 Run
```

**本例验证：**

- 一个 CFVersion/CFProgram 可以被 DAG 并发调用，但不知道自己的依赖；
- fan-out/fan-in 由 edges + join 表达，不污染 CF 接口；
- 数据 binding 与控制依赖分离且相互校验；
- agent 只输出 `riskLevel` 数据，branch 拥有跳转权；
- approval 是持久化控制元素；
- OMA 式 ready-set 与失败传播被吸收，但图不会在运行时漂移。
---

## 15. AgentExecutor Adapter 设计（参考 dsh subagent providers）

### 15.1 参考骨架（dsh 外部 agent provider 的 5 职责）

从 dsh `subagent-claude-code` / `subagent-codex` 源码提炼的通用模式：

```
Executor Adapter 的 5 个职责：
1. 任务构造（CF 任务 + 入参 → 该 agent 的 prompt）
2. 进程/连接管理（spawn 外部 CLI 或连服务）
3. 执行 + 取消（signal 贯穿，可中断）
4. 结果映射（严格区分成功/失败/停止）
5. 产物契约化（把 agent 的文本 → 结构化出参）
```

**沿用 dsh 的关键做法：**
- 用**官方 SDK**（claude-agent-sdk / codex 协议）而非裸调 CLI
- 进程交给**共享 subprocess 管理**（超时/kill 进程树/环境 scrubbing）
- **signal 统一取消**（raceAbort 模式）
- **严格结果映射**（只有明确成功才算成功）
- **环境 scrubbing**（不把父进程敏感 env 泄漏给子 agent）

### 15.2 AgentExecutor 接口（细化版）

```typescript
interface AgentExecutor {
  id: string
  capabilities: string[]            // 擅长什么（用于能力门控）
  execute(req: ExecutorRequest): Promise<ExecutorResult>
}

interface ExecutorRequest {
  runId: string
  flowNodeIndex: number
  cfStepIndex: number
  task: string                      // 当前 AgentStep 的自然语言任务
  input: unknown                    // CF Runtime 解析后的函数局部入参
  outputSchema?: OutputContract
  cwd?: string
  grantedCapabilities: string[]
  grantedEffects: EffectGrant[]
  resources?: ResolvedResource[]
  deadlineUnixMs: number            // 只能继承/收窄上层 deadline
  remainingAgentTurns?: number
  idempotencyKey?: string
  signal: AbortSignal
  env?: Record<string, string>
}

type ExecutorResult =
  | {
      stopReason: 'completed'
      raw: string
      effectReceipts?: EffectReceipt[]
      usage?: { tokens?: number; cost?: number; durationMs: number }
    }
  | {
      stopReason: 'max-tokens' | 'context-exceeded' | 'timeout' | 'aborted' | 'error'
      raw?: string
      error: {
        code: string
        message: string
        retryable: boolean
        effectState: 'not-started' | 'committed' | 'unknown'
      }
      usage?: { tokens?: number; cost?: number; durationMs: number }
    }
```

`ExecutorRequest` 只包含当前 AgentStep 需要的信息，不包含完整 CFProgram、FlowPlan、其他 Flow 分支或可写程序计数器。`grantedCapabilities` / `grantedEffects` 由 Flow Engine 外层授权后交给 CF Runtime，再按当前 step 收窄，不是 agent 的申请原文。

AgentExecutor provider 必须映射到统一 `ExecutorResult` envelope；CF Runtime 的 CallStep 则由 script/service registry 映射到对应的 LocalCallResult。两者只有明确 completed 才能进入局部契约 gate，但不会伪装成同一种 FlowPlan target。

### 15.3 通用骨架（ExternalProcessExecutor 抽象类）

```typescript
abstract class ExternalProcessExecutor implements AgentExecutor {
  abstract id: string
  abstract capabilities: string[]
  protected abstract buildPrompt(req: ExecutorRequest): string
  protected abstract runProcess(req: ExecutorRequest): Promise<RunOutput>

  async execute(req: ExecutorRequest): Promise<ExecutorResult> {
    const start = Date.now()
    const prompt = this.buildPrompt(req)                    // 1. 任务构造
    const run = await this.runProcess({ ...req, prompt })   // 2. 执行（含取消/超时）
    const stopReason = this.mapStopReason(run)              // 3. 结果映射
    if (stopReason !== 'completed') return this.toFailure(run, stopReason, start)
    return { stopReason: 'completed', raw: run.output,
      usage: { durationMs: Date.now() - start } }
  }
}
```

Adapter 只负责把各供应商的生命周期映射成统一的明确结果；公共 gate 在 executor 明确 `completed` 后再做契约化。这样“进程退出”和“节点成功”不会混为一谈。

### 15.4 各 adapter 实现要点

**Claude Code Executor**（参考 `subagent-claude-code`）：
- 用官方 `claude-agent-sdk` 的 `query()`，进程交给共享 subprocess 管理
- **纯文本任务**：Claude Code 不支持图片/工具块入参，CF 任务必须转纯文本
- **严格成功映射**：只有 SDK 明确成功结果算 `completed`，其他都算 error/aborted
- 超时/取消时 kill 整个进程树（graceMs 分级）

**Codex Executor**（参考 `subagent-codex` wire.ts）：
- 走 Codex app-server 的 **JSON-RPC 协议**（JsonRpcLineTransport），管理 thread/turn 生命周期
- **无人值守审批**：agent 要审批时自动选 `cancel`/`decline`（unattendedDecision）
- **上下文超限检测**：识别 `contextWindowExceeded` 错误，映射为特定 stopReason

**裸 LLM Executor**（最简单，无外部进程）：
- 直接调 LLM API（OpenAI/DeepSeek/Anthropic）
- 用 structured output / JSON mode 强制输出契约形状

**dsh Executor**（当 dsh 是执行器之一）：
- 调 dsh agent 接口（headless 或 SDK），用其 `outputSchema` 支持（SubagentStartRequest.outputSchema）

### 15.5 产物契约化（contractualize，公共 gate）

```typescript
type ContractResult =
  | { ok: true; value: unknown; provenance: 'raw' | 'json-extracted' }
  | { ok: false; raw: string; errors: ContractError[] }

function contractualize(raw: string, schema?: OutputContract): ContractResult {
  if (!schema) return { ok: true, value: raw, provenance: 'raw' }
  const candidate = extractJson(raw)
  const check = validateLightweight(candidate ?? raw, schema)
  return check.ok
    ? { ok: true, value: candidate ?? raw,
        provenance: candidate ? 'json-extracted' : 'raw' }
    : { ok: false, raw, errors: check.errors }
}
```

要点：校验规则保持轻量，但结果是硬性的 `ok/failed`。失败原文进入隔离审计，不能伪装成业务对象流入下游。若某个 Flow 明确允许“结构修复”，它必须是 Plan 中可见的独立 CF 或显式 gate 策略；修复结果需重新校验并记录 provenance，不能由 adapter 暗中调用 LLM 改写。

### 15.6 注册表 + 能力门控（参考 dsh `ctx.subagents`）

```typescript
class ExecutorRegistry {
  register(executor: AgentExecutor): () => void {
    this.executors.set(executor.id, executor)
    return () => this.executors.delete(executor.id)   // disposer（HMR 安全）
  }
  resolve(ref: ExecutorRef, requiredCapabilities: string[] = []): AgentExecutor {
    const executor = this.getExact(ref.id, ref.profileVersion)
    if (!executor) throw new Error(`executor '${ref.id}@${ref.profileVersion}' 未注册`)
    const missing = requiredCapabilities.filter(c => !executor.capabilities.includes(c))
    if (missing.length) throw new Error(`executor '${id}' 缺少能力: ${missing.join(', ')}`)
    return executor
  }
}
```

要点：`register` 返回 disposer（卸载清除，HMR 安全）；capability 使用版本化的精确 ID 匹配，能力门控 **fail loud**，不使用 `includes` 模糊匹配，也不静默换 executor。

### 15.7 通用基建（所有 adapter 共用，参考 dsh）

- **raceAbort**：取消竞争模式（signal 贯穿，抄 dsh wire.ts）
- **env scrubbing**：不把父进程敏感 env（API keys 等）泄漏给外部 agent（抄 dsh sdkEnvironmentOverlay）
- **子进程管理**：超时 / kill 进程树 / 资源回收（用 dsh-subprocess 或自建）
- **最小授权装配**：只挂载当前节点 `grantedCapabilities`、`grantedEffects` 和 workspace 范围对应的工具
- **Plan 隔离**：adapter 不接收完整 FlowPlan 或 CFProgram，不解析 agent 输出中的 next-node、goto 或新权限请求

### 15.8 CF Runtime：执行单个 CFProgram

CF Runtime 是 Flow Engine 与 AgentExecutor/script/service 之间的函数执行层：

```typescript
interface CFCallRequest {
  runId: string
  flowNodeIndex: number
  cfRef: { cfId: string; version: string }
  expectedProgramHash: string
  executor?: ExecutorRef
  input: unknown
  grants: {
    capabilities: string[]
    effects: EffectGrant[]
    resources: ResolvedResource[]
    cwd?: string
    env?: Record<string, string>
  }
  deadlineUnixMs: number             // 已取 Run/Flow node/CF 的最早 deadline
  budget: {
    remainingStepExecutions: number
    remainingExternalCalls: number
    remainingAgentTurns?: number
  }
  idempotencyKey?: string
  signal: AbortSignal
}

type CFCallResult =
  | { status: 'completed'; output: unknown; stepAudit: CFStepAuditRecord[]; usage: Usage }
  | { status: 'failed' | 'aborted'; error: CFExecutionError; stepAudit: CFStepAuditRecord[]; usage: Usage }

interface CFRuntime {
  execute(request: CFCallRequest): Promise<CFCallResult>
}
```

执行前必须从 CF Registry 读取精确 CFVersion artifact，基于 canonical `{publishedContract, compiledProgram}` 重算 programHash，然后校验输入契约和本次 grants 不超出 publishedContract。局部执行状态只包含 `$input`、`$local`、`$resource` 和最短生命周期 `$secret`：

```typescript
async function executeCFProgram(version: CFVersionArtifact, req: CFCallRequest): Promise<CFCallResult> {
  const program = version.compiledProgram
  const contract = version.publishedContract
  assertContract(contract.inputContract, req.input)
  const local = new Map<number, unknown>()
  const stepsByIndex = indexProgramSteps(program.steps) // 拒绝重复/缺失 index
  let pc = program.entry
  let executions = 0

  while (executions++ < program.limits.maxStepExecutions) {
    const step = stepsByIndex.get(pc)
    if (!step) return failedCFCall('CF_STEP_NOT_FOUND')
    switch (step.kind) {
      case 'agent': {
        if (!req.executor) return failedCFCall('EXECUTOR_REQUIRED')
        const executor = executors.resolve(req.executor, req.grants.capabilities)
        const result = await executor.execute(buildExecutorRequest(step, local, req))
        local.set(step.index, acceptCompletedOutput(result, step.outputContract))
        pc = step.next
        break
      }
      case 'call': {
        const result = await callRegisteredTarget(step.target, resolveLocal(step.input, local, req), req)
        local.set(step.index, assertLocalOutput(result, step.outputContract))
        pc = step.next
        break
      }
      case 'guard':
        pc = evalRestrictedCondition(step.cond, local, req.input) ? step.then : step.else
        break
      case 'return': {
        const output = resolveLocal(step.source, local, req)
        assertContract(contract.outputContract, output)
        return completedCFCall(output)
      }
    }
  }
  return failedCFCall('CF_STEP_LIMIT_EXCEEDED')
}
```

**CF Runtime 不变量：**

- 只执行当前 CFProgram，不加载 FlowPlan 或其他 CFProgram；
- 只有 AgentStep 调用绑定 executor；CallStep 只能调用已注册 script/service；skill 只作为 AgentStep 的受控上下文；
- CFProgram 不能运行时新增步骤、改写 step.next 或调用其他 CF；
- `$local` 在函数结束后销毁，只有 return value、effects ledger 和审计向外暴露；
- programHash、input/output contract、capabilities、needs、effects 任一不匹配都 fail closed；
- CF 的重试策略与 Flow 节点重试分层：局部 step retry 只处理当前步骤瞬时错误；耗尽后才返回 CF failure；Flow retry 会从函数入口重新调用整个 CF。
- 有效 deadline 是 Run、Flow node、CF 默认和 step timeout 的最早值，沿同一个 AbortSignal 向下传播；任何层都只能收窄，不能延长。
- 局部重试与 Flow 重试共享 Run 的 `remainingExternalCalls/AgentTurns` 预算，避免 attempts 相乘失控；backoff 必须检查剩余 deadline。
- 发生 effects 的 step 或 CF 默认禁止自动重试；只有声明幂等、提供稳定 idempotencyKey，或经人工确认后才允许。effects ledger 以 `{runId, flowNode, cfStep, idempotencyKey}` 去重。

### 15.9 Timeout、Retry 与 Error 的分层优先级

| 层 | 可以处理什么 | 不可以做什么 |
|---|---|---|
| Run | 全局取消、绝对 deadline、总预算 | 延长下层 deadline、把取消改成 retry |
| Flow Call | 重试整个 CF、skip fallback、沿显式 failed edge route | 跳入 CFProgram 中间 step |
| CF Step | 重试当前 Agent/Call step、契约兼容 fallback、fail-cf | 调用其他 CF、选择 Flow edge |
| Adapter | 安全的传输级重连/恢复 | 在请求已可能被接受后私自重放语义任务 |

优先级为：**用户/Run abort > 最早 deadline > 预算耗尽 > 当前层错误策略**。取消永不进入 retry；timeout 只有在剩余 deadline 足够且 effects 幂等时才可重试；外层 Flow retry 每次产生新的 CF Call attempt，但沿用稳定 idempotency scope。错误必须归一化为带 `layer/code/retryable/effectState` 的结构，禁止靠 message 字符串决定策略。

---

## 16. flow-engine 实现设计（Event-driven DAG）

### 16.1 运行时状态

flow-engine 不再维护单一 `currentNode`。它维护冻结 DAG 的节点状态、ready set 和 in-flight 集合：

```typescript
type NodeStatus =
  | 'pending' | 'ready' | 'running'
  | 'completed' | 'failed' | 'blocked' | 'inactive' | 'cancelled'
  | 'waiting-approval' | 'needs-reconciliation' 

interface NodeRuntimeState {
  status: NodeStatus
  attempts: number
  output?: unknown
  outcome?: 'completed' | 'approved' | 'rejected' | { branchCase: string }
  error?: NodeFailure
}

type EdgeStatus = 'unresolved' | 'activated' | 'inactive'

interface FlowExecutionState {
  nodes: Map<number, NodeRuntimeState>
  edges: Map<string, EdgeStatus>
  ready: Set<number>
  inFlight: Map<number, Promise<NodeCompletion>>
  outputs: Map<number, unknown>
  history: FlowAuditRecord[]
  admissionOpen: boolean
  terminalCandidate?: { node: number; outputId: string; value: unknown }
  dispatchedSteps: number
}
```

节点状态只有 flow-engine 可以修改。executor 只返回 `ExecutorResult`，不能写入 ready set、node status 或程序图。

### 16.2 Ready 判定：DAG 与 CF 的运行时接口

一个节点进入 `ready` 必须同时满足：

1. 节点仍是 `pending`；
2. 节点属于 `plan.entries`，或其入边已经有 activated 且不再存在阻塞 readiness 的 unresolved 前置；
3. 它的前置语义已满足：
   - 普通 cf-call/branch/approval/output：所有静态入边已 resolved（activated/inactive），至少一条 activated，且所有 activated predecessor 成功；
   - join/all：所有 eligible source 成功完成；
   - join/any：至少一个 eligible source 成功；
   - join/quorum：成功 source 数达到 quorum；
   - approval：上游已完成且审批请求已持久化；
4. 所有 `required` bindings 的来源已经物化且未越过未激活分支；
5. Run 尚未进入终止或取消阶段。

```typescript
function isReady(index: number, plan: FlowPlan, state: FlowExecutionState): boolean {
  const node = plan.nodes[index]!
  const runtime = state.nodes.get(index)!
  if (runtime.status !== 'pending' || !state.admissionOpen) return false
  if (!controlPrerequisitesSatisfied(index, plan, state)) return false
  if (!requiredBindingsAvailable(index, plan, state)) return false
  return joinConditionSatisfied(node, plan, state)
}
```

**控制边与数据 Binding 分离，但共同决定 readiness**：控制边使节点有资格启动；Binding 使输入完整。二者缺一不可。

Edge outcome 是边状态的唯一来源：某源节点提交 outcome 后，与 outcome 匹配的出边变为 activated，其余出边变为 inactive。普通节点只有在所有静态入边都 resolved 后才判断 ready/inactive，因此两个互斥 branch case 汇入同一共享节点时，一条 activated、一条 inactive，不会误把共享节点递归淡出。非 entry 节点若所有入边最终 inactive，则节点标记 inactive；若存在 activated 路径但 required binding 因上游失败无法物化，则标记 blocked/failed，而不是 inactive。

### 16.3 事件驱动主循环

吸收 OMA 的 ready-set / in-flight 模型：某节点完成后立即重新计算其受影响的下游，不等待同批无关节点。

```typescript
async function runFlow(plan: FlowPlan, ctx: FlowContext): Promise<FlowResult> {
  verifyConfirmedPlan(plan, ctx.confirmation)
  const state = initializeDagState(plan)
  activateEntries(plan.entries, state)
  refreshReady(plan.entries, plan, state)

  while (true) {
    if (ctx.signal.aborted) return abortAndDrain(plan, state, ctx)
    if (state.dispatchedSteps >= plan.limits.maxNodeDispatches) {
      return failAndDrain('STEP_LIMIT_EXCEEDED', plan, state, ctx)
    }

    while (
      state.admissionOpen
      && state.ready.size > 0
      && state.inFlight.size < plan.limits.maxConcurrency
    ) {
      const index = chooseReadyNode(state.ready, plan, state) // priority + stable index
      dispatchNode(index, plan, state, ctx)
      state.dispatchedSteps++
    }

    if (state.terminalCandidate && state.inFlight.size === 0) {
      return completeTerminal(state.terminalCandidate, state)
    }
    if (state.inFlight.size === 0 && state.ready.size === 0) {
      return diagnoseStallOrFailure(plan, state) // blocked / unreachable / failed
    }

    const completion = await Promise.race(state.inFlight.values())
    commitCompletion(completion, plan, state, ctx)
    const affected = downstreamClosure(completion.nodeIndex, plan)
    refreshReady(affected, plan, state)
  }
}
```

`chooseReadyNode` 只决定同一 ready set 中的启动顺序，不改变 executor、依赖或图。MVP 使用 `priority` 后按稳定 Plan index 排序；不引入 OMA 的自动 assignee 策略，因为 Executor Profile 已随 FlowVersion 冻结；adapter build/model 等实际事实进入 Receipt。

### 16.4 executeCFCall：Flow Engine 与 CF Runtime 的边界

```typescript
async function executeCFCall(node: CallCFNode, state, ctx): Promise<NodeCompletion> {
  try {
    const input = resolveBindings(node.index, state, ctx)
    assertContract(node.inputContract, input)
    const grants = await ctx.policy.authorize({ runId: ctx.runId, node, actor: ctx.actor })
    if (node.executionMode === 'needs-review') {
      await ctx.approvals.require(node, grants)
    }

    const result = await ctx.cfRuntime.execute({
      runId: ctx.runId,
      flowNodeIndex: node.index,
      cfRef: node.cfRef,
      expectedProgramHash: node.programHash,
      executor: node.executor,
      input,
      grants,
      signal: ctx.signal,
    })
    if (result.status !== 'completed') throw NodeFailure.fromCFCall(result)
    assertContract(node.outputContract, result.output)

    return { nodeIndex: node.index, status: 'completed', output: result.output,
      outcome: 'completed', record: auditCFCall(node, input, result, grants) }
  } catch (error) {
    return resolveNodeErrorPolicy(node, error, state, ctx)
  }
}
```

硬顺序变为：**解析 Flow binding → CF 调用输入门禁 → 外层权限/审批 → CF Runtime 验证 CFVersion/programHash → 执行 CFProgram → CF return 契约门禁 → Flow 节点输出门禁 → 原子提交**。Flow Engine 不解析 CFProgram 的 step，也不直接调用 AgentExecutor/script/service。只有 `commitCompletion` 才把成功 CF return 写入 Flow outputs 并解锁下游。

### 16.5 Branch、Join 与 Approval

**Branch：**

```typescript
function executeBranch(node: BranchNode, state, ctx): NodeCompletion {
  const input = resolveBindings(node.index, state, ctx)
  const caseId = evalRestrictedCase(node.cond, node.cases, input)
  return { nodeIndex: node.index, status: 'completed',
    outcome: { branchCase: caseId }, record: auditBranch(node, caseId) }
}
```

`commitCompletion` 将匹配 `caseId` 的出边标为 activated，其余 branch-case 出边标为 inactive，然后由统一 edge-resolution 算法重新评估下游。它不递归标记“整棵子图”，因此共享汇合节点不会被误伤。branch 不直接持有目标 index，目标只由 PlanEdge 声明。

**Join：**

Join 本身不调用 agent。其 readiness 由 `mode` 决定：

- `all`：所有 eligible source 成功；任一必要 source 失败则按 `onUpstreamFailure` 处理；
- `any`：第一个成功 source 即可；
- `quorum`：成功数达到 `quorum`；
- join 的静态入边在 branch/outcome resolution 后分为 activated、inactive、unresolved；inactive 不计入 eligible source；
- any/quorum 达成后，对其余 running 分支按 `remaining: drain | cancel` 处理。

Join 完成时始终输出状态摘要；只有 `resultMode='canonical-results'` 时才包含上游正式 CF return：

```typescript
interface JoinOutput {
  completed: Array<{ source: number; value?: unknown }>
  failed: Array<{ source: number; error: NodeFailure }>
  inactive: number[]
}
```

`value` 只在 canonical-results 模式出现，键按稳定 source index 排序并受 maxResultBytes 限制；不得包含 executor raw、CF `$local` 或 tool transcript。

**Approval：**

ApprovalNode 是业务流程门禁：到达后创建持久化审批请求并进入 `waiting-approval`，批准/拒绝产生显式 edge outcome，适合需要在 DAG 中展示两条业务路径的场景。恢复运行时必须从审批 ledger 重建状态。

`CallCFNode.executionMode='needs-review'` 是执行授权门禁：在调用 CF 前确认本次 grants/effects；拒绝时该节点失败并按 onError 处理，不自动产生业务 rejected 分支。需要“拒绝后走另一业务路径”时必须使用显式 ApprovalNode，不能混用两种审批语义。

### 16.6 失败传播

吸收 OMA 的“失败级联到依赖者，无关分支继续”原则，但按冻结 DAG 和 binding 语义执行：

- 节点最终失败后先提交 failed outcome：匹配 failed edge 可被激活；其余 completed/case edge 变 inactive。直接依赖其 required binding 或 all-join 且无错误路由的下游变为 failed/blocked；
- 与失败节点无控制/数据依赖的分支继续；
- optional binding 缺失不自动失败，但必须使用显式默认值；
- `skip` 必须物化符合契约的 fallback，随后按 completed 处理；
- `retry` 有界，每次尝试独立审计；
- branch inactive 路径不是失败，不触发失败级联；
- any/quorum join 是否能在部分失败下继续，由 join 的显式策略决定。

### 16.7 Binding 与 Context Handoff

Binding 是 CF 函数边界的唯一跨节点数据通道。它只能读取：Flow input、CF canonical return、显式 ResourceContext 或 join canonical-results。AgentExecutor raw、CF `$local`、tool transcript 和 secret 永不进入 Flow Binding；若业务确实需要原文，CF 必须在 outputContract 中显式返回对应字段。

所有绑定值受 `maxBytes` 和 FlowPlan 全局 `maxHandoffBytes` 限制。required 值缺失、不可序列化或不满足目标输入契约是硬错误；optional binding 必须带显式 default，不能静默产生 undefined。`ContextHandoff` 是普通的 CF return 字段，只传数据，不获得流程权力。

### 16.8 Output 与终止协调

一个 output 节点成功后：

1. 设置 `terminalCandidate { outputId, value }`；
2. `admissionOpen = false`，不再启动新节点；
3. 根据 Run 终止策略 drain 或 cancel 已 in-flight 节点；
4. 等待在途工作完成清理、审计与副作用提交状态明确；
5. 返回 completed。

这避免并行分支仍在写文件/发邮件时 Flow 已被标记完成。编译器应拒绝可能并发命中多个 output 的图；若产品未来支持“首个终止获胜”，必须作为显式 Flow 策略，不采用隐式竞态。

### 16.9 取消、预算与并发

- 用户 abort：关闭 admission，向所有 in-flight executor 传播 signal，等待 settle 后标记剩余节点 cancelled；
- 预算耗尽：停止接纳新节点，已启动任务按策略 drain；
- 并发权威只有 flow-engine 的 semaphore；executor 内部子委派需计入同一容量或使用独立有界预算，防止死锁和并发爆炸；
- Plan 发布时展示静态最大宽度估计，Run 时记录实际峰值并发；
- 外部 agent 后端若无法准确上报 token，必须使用自身时间/turn/费用上限，不能假装为零成本。

### 16.10 权威 Run Ledger、可观测 Trace 与恢复

Flow Engine/CF Runtime 必须把状态提交、CF return、edge outcome、approval、effect receipt、resource access、attempt 和 idempotency marker 写入持久化 **Run Ledger**。Ledger 是 Execution Receipt 与恢复判断的事实来源；Observability Trace 是可丢失的诊断投影，只补充 timing、LLM/tool span、token/cost 等信息，不能单独证明审批、effects 或完成状态。

每个 Node Run 的 Trace 可记录 Plan/program hash、source map、attempt、I/O 摘要、binding provenance、executor、授权、gate、耗时、成本和状态。Checkpoint 必须与 Ledger commit position 对齐并原子保存：

- 各节点状态；
- 已提交 outputs；
- ready set 可由图和状态重算，不作为唯一事实；
- in-flight 节点的 commit marker；
- 审批 ledger 引用；
- 预算与使用量。

恢复时以 Ledger commit 为准跳过已完成节点，不能依据 span 是否结束判断。只有 Trace 丢失时 Run 仍可完成并生成 telemetry=partial Receipt；Ledger 缺失或校验失败则不能声称治理事实完整。

平台只对内部状态提交提供幂等/原子语义，不承诺外部副作用 exactly-once。若 adapter 报告 `effectState=unknown`，或存在 effect-start 但无 commit，节点和 Run 进入 `needs-reconciliation`，关闭下游 admission，禁止自动 retry。维护者必须选择：基于稳定 idempotency key 回读确认已提交、执行显式补偿、确认安全重试，或终止；所有决定写入 Ledger。

### 16.11 设计原则

**flow-engine 是冻结 FlowPlan DAG 的事件驱动解释器**：它借鉴 OMA 的 ready-set、依赖解锁、并行执行、失败传播和 structured handoff，但绝不在运行时创建节点、修补图、改变 executor 或扩大权限。Flow Engine 调用 CF Runtime，CF Runtime 执行 CFProgram，AgentExecutor 只执行 AgentStep。CF 定义函数，Edge 定义控制，Binding 定义数据。
---

## 17. 资源上下文与交接（Resource Context & Context Handoff）

### 17.0 问题回顾

多 agent 异构调度的普遍问题：不同 CF 可能操作代码仓库、邮箱、知识库或数据库；下游 agent 只拿到上一节点业务结果，却不了解当前 Run 绑定资源的结构和约束，容易重复扫描、误用资源或丢失关键背景。

**根因**：每个 agent 执行时是“冷启动”——只拿到“入参 + CF 任务”，没有“已绑定资源上下文 + 任务累积上下文”。

**关键洞察**：多 agent 不能共享 session，但 Flow 可以显式传递两类数据：由 Resource Binding 派生的 `ResourceContext`，以及上一个 CF 产出的 `ContextHandoff`。二者都只是契约化数据，不是 Project 容器，也不携带流程控制权。

### 17.1 三层机制

**机制 1：资源理解 CF（Flow 级、按需使用）**
```
[资源理解 CF] → 读取本次 Run 已绑定且已授权的 Resource
      → 产出 ResourceContext（一次）
      ↓ 被后续所有 CF 引用
[读取数据] → [分析] → [实施] → [生成报告]
```
- Flow 设计者可以从 CF Library 选择适合资源类型的理解 CF，例如“建立代码仓库索引”或“建立知识库主题索引”。
- 它是普通、显式、可替换的 CF 节点，不是平台在后台自动执行的 Project 初始化步骤。
- 后续 CF 通过 Flow bindings 接收其输出，避免每个 agent 各自从头扫描。

**机制 2：contextHandoff（CF 级，出参的一部分）**
```
CF 出参 = { 业务结果, contextHandoff: { 下游需要的关键信息 } }
```
- 每个 CF 的出参，除了业务结果，还带一段"给下游的上下文交接包"
- 内容：这个任务相关的关键信息（关键文件、决策、约束、已确认的假设）
- 下一个 CF 入参 = 业务结果 + contextHandoff

**机制 3：needs 预读 / 资源索引（CF 级、针对型）**
```
CF 声明 ResourceRequirement / needs
   ↓ 编译/确认时展示读取范围
   ↓ Run 创建时绑定具体 Resource
   ↓ flow-engine 按政策解析并授权 → 内容/句柄/索引作为节点资源
```
代码仓库可以提供文件索引，知识库可以提供主题/文档索引，邮箱可以提供文件夹和时间范围。agent 只能在已授权 scope 内定位式补读。

### 17.2 ResourceContext 定义

```typescript
interface ResourceContext {
  resourceId: string
  resourceType: string
  summary: string
  index?: Array<{ locator: string; purpose?: string }>
  facts?: string[]
  constraints?: string[]
  conventions?: string[]
  generatedAt: string
  sourceRevision?: string
  provenance: Array<{ locator: string; hash?: string }>
}

interface RepositoryContext extends ResourceContext {
  resourceType: 'repository'
  structure: string[]
  keyFiles: Array<{ path: string; purpose: string }>
  techDecisions: string[]
}
```

**生成方式**：资源理解 CF 在本次 Run 已绑定、已确认的读取权限内扫描并提炼；**可校验**（locator 可机械核对，revision/hash 可检测过期）；**可回退**（下游信息不足时可在已授权范围内补读，超出范围则明确失败并建议修改 Flow requirement）。运行中的 agent 不能通过“声明 needs”直接扩大读取范围。

ResourceContext 的生命周期从属于 Resource Binding 和 Flow Run，不成为 Project，也不拥有 Flow。相同 Flow Version 绑定不同 Resource 时会生成不同上下文。

### 17.3 ContextHandoff 定义

```typescript
interface ContextHandoff {
  summary: string                // 本 CF 产出的要点（1-2 句）
  keyFiles?: string[]            // 下游可能需要看的文件
  decisions?: string[]           // 本 CF 做的关键决策（下游要遵循）
  assumptions?: string[]         // 本 CF 依赖的假设（下游要知道）
  constraints?: string[]         // 新增约束
  nextActions?: string[]         // 仅供人/既定下游参考，不具有跳转语义
}
```

**写入方式**：CF 的出参契约里声明 `handoff: ContextHandoff`，由执行该 CF 的 agent 在产出时一并生成。若要用单独 LLM 提炼，必须在 Plan 中表现为可见的独立 CF，不能由 flow-engine 暗中引入智能步骤。

### 17.4 组合效果（完整流程）

```
[建立代码仓库索引 CF] → RepositoryContext（来自本次绑定的 Repository）
      ↓
[读邮件: dsh] → 出参 = { 邮件要点, handoff: { summary: "3封客户邮件, 2封紧急" } }
      ↓
[写方案: codex] → 入参 = RepositoryContext + 邮件要点 + handoff
      → 出参 = { 方案, handoff: { keyFiles: ["src/main.ts"], decisions: ["用X架构"] } }
      ↓
[写代码: claude-code] → 入参 = RepositoryContext + 方案 + handoff
      → 它已有"资源索引 + 关键文件 + 决策" → 在授权 scope 内定位细读
      ↓
[生成报告: llm] → 入参 = 各步出参摘要 + handoffs
      → 产出最终周报
```

**效果**：每个 agent 不是冷启动扫描，而是带着“本次 Run 的资源上下文 + 上一 CF 的交接”进入节点，只做定位式读取，降低 token 和时间成本。

### 17.5 权衡与边界

| 点 | 说明 |
|----|------|
| **上下文包质量** | 取决于提炼 agent 是否准确——错了/漏了，下游基于错误上下文干活 |
| **缓解** | 可校验（关键文件清单机械核对）+ 可回退（已授权范围内自主补读；超出范围则失败并建议修改 needs）+ 置信度标记 |
| **开销** | 资源理解 CF 多一次扫描成本，但可能避免多个 CF 重复扫描；由 Flow 设计者按任务决定 |
| **不适用** | 任务简单或资源结构无需预理解时，不在 Flow 中加入资源理解 CF |
| **新鲜度** | Resource 已变化时上下文可能过期；用 revision/hash 检测并按 Flow 策略重新生成 |
| **产品边界** | ResourceContext 属于 Run 数据，不创建 Project 页面层级，也不成为 Flow 的所有者 |
| **与方案 A 作用域的关系** | contextHandoff 是"跨 agent 传递的少数必要信息"，中间态仍不外传——互补不冲突 |

### 17.6 设计决策

> **DD-17**：多 agent 上下文 = **ResourceContext + ContextHandoff**，非共享 session、非 Project 容器。三层机制：① Flow 可显式加入资源理解 CF，基于 Run 的 Resource Binding 产出上下文；② CF 输出携带 handoff；③ executor 在已授权 needs/scope 内定位式补读。handoff 与 nextActions 始终是数据；超范围补读必须修改 Flow requirement 并重新发布，不能在运行时扩大权限或改变下一节点。

---

## 18. 架构不变量与验收标准

这些不变量用于评审后续功能。任何实现或新设计违反其中一条，都视为偏离核心理念，而不是普通实现差异。

| ID | 架构不变量 | 最小验收方式 |
|----|-----------|-------------|
| INV-1 | 未经确认或 hash 不匹配的 Plan 永远不能执行 | 篡改任一 Plan 字段后启动必须失败 |
| INV-2 | agent 不能直接设置、返回或操纵下一节点 | 在 agent 输出中注入 `goto/nextNode`，流程仍只按 control 节点推进 |
| INV-3 | executor 只获得当前 AgentStep、局部数据和最小授权，不获得完整 CFProgram/FlowPlan | adapter 请求快照不含其他 step、Flow 节点或分支 |
| INV-4 | executor 非 `completed` 时，输出不得进入正常 bindings | max-token/timeout/error 测试中下游不执行，除非命中预设错误策略 |
| INV-5 | 声明契约的节点校验失败时不得静默推进 | 形状错误结果必须 stop/retry/skip/显式 failed-edge route，不得成为正常 output |
| INV-6 | agent 不能扩大 `needs/effects` 或调用未注册 script/service | 越权工具、路径、ref 请求必须被 policy/adapter 拒绝并审计 |
| INV-7 | `output` 成功后立即终止，一次运行只命中一个终止输出 | 多分支示例不会继续执行另一分支节点 |
| INV-8 | 所有运行时动态分支目标都属于已确认 Plan 的有限集合 | 编译期拒绝动态 target 和不可达/不终止路径 |
| INV-9 | 修改 executor、binding、effects、错误策略或控制图都会使确认失效 | 每类语义变更都出现在差异视图并要求重新确认 |
| INV-10 | agent 的节点内自主性不被 flow-engine 微编排 | 文件选择、局部工具顺序和实现迭代留在 executor 内部 |
| INV-11 | Flow Draft 是唯一产品编辑源，DSL 不可独立编辑 | 产品只读展示 FlowPlan；所有改动回到 Draft 并重新编译 |
| INV-12 | Flow Version pin 精确 CF Version | 发布快照解析结果中不存在 latest/range；CF 新版不改变旧 Flow |
| INV-13 | 每个 Plan 节点可追溯到 Flow node 或结构元素 | 编译错误、运行失败和审计可从 index 定位到源画布元素 |
| INV-14 | Flow 不依赖 Project 所有权 | 同一 Flow Version 可绑定不同 Repository/Mailbox 等 Resource 运行 |
| INV-15 | Flow Composer 只能产生不可执行 Proposal | Proposal 未被接受前不能写入 Draft、Test Snapshot 或 Flow Version |
| INV-16 | Composer 只能选择 Catalog 中真实可见的 CF Version | 缺失能力必须进入 unresolved；ProposedCFDraft 必须显式且不可执行 |
| INV-17 | 每个已发布 CFVersion 固化 authoredSnapshot、CFProgram 和 programHash | 篡改 CFProgram 后 CF Runtime 必须拒绝执行 |
| INV-18 | FlowPlan 的能力节点只引用 CFVersion，不直接引用 executor 任务、script/service 或 skill | FlowPlan schema 拒绝旧 invoke target |
| INV-19 | CFProgram 不得引用其他 CF 或 Flow/DAG 对象 | cf-compiler 对 `$flow`、CF ref、next-node 等引用 fail closed |
| INV-20 | Flow Engine、CF Runtime、AgentExecutor 分层不可旁路 | Flow Engine 调用快照中无直接 executor/script/service dispatch |
| INV-21 | CFProgram 所有路径有界并到达 return；FlowPlan 所有激活路径到达 output | 两级图验证分别通过，且错误映射回各自源对象 |
| INV-22 | 跨 CF 数据只能来自 canonical return/Flow input/ResourceContext | Binding schema 和运行时拒绝 raw/local/tool/secret 来源 |
| INV-23 | Execution Receipt 由 Run Ledger 生成，Trace 缺失不得伪造治理事实 | 删除/丢失 Trace 后 Receipt 治理字段保持，evidence 标记 partial |
| INV-24 | 节点实例覆盖不能扩大 CFVersion 的 contracts/needs/effects/Program | flow-compiler 对越界 override fail closed |
| INV-25 | 错误路由只走显式 failed edge | onError 引用不存在/非当前节点 edge 时编译失败 |
| INV-26 | 外部副作用未知结果不得自动重试或继续下游 | effectState=unknown 时 Run 进入 needs-reconciliation |
| INV-27 | programHash/planHash 使用固定 canonicalization | 对字段顺序置换 hash 不变，对任一语义字段修改 hash 改变 |

### 18.1 核心概念验证场景

M0–M3 的核心架构验证不能只证明“流程跑通”，还必须累计证明：

0. 用户只输入业务目标，Composer 基于有界 CF Catalog 生成 Flow Proposal；缺失能力只能形成 ProposedCFDraft，不能执行。
1. 用户用自然语言编写 CFDraft，编译、测试并发布 CFProgram/CFVersion；修改 Program 后 hash 校验失败。
2. 用户在 Flow Draft 中自由组装已发布 CFVersion，形成包含并行、branch 和 join 的高层 Loop。
3. Flow 发布时 pin 精确 CFVersion + programHash，生成带 source map 的不可变 FlowPlan；flow-engine 拒绝篡改版本。
4. 同一 FlowVersion 可以绑定不同 Resource 运行，不要求创建或归属某个 Project。
5. 两个不同 executor 可以执行同一 CFProgram 契约，而不改变 Flow DAG。
6. agent 在 AgentStep 内自主完成开放任务，但不能改写 CFProgram 或 FlowPlan。
7. CF 局部契约失败与 Flow 节点失败分别审计，超时、取消、副作用审批拒绝按对应层预设策略处理。
8. Flow Engine 只调用 CF Runtime；直接调 executor/script/service 的旁路测试必须失败。

只有这些条件同时成立，才能说明本架构的核心——**Flow-maintained, human-authored outer loop; CF-bounded, agent-executed inner loop**——已经被实现，而不只是完成了一次多 agent 调用。

---

## 19. Flow Composer 实现设计（目标 → 可编辑初始化 Flow）

### 19.1 定位与 OMA 借鉴边界

Flow Composer 借鉴 Open Multi-Agent 的核心体验：**用户先描述目标，系统结合当前能力清单生成任务结构**。但二者的权力边界不同：

| 维度 | Open Multi-Agent | CF Platform |
|------|------------------|-------------|
| 生成时机 | `runTeam()` 运行时 | Flow 设计期 |
| 输入能力清单 | Agent roster manifest | 有界 CF Catalog Manifest |
| 生成产物 | 可执行任务 DAG / PlanArtifact | 无执行权的 FlowProposal |
| 编辑方式 | PlanArtifact 可修改后 replay | 用户编辑/接受 Proposal 后写入 Flow Draft |
| 最终权威 | Coordinator 生成的任务计划 | 人维护并发布的 Flow Version |
| 重复运行 | 可重新动态规划或 replay Plan | 只执行冻结 Flow Version / FlowPlan |

因此 Composer 不是另一个 flow-engine，也不是运行时 Coordinator。它是**设计期的目标辅助编排器**：降低从空白 Flow 开始的认知负担，同时保持“人维护高层 Loop”的架构宪章。

### 19.2 有界 CF Catalog Manifest

参考 OMA 给 Coordinator 暴露有界 roster manifest 的做法，Composer 只能读取经过授权、限长、结构化的 CF 清单：

```typescript
interface CFCatalogManifestEntry {
  cfId: string
  version: string                    // 精确已发布版本
  name: string
  does: string                       // 有界职责摘要
  inputContractSummary: string
  outputContractSummary: string
  requiredCapabilities: string[]
  needs: ResourceRequirement[]
  effects: EffectRequirement[]
  defaultExecutor?: string
  validationStatus: 'verified' | 'experimental' | 'deprecated'
  tags: string[]
}
```

Manifest 不包含完整实现提示词、凭据、工具实现、用户无权查看的 CF 或未发布 Draft；不能使用 `latest` 或版本范围引用。Manifest 带有 `catalogRevision`，Proposal 必须记录生成时使用的版本，避免 Library 更新后盲目应用陈旧提案。

### 19.3 Composer 输入与输出

```typescript
interface ComposeFlowRequest {
  goal: string
  constraints?: {
    desiredOutputs?: string[]
    allowedCFScopes?: Array<'private' | 'team' | 'organization'>
    allowedExecutors?: string[]
    allowedResourceTypes?: string[]
    forbiddenEffects?: string[]
    maxNodes?: number
    costPreference?: 'low' | 'balanced' | 'quality'
    latencyPreference?: 'fast' | 'balanced' | 'patient'
  }
  targetFlow?: { flowId: string; baseRevision: number }
  catalogRevision: string
}
```

Composer 输出 `FlowProposal`，而不是 FlowPlan。提案可以包含节点、连接、分支、bindings、executor 建议、资源要求、假设、替代 CF、置信度和 `unresolved`。当 Catalog 缺少能力时，可附带 `ProposedCFDraft`：它只是自然语言函数草案，不是虚构的 CFVersion，也没有 CFProgram 或执行权。未声明的约束不能被解释成额外权限；Composer 不能自动授权具体 Resource 或副作用。

```typescript
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
```

### 19.4 两阶段提案生成

```text
阶段 A：候选检索（确定性）
  goal + constraints
    → 按 does / tags / contracts / capabilities 检索可见 CF
    → 形成有界候选集及精确版本

阶段 B：结构规划（LLM）
  goal + constraints + 候选 CF manifest
    → 选择 CF、顺序、有限分支、binding 建议、executor 建议
    → 输出 FlowProposal 草案 + rationale / alternatives / confidence / unresolved
    → 对 Catalog 缺口可输出 ProposedCFDraft，但不生成 CFProgram

阶段 C：Proposal 校验（纯代码）
  → CF Version 真实且可见
  → 图可终止且无非法环
  → bindings 与契约可连接
  → executor/capability 可满足
  → needs/effects 完整暴露
  → 缺口进入 unresolved；ProposedCFDraft 与已发布 CF 节点严格区分
```

候选检索与 Proposal 校验必须是确定性代码。LLM 可以创建显式标记的自然语言 `ProposedCFDraft`，但不能把它冒充为 Catalog 中的 CFVersion，不能生成其 CFProgram，也不能创造 executor、script/service ref、权限或 Resource Binding。

### 19.5 用户审阅与接受

Flow Editor 必须展示：目标被解释成哪些阶段；每个节点使用哪个 CF Version 及选择理由；可选替代项；binding 是否精确或有歧义；引入的 Resource Requirement、effects、审批和 executor；以及当前 Catalog 无法覆盖的目标部分。

用户可以逐节点接受、替换、删除、增加或改线。只有被用户接受的结构化操作才能写入 Flow Draft 并产生新 revision；“全部接受”也必须创建 Draft revision，不能让 Proposal 原地变成可执行 Plan。

对于 ProposedCFDraft，接受动作创建 CFDraft，并把对应 placeholder 作为显式 unresolved node 写入 FlowDraft，以保留稳定 node ID、位置、边和待绑定信息。用户必须编辑 CFDraft、编译测试 CFProgram、发布 CFVersion，再执行 resolve 操作原位替换节点；契约不兼容时继续 unresolved。在此之前 flow-compiler 必须拒绝生成可发布 FlowPlan。

### 19.6 与 flow-compiler 的边界

```text
Flow Composer
  输入：目标 + 有界 CF Catalog
  输出：FlowProposal / FlowDraftPatch / ProposedCFDraft（均无执行权）
  职责：帮助人形成高层 Loop 初稿
  禁止：生成 Plan index、$N 引用、source map、plan hash

flow-compiler
  输入：用户接受的 Flow Draft + 精确 CF Version
  输出：Candidate FlowPlan + source map
  职责：确定性降级与静态校验
  禁止：增加业务步骤、替换 CF、扩大权限、修补源 Flow
```

这条边界保证目标生成不会破坏事实来源：Flow Draft 仍是唯一可编辑源，FlowPlan 仍是 Flow Version 的只读派生物。

### 19.7 不完整目标与失败处理

Composer 不追求“总能生成完整 Flow”。允许以下结果：

- **完整提案**：现有 CF 能覆盖目标，bindings 可验证；
- **部分提案**：可覆盖部分目标，其余进入 `unresolved`，可附 ProposedCFDraft；
- **多方案提案**：存在显著不同的 CF 组合，提供有限数量的可比较方案；
- **拒绝提案**：目标要求的权限、资源或能力超出当前用户/Catalog 边界。

产品应优先显示“缺什么”，而不是回退成一个万能 agent 节点。用户可以接受 ProposedCFDraft 后进入 CF 编译发布链、手动创建 CF、请求团队发布能力，或缩小目标。

### 19.8 Flow Composer 不变量

| ID | 不变量 |
|----|---------|
| COM-INV-1 | Composer 产物永远不可直接执行或发布。 |
| COM-INV-2 | Proposal 中每个可执行 CF 节点都引用真实、可见、已发布的精确版本。 |
| COM-INV-3 | 缺失能力进入 `unresolved`；可提议 CFDraft，但不得伪造 CFVersion、CFProgram 或隐藏万能节点。 |
| COM-INV-4 | 新增 effects、resources、executor 和分支必须在语义 diff 中可见。 |
| COM-INV-5 | 用户接受后才写入 Flow Draft，并产生新的 revision。 |
| COM-INV-6 | Catalog 或 Draft revision 冲突时不得盲目应用旧 Proposal。 |
| COM-INV-7 | Composer 不生成 DSL index、运行时引用、source map 或 plan hash。 |
| COM-INV-8 | 已发布 Flow 的运行不会调用 Composer 重新规划。 |
| COM-INV-9 | ProposedCFDraft 只有经过用户编辑、cf-compiler、CF Test 和发布后，才能解析为 Flow 中的 CFVersion。 |
