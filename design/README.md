# Design Documents

本目录是 CF Platform 设计文档的唯一维护位置。

| 文档 | 负责回答的问题 |
|------|----------------|
| [`CF-design.md`](./CF-design.md) | 高层 Agent Loop 如何被人为设计、编译和机械执行？ |
| [`product-design.md`](./product-design.md) | 用户如何编写 CF、维护 Flow、发布版本并运行？ |
| [`frontend-design.md`](./frontend-design.md) | 前端信息架构、页面、交互、视觉系统、响应式与验收标准 |
| [`llm-prompt-design.md`](./llm-prompt-design.md) | LLM 参与组件的 Prompt、Schema、安全边界、评测与版本策略 |
| [`tech-selection.md`](./tech-selection.md) | 面向个人本机版的技术选型、持久化、执行隔离与升级路径 |

四份文档遵循同一个核心边界：

- **产品源对象**：CFDraft、FlowDraft。
- **函数编译产物**：CFProgram，随 CFVersion 冻结。
- **流程编译产物**：FlowPlan DAG，随 FlowVersion 冻结。
- **运行时分层**：Flow Engine → CF Runtime → AgentExecutor/Script/Service。
- **运行记录**：Flow Run + CF Call/Step Audit。
- **外部资源**：按 Flow 需要绑定，不建立 Project 中心模型。

当产品设计与运行时设计发生冲突时，先用“人为设计高层 Loop、agent 执行节点内 Loop”判断是否偏离核心理念，再同时修订两份文档，避免产品对象与 DSL 各自演化。
