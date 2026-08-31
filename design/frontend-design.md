# CFlow 桌面工作台 UI/UX 设计 v2.0

> 状态：当前 React 实现基线，更新于 2026-08-31。
> 适用范围：桌面浏览器。移动端、触控端和窄屏响应式不在产品范围。

## 1. 体验结论

CFlow 的界面不是通用聊天页，也不是节点管理后台，而是一张“联锁信号台”式的 Flow 操作桌：

- 左侧深墨绿色 Flow register 保持工作上下文；
- 中央矿物纸色工作面在目标、画布、DSL 检查之间切换；
- 右侧白色 Inspector 承载局部编辑、运行证据和 AI 建议；
- 橙色表示注意/进行，绿色表示通过/可发布，红色表示失败，琥珀色表示等待。

所有关键动作都围绕同一条生命周期：

```text
工作目录 → 目标 → 草稿 → 检查 → 测试 → 发布 → 运行
```

## 2. 桌面范围

### 2.1 固定桌面画布

- `body` 与 `.app-shell` 最小宽度为 1120px；
- 应用占满视口，body 不滚动；
- 不提供 mobile breakpoint；
- 不把侧栏变成抽屉或底部导航；
- 较窄桌面环境通过浏览器横向空间和左右栏收起解决。

当前唯一 media query 是 `prefers-reduced-motion`。

### 2.2 三栏尺寸

| 区域            |                 展开 |   收起 |
| --------------- | -------------------: | -----: |
| 左 Flow Sidebar |                252px |   50px |
| 中央 Workspace  | `minmax(620px, 1fr)` | 不收起 |
| 右 Inspector    |                336px |   50px |

左、右收起是桌面窄轨：保留展开按钮、品牌/“详情”标识和关键入口，不是覆盖式 drawer。

## 3. 信息架构

```text
App Shell
├─ Flow Sidebar
│  ├─ Brand
│  ├─ New Flow
│  ├─ Search
│  ├─ Draft list
│  ├─ Published list
│  └─ Service / Refresh / Settings
├─ Workspace
│  ├─ Header
│  │  ├─ Current Flow status
│  │  ├─ Goal / Canvas / DSL tabs
│  │  └─ Test / Run / Publish / Inspector toggle
│  ├─ Notices
│  └─ Active view
│     ├─ Directory picker / Goal conversation
│     ├─ Capability library + Flow canvas
│     └─ Compiler preview
├─ Inspector
│  ├─ Details
│  ├─ Activity
│  └─ AI assistant
└─ Settings overlay
```

早期设计中的 Flows、CF Library、Runs、Resources、Governance 多页面导航不再适用。当前产品是单工作台，能力库、Run 和设置按上下文出现。

## 4. 启动与空状态

### 4.1 启动

bootstrap 聚合加载 CF、Flow、Run、Resource、Runtime、Settings 与 Draft。加载时显示居中的 CF 标记、spinner 和“正在连接本地工作台”；失败时提供错误与重试。

### 4.2 新 Flow 的第一步

新工作台不直接显示聊天输入，先显示 DirectoryPicker：

- 标题解释目录用途和不可变性；
- 允许输入绝对路径跳转；
- 提供面包屑、上一级和子目录列表；
- 明确展示最终路径；
- 服务端验证成功后才进入目标输入。

目录选择是流程创建的一部分，不能塞进全局设置。

## 5. Flow Sidebar

### 5.1 展开态

- 64px 品牌头；
- 橙色“新建流程”主按钮；
- 本地过滤搜索；
- “草稿”和“已发布”两个分组及数量；
- item 显示状态灯、名称、revision/version 和步骤数；
- 当前 Flow 使用更亮的墨绿色表面与橙色左轨；
- 删除按钮只在 item 内承担单个对象删除；
- footer 显示本地服务状态、刷新和设置。

### 5.2 收起态

50px 窄轨保留：

- CF 品牌标记；
- 展开；
- 新建；
- 设置。

不保留文字列表，不弹临时导航抽屉。

## 6. Workspace Header

Header 始终显示当前上下文：

- Flow 名称；
- revision、步骤数、test state；
- Goal / Canvas / 检查 DSL tabs；
- 自动保存状态；
- 测试或停止测试；
- 运行已发布版本或停止运行；
- 发布；
- 收起/展开 Inspector。

