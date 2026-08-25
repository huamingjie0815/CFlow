# CF Platform

CF Platform 是一个以 **Flow** 为核心维护对象的多 agent 异构编排平台。

用户既可以直接组装 Flow，也可以先描述目标，由系统结合 CF 能力库生成初始化 Flow 提案，再由用户编辑、编译、测试和发布。

产品采用两级自然语言编程模型：

```text
CFDraft（自然语言函数源）
  → cf-compiler → CFProgram
  → 测试并发布 CFVersion

FlowDraft（组合已发布 CFVersion）
  → flow-compiler → FlowPlan DAG
  → 测试并发布 FlowVersion
  → Flow Engine 调度 CF Runtime
  → CF Runtime 执行 CFProgram
  → AgentStep 才调用异构 AgentExecutor
```

设计文档统一维护在 [`design/`](./design/)：

- [`design/CF-design.md`](./design/CF-design.md)：核心架构、DSL、编译器、执行器与运行时不变量。
- [`design/product-design.md`](./design/product-design.md)：以 Flow 为中心的产品对象、用户流程、信息架构与版本模型。
- [`design/frontend-design.md`](./design/frontend-design.md)：前端信息架构、页面、交互、视觉系统、响应式与验收标准。
- [`design/llm-prompt-design.md`](./design/llm-prompt-design.md)：LLM 参与组件的 Prompt、Schema、安全边界、评测与版本策略。
- [`design/tech-selection.md`](./design/tech-selection.md)：个人本机版技术选型、持久化、执行隔离与升级路径。

产品不以 Project 为一级组织对象。代码仓库、文件集、邮箱、数据库等属于 Flow 运行时可绑定的资源；它们服务于 Flow，不反向定义产品的信息架构。

## 本机运行

```bash
npm install
npm run build
npm start
```

打开 `http://127.0.0.1:3000`，即可编辑并发布 CF/Flow、运行版本和查看 Run Ledger。默认数据库写入 `data/cf.sqlite`，可用 `CF_DB=/path/to/file.sqlite` 指定其他位置；开发模式使用 `npm run dev`。

服务默认只监听 `127.0.0.1`，因为 Runtime 设置可以启动本机受控进程。只有在已经配置外部认证与网络访问控制时，才应通过显式 `HOST` 改为其他监听地址。

自动化验证：

```bash
npm test
```

已实现的本机闭环包括：自然语言 CF 草案的确定性可运行编译、CF/Flow 版本与 hash 校验、DAG 分支/共享汇合、契约门禁、重试/取消、持久化 Job Lease、Run Ledger、SSE 事件、审批暂停/恢复、资源 Profile、目标到 Flow 草案提议以及浏览器工作台。

## Runtime 与设置

工作台左上角的设置入口现在提供可持久化的 Runtime Registry、工作区默认值和 Resource Profiles：

- 自动探测本机 Codex 与 Claude Code CLI；不可用状态会明确展示，不会静默回退。
- Codex/Claude Code/Custom Process Runtime 通过无 shell 的受控子进程执行；支持工作目录、参数、超时、输出上限、环境变量名称白名单和取消。
- Runtime 配置每次保存都会生成不可变 Profile 版本；发布 Flow 时会 pin 精确 Profile 版本，Run Ledger 记录实际执行版本。
- 设置页可查看完整 Profile 历史，并配置健康探测参数、执行参数、模型、工作目录、超时、输出协议/上限、环境变量名称白名单和能力标签。
- 外部 Runtime 必须返回符合 CF output contract 的 JSON（或显式使用 text 包装模式），否则 Flow fail closed。
- 设置中可保存默认 Runtime、默认 Resource Profile、本地工作目录、测试超时与服务端草稿自动保存策略。
- Flow/CF 草稿会保存到 SQLite；Resource Profile 可在设置中创建、编辑与删除。

安全边界按事实展示：Process Runtime 只承诺独立子进程、工作区根目录内的限定 cwd、清理环境、超时/取消与参数化启动；除非具体 adapter 明确提供，否则不声称网络隔离或主机级文件系统沙箱。当前 Process Adapter 收集最终输出，不把底层 CLI 的流式片段、tool events 或 token usage 伪装成产品已暴露能力。密钥值不写入产品数据库，只按配置的变量名从服务端环境继承。

Flow 编辑器支持顺序重排、CF/审批/条件分支/汇合节点、独立控制连接和自然语言化的“来源 → 目标” Binding 编辑。测试前会展示实际线路、Runtime 与资源摘要；测试通过后，发布前再次展示将被冻结的节点、连接、Binding、审批、资源与 Runtime Profile。
