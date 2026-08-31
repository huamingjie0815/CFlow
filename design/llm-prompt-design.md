# CFlow Runtime Prompt 与语义组件设计 v2.0

> 状态：当前实现基线，更新于 2026-08-31。
> 当前没有独立 Prompt Registry；Prompt 与输出 Schema 位于 `src/server.ts` 和 `src/runtime.ts`。

## 1. 当前边界

CFlow 只在三个位置让外部 Agent/模型参与语义工作：

| 组件           | 发生阶段    | 输入                                                 | 输出                          | 是否直接执行       |
| -------------- | ----------- | ---------------------------------------------------- | ----------------------------- | ------------------ |
| Flow Proposal  | 设计期      | 目标、有限 CF Catalog、可选附件文本                  | FlowDraft + candidate CFDraft | 否                 |
| Flow Assistant | 设计/诊断期 | 用户问题、当前 Flow、最近 Run evidence               | 说明 + 最多 3 个 action       | 否，用户点击后应用 |
| CF Agent Step  | 运行期      | 当前 task、节点输入、effect、resource、output schema | 当前 step 的 JSON/text 结果   | 是，只在当前 CF 内 |

以下组件当前完全由代码完成，不调用 LLM：

- CFDraft → CFProgram；
- FlowDraft → FlowPlan；
- Contract/Schema 校验；
- graph 可达性、无环和 edge kind 校验；
- programHash/planHash；
- ready-set、branch、join、retry、approval、cancel；
- Resource Profile 解析；
- Ledger 与 Run 状态；
- Runtime 选择和 Profile pin。

早期文档中的 Contract Suggester、CF Compiler LLM、CF Repair、Semantic Narrator、LLM Judge、Prompt Registry、shadow/canary 和 golden harness 尚未实现，不能作为当前调用链描述。

## 2. Runtime Prompt Envelope

`RuntimeManager.executeProfile` 为 CF step 和设计期 analysis 组装统一文本：

```text
You are executing one bounded CF capability inside a fixed Flow.
Complete only the current task.
Do not choose the next Flow node or change the Flow.

Task:
<task>

Input JSON:
<input>

Declared effects:
<effects or none>

Expected output JSON Schema:
<schema, if present>

Authorized resources:
<resources or none>
```

如果 Profile `outputMode=json`，还会要求只返回 JSON、不包 Markdown；`text` 模式则把最终文本包装为 `{ content }`。

当前 output schema 直接拼入 Prompt；ACP/CLI 层没有独立 provider-native structured output API。模型返回后先进行 JSON 解析，再由 Engine 的 Ajv Contract 校验兜底。

## 3. Flow Proposal

### 3.1 请求

`POST /api/flow-proposals` 接收：

- `objective`；
- `runtimeId`；
- `workspaceRoot`；
- multipart 时的 attachments。

目标和工作目录是必填。Runtime 必须是用户可选的非 builtin Profile。

### 3.2 有 Runtime 的生成路径

服务端向 Runtime 提供：

- 用户目标；
- 已发布 CF Catalog 的有界摘要；
- 可选附件文本内容；
- 结构化输出格式要求。

输出顶层：

```ts
{
  flowName: string
  summary: string
  stages: Stage[] // 1..6
}
```

Stage 当前支持：

- `cf-call`；
- 一个顶层 `branch`，每条 route 包含 1..6 个 `cf-call` stage。

普通 stage 可引用 Catalog 中真实 `cfId`，也可不引用并生成 candidate CFDraft。服务端负责：

- 限制字符串长度和 stage 数；
- 将 effect 收敛为 file-read/file-write/command；
- 生成稳定的 source node/edge ID；
- 限制只保留一个顶层 branch；
- 把 branch routes 降成显式 case edge；
- 自动补 output node；
- 保存 FlowDraft。

Runtime 不直接生成 FlowPlan、Plan index、hash 或 Runtime Profile version。

### 3.3 Catalog grounding

若输出引用 `cfId`，服务端只在当前已发布 Catalog 中查找。未命中时按新 candidate CFDraft 处理，不把未知 ID 当作已发布能力。

`unresolvedSuggestions` 当前用 `PROPOSED_CF:<id>` 表示仍需发布的 candidate CF。

### 3.4 附件路径

带附件时：