### 6.1 动作门禁

- 无草稿：画布、检查、测试、发布禁用；
- 工作目录失效：测试、运行、发布、Agent 禁用；
- 任一 Run active：互斥的新 test/live run 禁用；
- 当前 test passed：发布启用；
- active run：对应按钮替换为“停止测试/停止运行”；
- 发布前弹不可变确认；
- file-write 的正式运行前弹工作区修改确认。

按钮不可只用颜色表达状态，必须有文字、icon 或 aria-label。

## 7. Goal View

### 7.1 对话布局

目标输入是一个窄阅读列：

- intro 最大宽度约 650px；
- message 流最大宽度 760px；
- 文本最大 62–70ch；
- 空状态使用 signal emblem、kicker、标题和一句解释；
- 生成中插入 assistant thinking message。

这不是长期聊天历史。消息用于解释提案生成过程和附件处理结果。

### 7.2 Goal Composer

Composer 包含：

- 自动换行 textarea；
- 文件与文件夹选择；
- 最多直接列出 4 个附件，其余显示数量；
- 清空和单项移除；
- Runtime selector 与健康灯；
- Enter 提交，Shift+Enter 换行；
- 橙色 send button。

必须同时满足目标非空、工作目录已选、当前未在生成，才能提交。

## 8. Canvas View

### 8.1 工具栏

工具栏提供：

- 能力库开关与数量；
- 新能力；
- 审批；
- 分支；
- 汇合；
- 输出；
- “从圆点拖出连线；选中后可改接，或按 Delete 删除”的操作提示。

### 8.2 能力库

能力库是画布上方可展开区域，分为已发布 CF 与当前 candidate CFDraft。点击条目把能力加入画布，不使用拖拽 library card 到 canvas 的交互。

### 8.3 XYFlow 画布

当前能力：

- node drag；
- handle-to-handle connection；
- edge selection；
- fit view；
- 60%–140% zoom；
- Controls；
- MiniMap；
- 背景网格；
- Delete 删除选中节点/边。

节点位置保存在浏览器工作现场，不写入 FlowDraft。连线和节点的语义编辑写入 Draft 并增加 revision。

### 8.4 节点视觉

节点是白色 inspection card，显示：

- kind；
- 名称/标识；
- 简短职责；
- 当前运行/校验状态；
- source/target handles。

选中用橙色描边；running/passed/failed/blocked 使用对应状态色并配文字。不能只靠小圆点表达含义。

### 8.5 Edge

Edge label 来自 outcome：

- 默认完成；
- 成功/失败；
- branch case；
- approved/rejected。

选中 edge 后在 Inspector 改接起点、终点和 outcome，或删除。

## 9. Compiler View

“检查 DSL”是独立中央视图，不是 Inspector 小面板。

未检查时显示当前节点/边数量和 CTA。检查成功后显示：

- Flow version；
- 节点、边、能力数量；
- 按顺序的步骤摘要；
- 可折叠技术细节；
- FlowPlan JSON + planHash；
- 每个 CFProgram JSON + programHash；
- 复制检查结果。

编译 Runtime selector 只允许 available Runtime。错误在视图内显示，同时触发顶部 operation notice。

## 10. Inspector

### 10.1 三个 tab

当前 tabs 是：

1. **详情**：编辑 Flow、node 或 edge；
2. **活动**：最近 Run、Ledger event 和最终输出；
3. **AI 助手**：基于 Flow/Run 的诊断与可应用 action。

没有独立 Versions tab。版本通过左侧已发布列表和 Compiler 技术细节呈现。

### 10.2 Details

没有选择对象时显示 Flow 说明。选择对象后：

- CF node：名称、职责、输入/输出、process、executor、retry/effect/contract 等；
- branch：case id、自然语言条件、增删 case；
- join：all/any 和 upstream failure 策略；
- approval：policyRef；
- output：outputId；
- edge：from、to、outcome、case id；
- 支持删除 node/edge。

高级 JSON 与治理事实按需展开，不占据首屏。

### 10.3 Activity

活动按当前 Flow 过滤 Run，默认突出最近 3 次。选择 Run 后展示：

- Run 状态；
- 时间和关联版本；
- 按时间排序的 Ledger；
- 节点与事件的人类可读说明；
- completed 时的输出。

当前前端轮询活动状态，不应出现“实时流式 token/tool event”文案。

