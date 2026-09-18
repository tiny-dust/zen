# 内容区汇总页评审稿

> 状态：待用户确认，不是 ADR。范围仅覆盖内容区的视觉组织与内容格式目录；本稿不直接修改正式聊天实现。
> 评审入口：`http://localhost:10011/content-prototype.html?variant=B`

## 1. 当前现状诊断

Zen 当前已经具备一条可工作的内容流水线：共享层提供文本、推理、工具事件与旁路交互事件；`Response` 负责流式 Markdown；消息时间线按 reasoning / text / tool 分段；工具结果可展开，审批与提问固定在时间线顶部。原型页 A/B 方案用于先看组织方式，再决定是否改正式组件。

本目录共 46 类。`existing` 表示当前代码或已核实的渲染路径存在，不表示视觉验收完成；`partial` 表示有基础但边界、语义或展示仍不完整；`proposal` 表示当前没有足够的正式协议或组件。`all` 指当前已知合约与常见扩展的评审目录，不是任意工具业务内容的穷尽清单。

基础 Markdown 已核实可用：h1-h6、列表、段落引用、表格、粗体/斜体、链接；checklist 已解析出 3 个 checkbox；footnotes 已生成引用与定义。数学当前没有数学扩展，浏览器中仅按原字符显示；Mermaid 仅显示源码，未接入引擎。工具状态目前稳定展示 running / ok / error，denied 与 percent 仍是边界；附件元数据可出 chip，但空 url 不代表真实预览。diff 是 fence 高亮，不是可应用 patch；system 通知当前全红；独立音视频没有正式 part。

## 2. 五组目录

| 分组 | 条目 |
| --- | --- |
| 消息与正文 | 用户消息、正文文本、标题、强调、列表、清单、段落引用、链接、流式边界 |
| 结构化内容 | 表格、代码块、差异、数学公式、Mermaid 图、HTML、Markdown 告警与提示、脚注 |
| 富内容与边界 | Markdown 图片、附件、产物、媒体、边界 |
| 工具与过程 | 读取、目录浏览、搜索、终端、编辑、文件写入、网络、技能、MCP、旧版工具消息、工具状态、工具输出、并行子任务 |
| 交互与状态 | 运行中、推理、审批、提问、任务、来源与文件引用、通知、错误、生命周期终态、步骤号与 Token 用量、完成 |

目录标题特意区分“段落引用”和“来源与文件引用”：前者是 Markdown 文本结构，后者是 `reference_found` 与项目文件面板中的可追溯资料。

## 3. 推荐语义分层

**A 现状真实组件**：消息气泡与正文 `MessageBubble` / `Response`，推理 `Reasoning`，工具 `ToolCallRow` 与历史 `ToolCallCard`，审批 `ApprovalCard`，提问 `AskUserCard`，时间线 `ChatTimeline`，会话信息面板中的任务、产物、参考与项目文件。

**B 内容语义层**：把内容按“正文、思考、动作、结果、请求、状态、资料”分层。正文只承载可读答案；思考和工具过程弱化但保持时间顺序；审批/提问是需要用户动作的请求；错误和终态是状态反馈；来源和附件是可追溯资料，不与正文混成一层。

**C 阶段归组**：P0 先统一正文密度、代码/表格/清单边界、工具行和错误层级；P1 再补来源、用量、生命周期与附件预览的交互；P2 决定数学、Mermaid、媒体、subagent 等协议级能力。阶段只表达优先级，不代表本稿已获准实施。

## 4. 样式建议

沿用 `docs/design/UI_STYLE.md` 与 `apps/ui/src/styles.css` 的 token，禁止新增组件内硬编码颜色。正文基准 14px、行高 1.8；辅助信息 11–12px；h2 建议 18px，h3 建议 15–16px；代码和路径使用 `--font-mono`。内容区以裸 Markdown 为主，不给 assistant 叠加气泡；块间距优先用留白和发丝线，状态色只表达成功、错误、警告和危险。

建议保持 860px 内容列与现有 12px/16px 半径层级，表格与代码块内部可滚动；长路径截断但保留 title；焦点和按钮继续遵循现有无粗 ring 规则。提示、错误、审批等不同语义不可只靠颜色区分，应同时有图标、标题或 `role`。

## 5. 待确认决策

- **P0 视觉**：是否采用 B 方案的“正文 / 过程 / 结果”层级，并统一 Markdown 间距、代码块、表格、checklist 与 system 通知样式？
- **P1 交互**：是否把来源、文件引用、用量、生命周期原因、附件预览纳入可展开的内容摘要？
- **P2 协议**：是否新增数学、Mermaid、媒体、subagent、denied/progress 等正式协议或专用 part？
- **是否改正式代码**：用户确认方案和优先级前，不修改正式聊天组件；当前只保留本评审稿与隔离原型目录数据。

## 6. 源码映射与边界

共享事件和消息 part：`packages/shared/src/types/agent.ts`。正文入口与分段渲染：`apps/ui/src/components/MessageBubble.vue`、`apps/ui/src/components/ai-elements/response/Response.vue`、`apps/ui/src/components/ai-elements/response/extensions.ts`。时间线和流式跟随：`apps/ui/src/components/chat/ChatTimeline.vue`。工具映射与行式输出：`apps/ui/src/components/chat/tool-part.ts`、`apps/ui/src/components/chat/ToolCallRow.vue`。旁路状态聚合：`apps/ui/src/stores/chat.ts`。

原型页是隔离的评审面板，交互只写页面内存状态；不会保存设置、执行工具或修改正式聊天。涉及模型输出、文件路径、工具结果和附件时，仍须遵守现有路径沙箱、事件校验、XSS 清理和最小权限边界；原型不得绕过这些边界来“模拟真实成功”。

## 7. 验证记录

已知验证：`pnpm --filter @zen/ui typecheck` 已通过。Markdown、checklist、footnotes、数学、Mermaid、tool-states、media、attachments、diff、notice 等结论按本稿状态记录；其余浏览器验收由主 agent 继续完成，本稿不提前声称通过。