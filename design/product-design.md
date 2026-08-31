# CFlow 产品设计 v1.0

> 状态：当前实现基线，更新于 2026-08-31。
> 本文只把代码中可操作的能力写成当前产品；后续设想集中在末章。

## 1. 产品定义

CFlow 是本机桌面浏览器中的 Agent Flow 工作台。用户用自然语言和可选 skill 文本生成流程草稿，再通过可视化 DAG 编辑、确定性编译检查和真实试跑完成发布；发布后只执行冻结的 Flow Version。

```text
工作目录
  → 目标 / skill 附件
  → Flow Proposal + candidate CFDraft
  → FlowDraft 画布编辑
  → 编译快照
  → 测试 Run
  → 发布 CFVersion + FlowVersion
  → 正式 Run + Ledger
```

产品的核心价值不是“让 Agent 自己长期规划”，而是把 Agent 建议变成用户能审阅、测试、版本化和重复执行的结构。

## 2. 产品边界

### 2.1 当前范围

- 本机单用户；
- 桌面浏览器；
- Flow 为一级工作上下文；
- 每个 Flow 固定一个本机工作目录；
- Codex、Claude Code 或 manifest Agent 作为可切换 Runtime；
- 草稿、编译快照、版本、运行和 Ledger 持久化到 SQLite；
- 中文优先的三栏可视化工作台。

### 2.2 非当前范围

- 移动端、触控端和窄屏响应式；
- Project/Repository 作为一级导航对象；
- 团队空间、权限角色、多租户和审批策略中心；
- 云端定时器、Webhook trigger 或跨机器执行；
- 通用资源 Connector 和凭据管理；
- Flow 运行时动态改写 DAG；
- 独立 CF 管理后台或全量治理控制台。

## 3. 用户与心智模型

### 3.1 主要用户

需要在本机代码或资料工作区内组织 Agent 任务的专业用户。用户理解“步骤、分支、审批、运行”，但不应被要求直接编写 FlowPlan index 或 CFProgram JSON。

### 3.2 用户心智

- **Flow**：我要重复完成的一整件事。
- **能力/CF**：Flow 中一个可复用步骤。
- **草稿**：仍可修改的源对象。
- **检查 DSL**：把草稿编译成可执行结构，但不运行。
- **测试**：对当前草稿做一次真实临时运行。
- **发布**：冻结版本，之后可以重复运行。
- **活动**：Run 与节点实际发生的事件。
- **流程助手**：读取当前 Flow 和运行证据后提出建议，不能静默改动。

## 4. 产品对象

### 4.1 FlowDraft

FlowDraft 保存名称、目标、工作目录、节点、控制边、资源需求和运行 limits。它是中央画布与右侧详情共同编辑的对象。

当前草稿行为：

- 每次编辑增加 revision；
- 前端 900ms 防抖后自动保存到服务端；
- 浏览器 localStorage 同时保存当前工作现场、节点位置、对话和所选 Run；
- 重新选择已发布版本时，会转换成 revision + 1 的新草稿视图；
- 草稿可删除。

XYFlow 节点坐标只存于 localStorage 工作现场，不属于 FlowDraft/FlowPlan，也不进入发布 hash。

### 4.2 CFDraft 与 CFVersion

目标提案可以引用现有 CFVersion，也可以生成 candidate CFDraft。candidate CF 与当前 Flow 一起编辑和测试；正式发布 Flow 前，前端先发布这些 CFDraft，并把 Flow 引用改成返回的精确版本。

CFDraft 当前可编辑字段：

- 名称与职责；
- input/output/process 自然语言；
- JSON input/output contract；
- effect 声明；
- 默认 executor。

当前没有独立 CF 列表页面；能力库位于 Flow 画布内。

### 4.3 FlowCompilationSnapshot

编译快照保存：

- 输入 FlowDraft；
- 编译后的 FlowPlan；
- 用到的 CFVersion/CFProgram；
- preview 或 test 模式；
- test 时关联 runId。

它用于刷新后恢复最近的 DSL 检查结果，不代表已经发布。

### 4.4 FlowVersion

FlowVersion 当前以 `flowId@<revision>.0.0` 存储，包含：

- 固定 node index 与 edge index；
- 精确 CFVersion 和 programHash；
- 精确 Runtime Profile version；
- workspaceRoot；
- ResourceRequirement；
- limits 与 planHash。

