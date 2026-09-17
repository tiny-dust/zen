# 主流 AI 编程工具 / 桌面 AI 助手内置系统提示词调研

> 生成日期：2026-09-17
>
> 调研方式：所有来源均通过 WebFetch 实际抓取核实（GitHub 仓库 / Gist / 官方仓库 README / 产品官网），未凭记忆编造。找不到完整原文的工具明确标注「未公开/未找到」。
>
> 说明：泄露类提示词可能过时、不完整或与线上版本有出入；摘录仅为短片段，用于说明取向，完整原文请点来源链接。调研中途 GitHub REST API 触发限流，部分目录改用仓库网页核实，不影响结论。

---

## 1. 概述

| 工具 | 找到完整原文 | 来源 | 可信度 | 核心取向（一句话） |
|---|---|---|---|---|
| OpenAI Codex CLI | ✅ 官方随源码发布 | [openai/codex · codex-rs/core/gpt_5_2_prompt.md](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_2_prompt.md) | 高（官方公开） | 「自主干到底」的终端编码代理：AGENTS.md 约定、最小改动、apply_patch 编辑、沙盒+审批分级 |
| Claude Code | ✅ 社区泄露整理 | [x1xhlol 仓库 · Anthropic/Claude Code 2.0.txt](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Anthropic/Claude%20Code%202.0.txt)（v2.0.0，2025-09-29） | 中（泄露整理，与多方转述一致） | 仅防御性安全、极简输出、TodoWrite 全程跟踪、专用工具优先于 shell |
| ChatGPT | ✅ 泄露整理（2025-08，GPT-5 版） | [Gist: pchaurasia14](https://gist.github.com/pchaurasia14/c4656286743446123aa1290a688068d6)；[Digital Trends 报道](https://www.digitaltrends.com/computing/you-are-chatgpt-leaked-system-prompt-reveals-the-inner-workings-of-gpt-5/) | 中（多渠道交叉一致的泄露版） | 通用助手：人设 v2、记忆工具 bio 的写入红线、禁止「要不要我…」式追问结尾 |
| DeepSeek | ⚠️ 官方模板公开；App 端提示词为泄露 | 官方：[DeepSeek-Coder README 内置对话模板](https://github.com/deepseek-ai/DeepSeek-Coder#3-chat-model-inference)；泄露：[systempromptindex.ai 聚合的 R1 提示词](https://systempromptindex.ai/gallery/deepseek) | 官方模板高；App 泄露中低 | 编程专用：官方模板「只答计算机科学问题、敏感话题拒答」；App 端强调身份声明 |
| GitHub Copilot（VS Code Agent） | ✅ 泄露 | [x1xhlol 仓库 · VSCode Agent/Prompt.txt](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/VSCode%20Agent/Prompt.txt) | 中（与官方行为一致，社区交叉引用多） | 身份锁定 + 平台内容政策 + 「绝不贴代码块，必须用编辑工具改文件」 |
| Cursor Agent | ✅ 泄露 | [x1xhlol 仓库 · Cursor Prompts/Agent Prompt 2.0.txt](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%202.0.txt) | 中（该仓库 34.8k fork，老牌泄露集合） | 把「工具何时用/何时不用」写到极致；终端命令需用户批准、长任务后台执行 |
| Mimo Desktop（小米 MiMo） | ❌ 未公开 | 产品存在性确认：[mimo.mi.com](https://mimo.mi.com/)、[mimo.xiaomi.com/mimocode](https://mimo.xiaomi.com/mimocode) | — | 未找到官方或泄露的内置提示词原文 |
| Pi（Inflection） | ❌ 未找到 | 常见泄露集合（如 [cedrickchee gist](https://gist.github.com/cedrickchee/9390389d755e574cca24a2b42aaa7d47)、[asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks)）均未收录 | — | 未公开 |
| DimAgent（本项目） | ❌ 未公开 | 在本仓库 `apps/` 下 grep 未检索到内置提示词文件；公网亦无公开 | — | 未公开（推断为应用内部随包分发，不在开源仓库中） |

其他未被逐条验证、可作补充线索的资料源：用户提供的 [mkxcode/Agent-system-prompts](https://github.com/mkxcode/Agent-system-prompts)；官方补充：[Anthropic Claude Code 文档](https://docs.claude.com/en/docs/claude-code/overview)（官方只描述功能与工具，不发布内置提示词原文）。

---

## 2. 分工具调研

### 2.1 OpenAI Codex CLI（官方公开）

**来源**：[openai/codex](https://github.com/openai/codex) 仓库 `codex-rs/core/` 目录。旧路径 `codex-rs/core/prompt.md` 已 404，现行文件按模型版本拆分：`gpt_5_2_prompt.md`（约 21.7KB，主提示词）、`gpt_5_1_prompt.md`、`gpt-5.2-codex_prompt.md` 等。这是本次调研中唯一「官方直接开源」的内置提示词。

**中文概括**：定位是「终端里的编码代理」，强调精确、安全、有帮助；人格简洁直接友好但避免冗长；明确要求把任务干到底而不是只给方案；用 `update_plan` 做可视化规划（还给了好/坏计划的正反例）；编辑一律走 `apply_patch`；编码规范突出「治本、最小改动、不修无关问题、不顺手 commit」；验证策略是先跑最相关的测试再逐步扩大；另有「沙盒与审批」章节，按配置决定命令是否要用户批准。

**关键原文摘录**：

> You are GPT-5.2 running in the Codex CLI, a terminal-based coding assistant. ... You are expected to be precise, safe, and helpful.

> For every file you touch in the final patch, you must obey instructions in any AGENTS.md file whose scope includes that file. ... More-deeply-nested AGENTS.md files take precedence.

> Persist until the task is fully handled end-to-end within the current turn whenever feasible ... it's bad to output your proposed solution in a message, you should go ahead and actually implement the change.

> - Fix the problem at the root cause rather than applying surface-level patches, when possible.
> - Do not attempt to fix unrelated bugs or broken tests. It is not your responsibility to fix them.
> - Do not `git commit` your changes or create new git branches unless explicitly requested.
> - NEVER add copyright or license headers unless specifically requested.

### 2.2 Claude Code（社区泄露整理）

**来源**：[x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) 的 `Anthropic/Claude Code 2.0.txt`（57KB，标注 v2.0.0 / 2025-09-29，含抓取时的环境信息与完整工具定义，可信度较高）。Anthropic 官方不发布该提示词原文，官方文档只描述工具与功能。该仓库另有 `Anthropic/Claude Code/` 目录存放历史版本。

**中文概括**：安全边界第一条就是「只做防御性安全」，拒绝创建恶意代码与凭据窃取；禁止编造/猜测 URL；输出风格极端克制（常规回答少于 4 行、禁止前后客套）；「专业客观」条款要求技术准确性优先于迎合用户；TodoWrite 要高频使用、完成即标记；工具策略上文件搜索优先派子代理（Task）、能用专用工具就不用 bash、独立调用要并行批量；引用代码必须带 `file_path:line_number`；用户消息侧还有注入的提醒：「只做被要求的事、非必要不建文件、优先编辑既有文件」。

**关键原文摘录**：

> IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously.

> A concise response is generally less than 4 lines, not including tool calls or code generated.

> Prioritize technical accuracy and truthfulness over validating the user's beliefs. ... Objective guidance and respectful correction are more valuable than false agreement.

> - When doing file search, prefer to use the Task tool in order to reduce context usage.
> - When making multiple bash tool calls, you MUST send a single message with multiple tools calls to run the calls in parallel.

> Do what has been asked; nothing more, nothing less. ... ALWAYS prefer editing an existing file to creating a new one.

### 2.3 ChatGPT（泄露，2025-08 GPT-5 版）

**来源**：2025 年 8 月泄露的 GPT-5 系统提示词，见于 [pchaurasia14 的 Gist](https://gist.github.com/pchaurasia14/c4656286743446123aa1290a688068d6) 等多处，媒体如 [Digital Trends](https://www.digitaltrends.com/computing/you-are-chatgpt-leaked-system-prompt-reveals-the-inner-workings-of-gpt-5/) 有报道与交叉比对。非官方发布，可能随版本快速变化。

**中文概括**：典型「通用助手」而非编码代理：身份声明 + 知识截止/多模态能力标注；「人设 v2」定义鼓励式、带幽默的教学口吻；特别条款禁止用「要不要我… / 需要我…吗」这类追问收尾；最详细的部分是记忆工具 `bio`：何时存、何时不存，并列出禁止保存的敏感类别（种族、宗教、健康、精确位置、政治倾向等）；另有版权复述禁令。工具章节（搜索、Deep Research 等）篇幅很大。

**关键原文摘录**：

> You are ChatGPT, a large language model based on the GPT-5 model and trained by OpenAI.

> Do not reproduce song lyrics or any other copyrighted material, even if asked.

> Do not end with opt-in questions or hedging closers. Do **not** say the following: would you like me to; want me to do that; ... Ask at most one necessary clarifying question at the start, not the end.

> Don't save information pulled from text the user is trying to translate or rewrite. ... Never store information that falls into the following sensitive data categories unless clearly requested by the user.

### 2.4 DeepSeek

**来源 A（官方，高可信）**：[deepseek-ai/DeepSeek-Coder](https://github.com/deepseek-ai/DeepSeek-Coder) 官方 README 公布的对话模板，写明模型该使用的系统提示。

**来源 B（泄露，中低可信）**：DeepSeek 官方 App / R1 网页端的系统提示在社区流传，第三方聚合站 [systempromptindex.ai](https://systempromptindex.ai/gallery/deepseek) 收录全文，多个社区仓库交叉可见，但无官方佐证。

**中文概括**：官方编程模板非常短，核心是「身份 + 领域限制 + 敏感话题拒答」三件套；没有工具调用、规划等代理条款——它面向的是对话式编程问答而非 agent 场景。App 端泄露版同样是身份声明 + 泛化的 helpful/harmless 表述，信息量有限。DeepSeek 的系统提示风格可总结为：短、强身份、强拒答边界。

**关键原文摘录（官方模板）**：

> You are an AI programming assistant, utilizing the DeepSeek Coder model, developed by DeepSeek Company, and you only answer questions related to computer science. For politically sensitive questions, security and privacy issues, and other non-computer science questions, you will refuse to answer.

**关键原文摘录（App 泄露，仅此一句）**：

> You are DeepSeek-R1, an AI assistant created exclusively by the Chinese Company DeepSeek.

### 2.5 GitHub Copilot / VS Code Agent（泄露）

**来源**：[x1xhlol 仓库 · VSCode Agent/Prompt.txt](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/VSCode%20Agent/Prompt.txt)（VS Code 内置 Copilot Agent 的提示词，社区泄露；与官方「Copilot 修改文件走工具、不直接输出代码块」的可观察行为一致）。

**中文概括**：身份被锁死（问名字只能答 GitHub Copilot）；明确挂接微软内容政策与版权规避；对有害请求的响应方式被硬编码为固定句式；核心行为规范是「别在聊天里贴代码块/命令，必须用 `insert_edit_into_file` / `run_in_terminal` 工具落地」；强调先收集上下文、不臆测，再动手；工具调用要求严格按 JSON schema。

**关键原文摘录**：

> When asked for your name, you must respond with "GitHub Copilot". ... Follow Microsoft content policies. Avoid content that violates copyrights.

> If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, violent, or completely irrelevant to software engineering, only respond with "Sorry, I can't assist with that."

> NEVER print out a codeblock with file changes unless the user asked for it. Use the insert_edit_into_file tool instead. ... Don't make assumptions about the situation- gather context first, then perform the task or answer the question.

### 2.6 Cursor Agent（泄露）

**来源**：[x1xhlol 仓库 · Cursor Prompts/Agent Prompt 2.0.txt](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%202.0.txt)（38.8KB，同仓库还有 CLI 版与多个日期版本）。

**中文概括**：最大特色是把每个工具的「何时用 / 何时不用」写成手册：如语义搜索 `codebase_search` 给出适用与不适用清单、单目录限定、先宽后窄的检索策略；终端命令类型 `run_terminal_cmd` 明示「用户可能要先批准」「假定用户不在场，一律加非交互参数」「长任务用后台执行」；整体是把工具协议 + 使用策略 + 审批提示揉在系统提示里的范式。

**关键原文摘录**：

> // PROPOSE a command to run on behalf of the user.
> // Note that the user may have to approve the command before it is executed.

> 4. For ANY commands that would require user interaction, ASSUME THE USER IS NOT AVAILABLE TO INTERACT and PASS THE NON-INTERACTIVE FLAGS (e.g. --yes for npx).
> 5. For commands that are long running/expected to run indefinitely until interruption, please run them in the background.

> // Use `codebase_search` when you need to: ... Ask "how / where / what" questions to understand behavior
> // Skip `codebase_search` for: 1. Exact text matches (use `grep`) ...

### 2.7 Mimo Desktop（小米 MiMo）— 未公开

官网（[mimo.mi.com](https://mimo.mi.com/)、[mimo.xiaomi.com/mimocode](https://mimo.xiaomi.com/mimocode)）确认 MiMo Desktop / MiMo Code 为小米的 AI 桌面端与编程助手产品，但检索（含 GitHub `XiaomiMiMo` 相关仓库与泄露集合）未找到其内置系统提示词的公开原文。**结论：未公开/未找到。**

### 2.8 Pi（Inflection）— 未找到

DuckDuckGo 多组关键词检索无结果；主流泄露集合（[cedrickchee gist](https://gist.github.com/cedrickchee/9390389d755e574cca24a2b42aaa7d47)、[asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks)、[jujumilk3/leaked-system-prompts](https://github.com/jujumilk3/leaked-system-prompts)）目录中均未见 Pi。**结论：未找到公开原文。**

### 2.9 DimAgent（本项目）— 未公开

在本仓库 `apps/`（TS/MD）中 grep `DimAgent|system.?prompt` 未检索到内置提示词文件；公网无公开资料。**结论：未公开**（如需可作为内部材料单独整理）。

---

## 3. 对比总结：四类共性做法

### 3.1 代码修改规范

| 做法 | 代表 |
|---|---|
| 根因修复，不做表面补丁 | Codex |
| 最小改动、不修无关 bug、不改无关测试 | Codex、Claude Code |
| 优先编辑既有文件，非必要不新建文件/文档 | Claude Code（用户消息注入提醒）、Copilot（用编辑工具而非贴代码） |
| 未经要求不 commit、不建分支、不加版权头 | Codex |
| 尊重项目既有约定（AGENTS.md / 项目风格），就近文件优先级更高 | Codex（AGENTS.md 作用域与覆盖规则最成体系） |
| 修改后必须验证，从最相关测试开始，失败重试有上限 | Codex |

### 3.2 工具调用与审批

| 做法 | 代表 |
|---|---|
| 专用工具优先于 shell（读/写/检索不用 cat/sed） | Claude Code、Cursor |
| 独立调用并行批量发出 | Claude Code（明文 MUST）、Codex |
| 终端命令需用户批准；不同审批/沙盒模式决定是否主动跑测试 | Cursor（显式）、Codex（沙盒与审批分级章节） |
| 命令默认非交互（假定用户不在场），长任务后台执行 | Cursor |
| 修改类动作必须走工具落地，不允许「聊天里贴补丁」 | Copilot（insert_edit_into_file）、Codex（apply_patch） |

### 3.3 任务规划

| 做法 | 代表 |
|---|---|
| 显式 todo/plan 工具，一次一个 in_progress，完成即更新，不许事后批量勾 | Codex（update_plan 状态机规则）、Claude Code（TodoWrite 高频） |
| 简单任务不凑步骤，规划质量有正反例约束 | Codex |
| 动手前先拆解概念、收集上下文，不臆测 | Copilot、Cursor |
| 理解变化时先改计划再继续，保持计划不过期 | Codex |

### 3.4 安全边界

| 做法 | 代表 |
|---|---|
| 仅防御性安全，拒绝恶意代码与凭据窃取 | Claude Code |
| 身份锁定 + 平台内容政策 + 有害请求固定话术 | Copilot |
| 拒绝复述版权内容 | ChatGPT、Copilot |
| 禁止编造/猜测 URL | Claude Code |
| 敏感个人信息不写入记忆/持久层 | ChatGPT（bio 工具红线） |
| 领域外/敏感话题直接拒答（编程助手收窄为「只答计算机问题」） | DeepSeek 官方模板 |

**总体观察**：编码代理类（Codex / Claude Code / Copilot / Cursor）的系统提示词都极长（数千到数万 token），重心在「工具协议 + 行为纪律 + 审批模型」；通用助手类（ChatGPT / DeepSeek App）重心在「人设 + 记忆 + 拒答边界」。两者共享的底层原则高度一致：最小副作用、诚实汇报、危险动作留给人确认。

---

## 4. 提炼建议：「极简 AI 编程桌面端」系统提示词骨架

融合上述共性实践，建议骨架如下（中文，可直接扩写）：

```markdown
你是 <产品名>，运行在用户桌面端里的编码助手，可直接读写本地工作区。

【身份与口吻】简洁、直接、技术优先；准确性高于迎合，不确定先查证；回答与任务复杂度匹配，不写前后客套，不堆表情与奉承。

【代码修改规范】
- 最小改动：只解决用户提出的问题，不顺手重构、不修无关 bug。
- 优先编辑既有文件，非必要不新建文件；不主动创建文档。
- 先读项目约定文件（如 AGENTS.md），遵循既有风格；就近的约定覆盖上层。
- 未经明确要求：不 git commit、不建分支、不加版权头、不写大段注释。
- 修改后必须验证：优先运行与改动最相关的测试/构建；失败最多重试 3 次，仍失败则如实汇报。

【工具与审批】
- 能用专用工具（读/写/检索）就不用 shell；独立调用并行发出。
- 命令默认非交互参数；长任务转后台。
- 高危操作（删除/覆盖、装依赖、git push、联网上传、改动系统配置）必须先说明用途并获得用户确认；确认前只做只读探索。
- 修改文件必须用编辑工具落地，不在对话里贴大段补丁。

【任务规划】
- 多步骤任务先列待办：一次只有一个进行中，完成即标记，结束前全部闭环；简单问题不凑步骤。
- 计划要变就先更新计划再动手，保持与实际一致。

【安全边界】
- 只做防御性安全：拒绝恶意代码、凭据窃取、批量抓取隐私数据。
- 不猜测/编造 URL；不输出、不持久化密钥等敏感凭据。
- 拿不准的事实验证后再说；做不到就直说，并给替代方案。

【输出】最终回复自包含：结论在前，关键改动与验证结果随后；引用代码带 文件:行号；改动过的文件逐一列出。
```

---

## 附：本次核实过的来源清单

1. https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_2_prompt.md （官方，抓取于 2026-09-17）
2. https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/tree/main/Anthropic （Claude Code 2.0 泄露）
3. https://gist.github.com/pchaurasia14/c4656286743446123aa1290a688068d6 （ChatGPT GPT-5 泄露）
4. https://github.com/deepseek-ai/DeepSeek-Coder （官方对话模板）
5. https://systempromptindex.ai/gallery/deepseek （DeepSeek App 泄露聚合）
6. https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/VSCode%20Agent/Prompt.txt （Copilot 泄露）
7. https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%202.0.txt （Cursor 泄露）
8. https://mimo.mi.com/ 、https://mimo.xiaomi.com/mimocode （MiMo 产品存在性确认）
9. https://github.com/asgeirtj/system_prompts_leaks 、https://gist.github.com/cedrickchee/9390389d755e574cca24a2b42aaa7d47 （泛泄露集合，用于确认 Pi/MiMo/DimAgent 未收录）
