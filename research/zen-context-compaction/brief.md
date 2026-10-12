# Research brief — Zen 上下文自动压缩方案调研

- Today: 2026-10-12
- Depth mode: **deep**（每子代理最多 8 次搜索，最多 1 轮补充，目标 25+ 来源）

## Refined question

AI 编程 agent（CLI / IDE / 桌面端）在长对话中如何**自动管理并压缩上下文**，避免超出模型上下文窗口导致 API 报错、任务中断？各产品的触发阈值、压缩算法、摘要结构、工具输出治理、错误兜底分别是什么？结论要映射为 Zen 的可落地改造建议。

## Context

- Zen：Electron + Vue3 + better-sqlite3 的 AI 编程桌面端，agent 循环调用 OpenAI 兼容 API，模型 DB 中已存各模型上下文长度。
- Zen 已有一版 **UI 层压缩**（apps/ui/src/stores/chat-compress.ts：70% 阈值、LLM 摘要 system 轮注入、保留尾部消息），但仍会出现**上下文溢出 → API 报错 → agent 停止**。
- 本调研聚焦 **2024–2026** 的当前机制（各产品仍在快速迭代，优先最新一手来源）。

## Scope boundaries

- **In**: Claude Code（auto-compact / microcompact / context editing / memory tool / subagent 隔离）；OpenAI Codex CLI；Google Gemini CLI 及 fork（Qwen Code 等）；商业 IDE（Cursor、Windsurf、GitHub Copilot、Continue 等）；开源 agent（Cline、Roo Code、Aider、OpenHands condenser、Goose）；框架与 API 原生（LangChain、LlamaIndex、Letta/MemGPT、Vercel AI SDK、OpenAI truncation strategy、Anthropic context editing API）；工程最佳实践与社区踩坑（token 计数、阈值选择、prompt cache 冲突、摘要 prompt 设计、context_length_exceeded 兜底）。
- **Out**: RAG 知识库产品选型、消费级聊天产品的界面截断细节、向量库对比。

## Assumptions

- 报告面向 Zen 工程实现决策，语言 zh-CN，技术名词保留英文。
- 结论需给出可操作建议（阈值、触发点、数据流、错误兜底），不写具体代码。

## Angles

- F1: Claude Code / Anthropic 生态的上下文压缩机制（auto-compact 阈值与流程、microcompact、/compact、context editing API、memory tool、subagent 隔离）。
- F2: OpenAI Codex CLI 与 Google Gemini CLI（含 Qwen Code 等 fork）的自动压缩与 checkpoint/resume 机制。
- F3: 商业 IDE/桌面端（Cursor、Windsurf、GitHub Copilot、Continue、Trae 等）的上下文管理与自动摘要策略。
- F4: 开源 CLI/agent（Cline、Roo Code、Aider、OpenHands、Goose）的 condense/summarize 实现与代码级细节。
- F5: 框架与 API 原生能力（LangChain/LlamaIndex/Letta 记忆策略、Vercel AI SDK、OpenAI truncation、Anthropic context editing 参数与计费）。
- F6: 工程最佳实践与失败模式（token 计数与估算、阈值选择、prompt cache 影响、摘要 prompt 设计、工具输出治理、溢出错误兜底与恢复、社区经验）。