### 10.4 AI Assistant

空状态给三个 starter：

- 优化当前流程；
- 解释最近错误；
- 检查数据交接。

回答可以附带 action card。用户点击后才应用；只提供定位动作时，可继续要求生成可应用修复。Runtime fallback 必须标为“本地流程分析”。

## 11. Settings Overlay

Settings 是覆盖在工作台内容上的 modal-like layer，Esc 或“返回工作台”关闭。当前只提供：

- 默认助手；
- 测试最长等待秒数；
- 重新发现 Runtime；
- manifest warning；
- 每个 Runtime 的来源、Profile version、健康和连接测试。

当前 UI 不编辑 command、args、cwd、env allowlist、permission args、traits 或 Resource Profile。尽管 API 支持部分高级对象，也不能在 UI 设计中写成已交付设置项。

## 12. 反馈系统

### 12.1 Operation Notice

顶部 notice 包含状态灯、标题、详情和关闭按钮，tone 为 info/success/error。用于：

- 自动保存失败；
- 生成/检查/测试/发布结果；
- Run 启动、完成、停止或失败；
- Runtime/删除操作结果。

### 12.2 工作目录失效

独立 alert 明确说明：

- 草稿仍能编辑和保存；
- Agent、测试、发布和运行暂停；
- 恢复原路径和读写权限后继续。

### 12.3 Approval

正式 Run waiting approval 时在 Header 下显示高可见提示与“批准继续/拒绝”。测试中的 approval 自动处理，不要求用户点提示。

## 13. 视觉令牌

根目录 [`../DESIGN.md`](../DESIGN.md) 是视觉令牌摘要。实现中的核心变量：

| Token   | 值        | 用途                     |
| ------- | --------- | ------------------------ |
| ink     | `#17201c` | 左侧 register、深色反馈  |
| paper   | `#f3efe3` | 中央工作面               |
| surface | `#fbfaf5` | Inspector、控件          |
| text    | `#202822` | 主文本                   |
| orange  | `#ce6f32` | 选择、进行、主要创建动作 |
| green   | `#2f7254` | 通过、健康、发布         |
| red     | `#a74636` | 失败、停止、删除         |
| amber   | `#a06a22` | 草稿、等待、审批         |
| blue    | `#315f78` | 普通能力标识             |

字体栈以 Aptos 和中日韩系统 sans-serif 为主；hash/ID 使用 SFMono/Consolas。焦点统一为 2px 橙色 outline + 2px offset。

## 14. 动效与无障碍

- grid column 收起/展开为 180ms；
- spinner 仅表达真实 pending；
- reduced-motion 把动画和 transition 缩短到近乎 0；
- interactive element 必须有 focus-visible；
- icon-only button 必须有 title 或 aria-label；
- tab 使用 `role=tab` / `aria-selected`；
- dialog 设置 `aria-modal` 与标题关联；
- 异步消息区域使用 `aria-live`；
- 状态色同时配文字、位置或 icon。

当前 Settings dialog 没有完整 focus trap/焦点恢复实现，因此文档不把它列为已完成验收项。

## 15. 验收清单

- 1120px 及以上桌面视口三栏无 body 滚动；
- 左右栏可以独立收起和恢复；
- 新 Flow 必须先选工作目录；
- 草稿编辑后显示保存中/失败，成功后状态消失；
- Goal、Canvas、Compiler 视图不会同时可见；
- Canvas node/edge 修改会增加 revision 并使 test 结果失效；
- test active 和 live run active 都能停止；
- passing test 才启用发布；
- waiting approval 在正式 Run 中可批准/拒绝；
- 工作目录失效时所有操作型入口禁用；
- Runtime unavailable 不能在目标/编译选择器中执行；
- Inspector tabs、详情编辑、活动和 AI action 可键盘访问；
- reduced-motion 下无持续装饰动画。

## 16. 后续但未实现

- UI 接入 SSE；
- Settings focus trap 和关闭后的焦点恢复；
- Resource Profile 编辑器；
- Run 分页、筛选和 reconciliation 操作；
- 大型 Flow 的布局持久化与自动排版；
- 明确的数据映射编辑器；
- 服务端发布门禁在 UI 中展示证据 ID。

这些演进必须继续遵守桌面工作台范围，不引入移动抽屉方案。