发布版本可在左栏选择和删除。当前没有依赖分析或“被其他 Flow 使用”检查；删除操作由确认对话保护。

### 4.5 Run

Run 保存 flow version id、状态、输入、结果、资源快照和时间。状态至少包括：

- `queued`
- `running`
- `waiting-approval`
- `completed`
- `failed`
- `cancelled`
- `needs-reconciliation`

Run 详情由 Run 行与按 seq 排序的 Ledger event 组成。当前没有独立成本、token、Trace 或下载 Receipt 产品对象。

### 4.6 Runtime Profile

Runtime Profile 是不可变版本。设置或 manifest/adapter 发生变化会生成新的 profileVersion；当前 Flow test/publish 固定精确版本。

UI 展示：

- Agent 名称；
- 发现来源；
- Profile 版本；
- available/unavailable/disabled/checking；
- ACP protocol-ready 或 CLI adapter-ready 事实；
- 认证待实际调用验证。

### 4.7 Resource Profile

服务端支持 Resource Profile CRUD、默认 Profile 和 Run 解析，但当前 SettingsView 没有资源 Profile 编辑 UI。它是 API 能力，不应在用户旅程中写成已完成的可视化流程。

## 5. 信息架构

产品只有一个全屏工作台：

```text
左栏 Flow Register
  ├─ 草稿
  ├─ 已发布
  ├─ 搜索 / 新建 / 删除
  └─ 刷新 / 设置

中央 Workspace
  ├─ 目标
  ├─ 画布
  └─ 检查 DSL

右栏 Inspector
  ├─ 详情
  ├─ 活动
  └─ AI 助手

Settings Overlay
  ├─ 默认助手
  ├─ 测试超时
  └─ Runtime 发现与连接测试
```

没有独立 Flows、CF Library、Runs、Resources、Governance 顶级路由。早期文档中的多页面 IA 已被当前单工作台设计取代。

## 6. 核心旅程

### 6.1 新建 Flow

1. 用户点“新建流程”。
2. 目录选择器从 home 目录开始，只显示可进入目录，也允许输入绝对路径。
3. 服务端验证 realpath、目录类型和读写权限。
4. 用户确认后进入目标输入。
5. 工作目录在 Flow 创建后锁定。

目录不是全局设置，也不是 Project 对象。

### 6.2 从目标生成草稿

输入包含：

- 目标文本；
- 一个 available Runtime；
- 可选文件/文件夹附件。

无附件时：

- 可用非 builtin Runtime 生成结构化 stages；
- Runtime 不可用时，可从已发布 CF Catalog 做确定性关键词匹配；
- 没有匹配能力时返回 `flowDraft: null` 和 unresolved reason。

有附件时：

- 只接受受支持文本扩展名；
- 必须使用可用 ACP Runtime；
- Runtime 收到实际文本内容，而不只是文件名；
- 每个生成阶段必须引用附件原文；
- 成功后附件归档到 Flow 工作区的 `.cflow` 目录。

提案可以生成顺序阶段，或一个带多个 route 的 branch；当前只接受一个顶层 branch。

### 6.3 编辑画布

工具栏可添加：

- 能力；
- 审批；
- 分支；
- 汇合；
- 输出。

能力库可加入已发布 CF 或当前 candidate CFDraft。用户从节点端口拖出控制连接；可选择节点/边，在右栏修改或删除。画布支持拖动节点、缩放、fit view、minimap 和 controls。

当前数据交接默认是完整上游输出，不要求在画布上维护 field-level Binding。右侧/AI 助手仍使用“数据交接”语言帮助用户检查 input/output 指导。

### 6.4 检查 DSL

“检查 DSL”选择一个 available Runtime，点击后：

- 编译 candidate CFDraft；
- 编译 FlowDraft；
- 固定 Runtime Profile；
- 保存 preview snapshot；
- 展示步骤摘要、FlowPlan、planHash、CFProgram 和 programHash；
- 不运行、不发布。

编译失败时保留可读错误，不生成成功快照。

### 6.5 测试

测试按钮对当前草稿执行真实 Run。测试开始后：

- 顶部显示可停止操作；
- 右侧活动和画布节点状态持续更新；
- 测试中的 approval 当前自动 approved；
- completed 进入 passed；
- failed/cancelled 切换到相应状态并打开 AI 助手。