- 只允许 ACP Runtime；
- 文件内容会读取并放入 analysis input，最多 400,000 字符；
- Prompt 要求每个生成 stage 返回 `sourceQuote`；
- 归一化空白后，quote 必须是附件原文子串；
- branch route 内的 stage 同样校验；
- 任一 stage 无可靠引用时以 `RUNTIME_PROPOSAL_UNGROUNDED` 拒绝；
- 成功后附件归档到 Flow workspace。

这是一种引用存在性门禁，不证明语义解释绝对正确。

### 3.5 无 Runtime fallback

无附件且指定 Runtime 不可用时，服务端可对已发布 CF 的名称/职责做确定性词项匹配：

1. 将 objective 分词；
2. 对 CF name + does 计算共同词数量；
3. 选最多 5 个；
4. 生成顺序 Flow + output。

没有匹配时返回 `flowDraft: null` 与 `NO_PUBLISHED_CF_MATCH`。有附件时不使用此 fallback。

## 4. Flow Assistant

### 4.1 输入收敛

`POST /api/flow-agent/chat` 不把完整数据库或无限历史发给 Runtime。输入是：

- 用户当前消息；
- Flow id/name/revision/objective；
- node 的 id/kind/capability/executor/onError；
- 完整控制 edges；
- candidate CFDraft；
- 最近最多 24 条 Run event；
- Runtime ID/name 列表。

工作目录必须仍然可用。

### 4.2 输出

```ts
{
  message: string
  actions: AgentAction[] // max 3
}
```

允许 action：

| action           | 用途                         | 服务端/前端门禁                              |
| ---------------- | ---------------------------- | -------------------------------------------- |
| `select-node`    | 聚焦真实 node                | nodeId 必须可对应当前节点                    |
| `open-activity`  | 引导查看运行证据             | 只切换 Inspector tab                         |
| `retry-node`     | 为真实 cf-call 增加 2 次重试 | 前端转换为显式 Draft 修改                    |
| `update-node`    | 修改 executor 或 stop/retry  | executor 必须来自已提供 ID；maxAttempts 1..5 |
| `update-binding` | 建议精确 source/target 映射  | 仅作为可审阅配置动作，不直接改发布 Plan      |

Prompt 要求当用户明确要求“修复/应用/校准”且变更清晰时，优先给 update action，而不是只给定位动作。

### 4.3 确定性 fallback

Runtime 不存在、不健康或是内部 builtin 时，服务端生成本地建议：

- 无 Flow：提示先创建 Flow；
- 最近有失败：定位节点、提取 error、建议查看活动，cf-call 可建议 retry；
- 优化类问题：统计节点/边并建议检查数据交接与失败策略；
- 其他问题：返回当前 Flow 的通用审阅路径。

响应带 `fallback: true`，UI 显示“本地流程分析”。fallback 不伪装成模型回复。

### 4.4 应用权

Flow Assistant 从不直接保存 Draft。前端展示 action card，只有用户点击后才调用本地修改函数；修改增加 revision、触发自动保存，并使旧测试状态失效。

## 5. CF Agent Step

### 5.1 最小上下文

运行期 Runtime 只收到：

- 当前 CF step task；
- 当前节点 input context；
- 当前 CF 声明的 effects；
- 当前 Run 已解析 resources；
- 当前 output schema；
- workspaceRoot。

它不接收完整 FlowPlan 来选择下一个节点。

### 5.2 输入结构

节点输入默认是：

```json
{
  "flowInput": {},
  "upstream": [
    {
      "nodeId": "source-id",
      "nodeName": "source-name",
      "output": {}
    }
  ],
  "inputDefaults": {}
}
```

`inputDefaults` 仅在没有上游时出现。Prompt 明确要求模型只选择和转换 capability input guidance 描述的数据。

### 5.3 输出门禁

`outputMode=json` 的返回流程：

1. 去除可能的 markdown fence；
2. 直接 JSON.parse；
3. 若整段不是 JSON，尝试截取第一个 `{` 到最后一个 `}`；
4. 失败则 `RUNTIME_OUTPUT_NOT_JSON`；
5. Engine 用 node override 或 CF outputContract 做 Ajv 校验；
6. 通过后才写入 `node.completed` 并解锁下游。

这不是 provider-native schema guarantee，仍必须把模型输出视为不可信。

## 6. 权限与 Prompt Injection

Prompt 不是安全边界。当前防护由代码和 adapter 共同完成：

### 6.1 Effect

