# CFlow 设计文档

本目录描述当前仓库已经实现并由测试覆盖的设计。文档以 `src/`、`web/src/` 和测试为事实源；如果文档与代码冲突，以最新代码为准，并应在同一次变更中修正文档。

## 文档地图

| 文档                                                       | 当前职责                                       | 主要代码事实源                                      |
| ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| [`CF-design.md`](./CF-design.md)                           | CF/Flow 领域模型、编译器、执行引擎与运行不变量 | `src/types.ts`、`compiler.ts`、`engine.ts`、`db.ts` |
| [`product-design.md`](./product-design.md)                 | 当前产品范围、对象、用户闭环与状态门禁         | `web/src/App.tsx`、`src/server.ts`                  |
| [`frontend-design.md`](./frontend-design.md)               | 桌面工作台的信息架构、交互、视觉与验收         | `web/src/`、根目录 `DESIGN.md`                      |
| [`llm-prompt-design.md`](./llm-prompt-design.md)           | 当前 Runtime 提示词、结构化输出和安全边界      | `src/server.ts`、`src/runtime.ts`                   |
| [`tech-selection.md`](./tech-selection.md)                 | 已采用的技术、部署边界、持久化和升级条件       | `package.json`、`src/`、`web/`                      |
| [`../docs/agent-manifests.md`](../docs/agent-manifests.md) | 第三方 Agent manifest 格式和发现规则           | `src/runtime-manifest.ts`                           |

根目录 [`../PRODUCT.md`](../PRODUCT.md) 和 [`../DESIGN.md`](../DESIGN.md) 分别是产品摘要和视觉令牌摘要，不重复完整领域设计。

## 文档状态规则

- **当前实现**：代码中已存在，且至少有测试、类型或 UI 调用链可以验证。
- **已知限制**：当前实现的真实边界，不用理想化设计替代。
- **规划**：尚未实现，只能出现在显式的“后续演进”章节。
- 不再把 Project、团队治理、云端多租户、通用 Connector、Prompt Registry、OpenTelemetry、Drizzle、UUIDv7 等早期设想写成当前能力。

## 共同边界

- 用户维护 `CFDraft` 与 `FlowDraft`；`CFProgram` 与 `FlowPlan` 是确定性编译产物。
- Flow 是一级工作上下文，CF 是 Flow 引用的能力函数。
- Flow Engine 只调度已编译的 DAG；Agent 只执行当前 CF 的当前 Agent step。
- 发布 Flow 时固定 CF 版本、程序 hash、Runtime Profile 版本和工作目录。
- Run Ledger 是运行事实来源；Agent 文本不能改变图、审批、权限或运行状态。
- 产品仅面向桌面浏览器。左右栏可收起为桌面窄轨，不实现移动端、触控端或窄屏抽屉。