任何草稿修改都会使之前的测试结果失效，发布重新禁用。

### 6.6 发布

只有当前 UI 状态为 passed 时，发布按钮可用。用户确认后：

1. candidate CFDraft 发布为 CFVersion；
2. FlowDraft 更新精确引用；
3. Server 固定健康 Runtime 的 Profile version；
4. 保存 FlowVersion；
5. 工作台显示 published。

需要注意：服务端发布 API 当前没有独立核验 passing test；自动化或其他 API 调用方必须自行遵守该门禁。

### 6.7 运行已发布版本

用户从当前已发布 Plan 启动正式 Run。若能力声明 file-write，UI 在启动前再次确认工作区文件修改。

运行中可：

- 停止；
- 对 waiting approval 做批准/拒绝；
- 在活动查看最近 Run、事件与最终结果；
- 在画布查看节点状态；
- 失败后询问流程助手。

正式运行只使用已发布版本，不执行当前未发布草稿。

### 6.8 流程助手

助手上下文包括：

- 当前 Flow 摘要；
- candidate CFDraft；
- 最近最多 24 条 Run event；
- 可用 Runtime ID。

输出是简短中文说明和最多三个 action：

- retry-node；
- select-node；
- open-activity；
- update-node；
- update-binding。

所有 action 都需要用户点击应用。Runtime 不健康时返回确定性本地诊断，并显式标记 fallback。

## 7. 状态门禁

| 状态             | 检查       | 测试         | 发布      | 运行已发布版本 | Flow 助手    |
| ---------------- | ---------- | ------------ | --------- | -------------- | ------------ |
| 无 Flow          | 否         | 否           | 否        | 否             | 无上下文建议 |
| 有草稿、目录可用 | 是         | 是           | 仅 passed | 若已有 Plan    | 是           |
| 有草稿、目录失效 | 否         | 否           | 否        | 否             | 否           |
| test running     | 只显示停止 | 停止         | 否        | 否             | 可查看上下文 |
| test passed      | 是         | 可重测       | 是        | 若已有 Plan    | 是           |
| live running     | 是         | 否           | 否        | 停止           | 是           |
| waiting approval | 是         | 测试自动批准 | 否        | 批准/拒绝      | 是           |

## 8. 数据与删除语义

- 删除草稿只移除 `flow_drafts` 对应项，不自动删除已发布版本或历史 Run。
- 删除单个已发布 FlowVersion 只移除该 Plan，不清理关联 CFVersion、Run 或附件。
- 删除 Resource Profile 时，如果它是默认项，设置中的默认引用会被清空。
- 附件归档与 Flow 数据库对象没有级联删除实现；产品不得承诺删除 Flow 会清理工作区 `.cflow` 文件。

## 9. 安全与信任表达

- 工作目录明确显示为每条 Flow 的不可变范围。
- Agent effect 只有在 CFDraft 声明后才传入 Runtime。
- file-write 正式运行前有人机确认。
- unavailable Runtime 不可选择，且不会静默切换。
- 认证状态 unknown 就显示 unknown，不假装已验证。
- Runtime traits 区分 sandboxed、cwd-scoped、host-permissions 与 network enforcement。
- “测试通过”只表示这次 Run 完成并满足当前 contract，不代表外部业务结果绝对正确。

## 10. 当前产品指标

当前仓库没有埋点系统。可从 SQLite/API 推导的基础指标包括：

- Flow 草稿数、发布版本数；
- preview/test compilation 数；
- Run completed/failed/cancelled/needs-reconciliation 比例；
- 平均 Run 时长；
- approval 等待次数；
- Runtime 可用性与连接测试延迟。

token、cost、用户漏斗、留存和 Prompt 质量评分尚未实现。

## 11. 后续演进

优先级应围绕现有闭环补强：

1. 服务端强制“匹配 revision 的 passing test 才可发布”；
2. UI 接入 SSE，减少 Run 轮询；
3. Resource Profile 可视化编辑与真实 Connector；
4. test Plan/Catalog 的重启恢复；
5. 更明确的数据映射模型，替代 deprecated binding 兼容层；
6. Run 分页、筛选和 reconciliation 操作；
7. 删除与附件归档的生命周期策略。

团队、多租户、云端触发器、Flow-as-CF 和治理中心应在上述闭环稳定后再进入设计。