- CFDraft 只能声明 workspace 范围的 file-read/file-write/command；
- 无 effect 时 Prompt 明确禁止文件和命令操作；
- Codex ACP 根据 file-write 切换 read-only/workspace-write 初始模式；
- CLI 根据 effect 选择 manifest 中的 none/read/write/full 参数；
- ACP permission request 检查 tool kind、声明 effect 和目标路径是否在 workspace。

### 6.2 附件

- 外部文件作为 input data 传入，不成为系统指令；
- 路径穿越、隐藏目录、node_modules、.git 和非文本扩展名被过滤；
- attachment proposal 强制原文引用；
- analysis 的 file-read 必须提供具体位置且保持在 allowedRoot。

### 6.3 不可信事实

模型不能证明：

- Runtime 健康；
- CF/Flow 引用存在；
- Contract 通过；
- 审批已发生；
- 文件/命令效果已提交；
- Run 完成；
- hash 正确。

上述事实只来自健康检查、Compiler、adapter、Engine 和 Ledger。

## 7. 错误与降级

当前错误没有统一 `LLMComponentError` envelope，而是字符串 code + Error message。前端 `readableError` 对常见 code 映射中文文案。

主要错误：

- `RUNTIME_UNAVAILABLE`
- `RUNTIME_ANALYSIS_REQUIRED`
- `RUNTIME_AGENT_RESPONSE_INVALID`
- `RUNTIME_PROPOSAL_UNGROUNDED`
- `RUNTIME_OUTPUT_NOT_JSON`
- `RUNTIME_OUTPUT_LIMIT_EXCEEDED`
- `ACP_STOP_*`
- `PERMISSION_DENIED`
- `RUNTIME_TIMEOUT`
- `RUN_CANCELLED`

降级规则：

- 无附件 Proposal：可走本地 Catalog 匹配；
- 有附件 Proposal：无 ACP 时失败，不做不可靠 fallback；
- Flow Assistant：可走确定性本地建议；
- CF Agent Step：没有语义 fallback，失败由 CF/Flow retry 或 Run failure 处理。

## 8. 可观测性现状

当前持久化的是 Run/Ledger 事实和 Runtime health 结果。尚未持久化：

- promptVersion/promptHash；
- input/output token；
- cost；
- provider request id；
- prompt route 指标；
- schema first-pass rate；
- golden/shadow/canary 结果。

ACP Profile 的 tokenAccounting trait 只是能力描述，不代表当前产品已记录 token 使用。

## 9. 当前测试覆盖

测试已覆盖：

- Runtime proposal 多阶段保留；
- skill 附件必须使用 ACP；
- Runtime 收到实际附件文本；
- 未引用原文的附件提案被拦截；
- Flow test 可使用未发布 candidate CFDraft；
- Runtime 不可用时 Flow Assistant fallback；
- fallback 能根据失败 Run 给出可审阅动作；
- CLI/ACP Runtime 的发现、健康检查和有界执行；
- 非 JSON/Contract/权限相关失败不解锁下游。

尚无独立 Prompt golden set、注入对抗集、质量评分或 provider mock matrix。

## 10. Prompt 变更规则

在没有 Prompt Registry 前，修改 Prompt 必须遵守：

1. 同时检查 inline output schema 和 response normalizer；
2. 保持 Proposal/Assistant 的长度和数量上限；
3. 不允许模型生成 Plan index、hash、approval 或真实权限；
4. 增加新 action 时先更新共享类型、schema、normalizer、前端应用逻辑和测试；
5. 增加新 effect 时先更新类型、Compiler、Runtime permission mapping 和测试；
6. 附件引用门禁不得仅靠 Prompt；
7. Prompt 失败必须有显式错误或确定性 fallback，不能静默换 Agent。

## 11. 后续演进

合理的近期演进：

- 抽取 Prompt bundle，给 Prompt 与 schema 明确版本；
- 用 provider-native structured output（可用时）替代纯文本 schema 指令；
- 增加 fixture/golden 测试和 injection 回归；
- 持久化 route、latency、tokens、schema pass 等最小 telemetry；
- 将 flow assistant action validator 从宽松 normalizer 收紧为完整 source ID 校验；
- 对 Prompt 输入做更系统的长度、敏感信息和日志策略。

CF Compiler、Flow Compiler、调度、权限和 Ledger 继续保持确定性，不因 Prompt 基础设施演进而交给模型。
