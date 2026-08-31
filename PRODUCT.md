# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop web

## Users

主要用户是在本机设计、验证和运行 Agent 工作流的专业用户。他们希望先用自然语言表达目标，再通过可视化 DAG 校准步骤，而不是直接维护 JSON DSL。

## Product Purpose

CFlow 是以 Flow 为一级工作上下文的本机 Agent 编排工作台。用户选择工作目录和可用 Runtime，生成可审阅的 Flow/CF 草稿，在画布中编辑能力、分支、汇合、审批、输出和连线，经确定性检查与测试后发布不可变 Flow Version，之后运行该版本并查看 Ledger 证据。

核心闭环：

```text
选择工作目录 → 描述目标/附加 skill 文本 → 生成草稿
→ 画布编辑 → 检查 DSL → 测试 → 发布 → 运行 → 查看活动/询问流程助手
```

## Positioning

- Flow 是高层、可审阅、可版本化的 DAG；CF 是可复用能力函数。
- Agent 负责提出候选结构和执行单个 CF step，人负责接受、编辑、测试和发布。
- 运行已发布 Flow 时不重新规划图。
- Project 不是一级产品对象；每个 Flow 固定一个本机工作目录，资源通过 Resource Profile 绑定。

## Operating Context

- 只支持桌面浏览器，视口最小宽度 1120px。
- 三栏工作台：Flow 导航、中央目标/画布/DSL 检查、右侧详情/活动/AI 助手。
- 左右栏可收起为 50px 桌面窄轨，不转换为移动端抽屉。
- 设置以覆盖层打开，管理默认 Agent、测试超时和高级资源绑定。
- 中文为主要界面语言；Runtime、CF/Flow ID、版本和 hash 保留技术原名。

## Current Capabilities

- Flow/CF 草稿自动保存、选择和删除；已发布 Flow Version 可删除。
- Codex、Claude Code 内置 manifest；发现 PATH ACP、npm、用户和项目 manifest。
- 自然语言 Flow 提案；上传 skill 文本文件/目录后进行只读、有引用依据的分析。
- XYFlow 画布编辑 CF、branch、join、approval、output 和控制连线。
- 独立 DSL 检查视图，展示 FlowPlan、CFProgram 和编译错误。
- 测试使用临时编译快照，不先发布 CF/Flow。
- 测试通过后才能发布；发布固定 Runtime Profile 版本。
- 运行、取消、审批、失败重试、Run 活动和节点状态。
- Flow 助手基于当前草稿与最近运行给出最多三个可审阅动作；Runtime 不可用时使用确定性本地建议。

## Constraints

- 当前是本机单用户 Web 应用，不提供认证、多租户或团队治理。
- 工作目录首次绑定后不可更改；路径失效时停止 Agent、测试、发布和运行。
- Process/ACP Runtime 不等于通用沙箱；UI 不能宣称已强制网络隔离。
- Agent 输出不是权限、审批、图合法性或运行成功的权威。
- 当前前端轮询 Run 状态；SSE API 尚未接入 UI。

## Product Principles

1. Flow 始终是工作上下文。
2. 自然语言先产生候选结构，所有变更都可审阅。
3. 业务状态、下一步动作和失败原因优先于原始 JSON。
4. 检查、测试、发布、运行是不同阶段，不互相偷渡。
5. 发布版本和 Run 事实可追溯；发生未知副作用时停止并要求人工核对。

## Accessibility

必须提供清晰键盘焦点、文本状态标签、可访问名称和 reduced-motion 支持。状态不得只依赖颜色。产品不承担移动端或触控端适配。
