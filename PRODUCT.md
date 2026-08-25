# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是需要设计、验证和维护智能任务流程的专业用户。他们在桌面浏览器中工作，希望用自然语言描述目标，再通过可视化编排校准由 agent 生成的流程，而不必直接维护底层 DSL 或 JSON。

高级维护者还需要检查 CF 契约、执行器、资源与副作用声明、编译结果和不可变版本，但这些技术信息应按需展开，不能压过主要工作流。

## Product Purpose

CF Platform 是一个以 Flow 为第一等对象的通用 agent 工作台。用户选择底层 agent runtime（例如 Claude Code、Codex），通过对话设定初始目标；agent 根据目标和当前框架生成可审阅的 CF 能力节点及 Flow 草案。用户随后在可视化画布中调整节点、连接与顺序，测试流程，并在验证通过后发布不可变版本。

成功意味着用户能在同一个工作台内顺畅完成“定义目标 → 生成草案 → 人工编排 → 测试 → 发布”，并始终清楚当前编辑对象、运行状态和下一步动作。

## Positioning

产品不直接调用或维护 LLM 会话层，而是把 Claude Code、Codex 等现有 agent 作为可切换的运行时，让它们在受约束的 CF/Flow 两级框架内生成、执行和校准可版本化的能力流程。目标生成只产生可审阅草案，不在运行时动态改写已发布流程。

## Operating Context

- Flow 是创建、选择、维护、测试、发布与版本管理的主维度。
- 工作台采用三栏结构：左侧 Flow 导航，中间对话与可视化编排，右侧上下文功能面板。
- Flow 初始态是通用 agent 对话，允许选择运行时并输入目标。
- 生成结果转为可拖拽的 Flow 画布；用户可添加、编辑、删除 CF 节点并重建连接和顺序。
- 右侧根据当前选中对象承载 CF 详情、Flow 设置、测试信息和版本管理。
- 测试通过后才能进入发布流程；发布生成不可变 Flow Version。

## Capabilities and Constraints

- 保持 CF/Flow 两级架构：CF 是可复用能力节点，Flow 是人工可审阅的高层 DAG。
- 用户编辑 CFDraft 与 FlowDraft；CFProgram 和 FlowPlan 是只读编译产物。
- 不把 Project 设为一级产品对象；Repository、Mailbox 等属于运行时 Resource。
- 现有服务端 API、编译、运行、审批、取消和事件流能力应继续可用。
- 当前交付为 Web，不开发原生桌面应用。
- 界面中文优先；底层 agent、版本号、hash 等技术标识保留其原名。
- Runtime 切换必须路由到服务端 Registry 中健康且启用的精确 Profile；发布 Flow pin Profile 版本。Process Adapter 不得夸大其文件系统或网络隔离能力。

## Evidence on Hand

- 产品与架构定义位于 `design/`。
- 当前可运行前端位于 `public/index.html`。
- 服务端已经提供 CF 发布、Flow 提案与发布、Flow Run、资源绑定、审批、取消和事件流接口。
- 当前仓库提供版本化 Runtime Profile、CLI 健康探测、Process Adapter、Flow/CF 草稿持久化及工作区设置 API。Codex 可用性取决于本机 CLI 与登录状态；Claude Code 或自定义 Runtime 未安装/未配置时必须明确显示不可用。

## Product Principles

1. Flow 始终是工作上下文，用户不会在操作中丢失当前 Flow。
2. 先用自然语言定义目标，再让结构化流程逐步显现。
3. agent 负责提出方案，人负责接受、编排与发布。
4. 业务状态和下一步动作优先于 JSON、日志与编译细节。
5. 测试与发布是明确分离的门禁，版本结果可追溯且不可变。

## Accessibility & Inclusion

界面需支持键盘操作、清晰焦点、文本状态提示、减少动态效果偏好和窄屏降级；状态不能只依赖颜色表达。
