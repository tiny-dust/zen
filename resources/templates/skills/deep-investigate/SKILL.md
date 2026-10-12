---
name: deep-investigate
description: 多 agent 并行深度网上调研：拆视角并行取证、独立复核，产出结论先行、带编号引用与可追溯证据的结构化调研报告。适用于用户要求「深度调研」「深入研究」「全面调研」「写调研报告」「deep research」。
triggers:
  - 深度调研
  - 深入研究
  - 全面调研
  - 调研报告
  - deep research
---

# Deep Investigate（深度网上调研）

产出 = 工作区内 `research/<slug>/` 下的 brief、findings、REPORT.md；所有落盘用相对路径，对话里只回报告路径与核心结论。

## 预算硬约束（先于一切）
- 默认档：spawnAgent 总数 ≤5（含复核与补查），报告引用来源 ≤15。
- quick 档：spawnAgent ≤3，来源 ≤8；用户说「简单查一下」「快速了解」即用 quick。
- 补查最多一轮；禁止抓取登录墙/付费墙页面，遇到立即换来源，不得凭记忆补内容。

## Phase 1 澄清与立项
1. 用 askUser 一次问清：调研问题、时间范围、地域、统计口径、默认档还是 quick 档；能从对话推断的不要问。
2. 派生 slug（小写短横线，如 `ev-charging-cn-2025`），用 writeFile 创建 `research/<slug>/brief.md`。brief 是全程唯一契约，只含四节：调研问题、子问题清单（5–8 条可判定真伪的陈述句）、预算档位、产出要求（报告结构 + 来源数上限）。
3. 用 updateTasks（startNew: true）登记四个阶段：t1 立项、t2 并行取证、t3 复核补查、t4 撰写报告；此后每完成一个阶段重发全量清单。

## Phase 2 并行取证
4. 把子问题归入 3–5 个互不重叠的视角，按题目选合用的：事实与数据 / 近期进展 / 反方观点 / 实践者经验 / 学术或竞品。每视角绑定要回答的子问题编号，并分配 findings 文件序号 n（F1、F2…）。
5. 在一条消息里并行 spawnAgent 每个视角（系统并发上限 2，超出自动排队；name 填视角名，maxAttempts 传 2）。task 必须自包含，逐条写明：
   - 你只负责视角 X，回答 brief 中子问题 #a、#b；先 readFile `research/<slug>/brief.md`。
   - 用 webSearch 多轮检索：query 自拟，中英文各试，改写关键词直到结果相关；单次返回约 8 条 title+url。
   - 用 webFetch 读关键来源正文：参数 `{url, startIndex?, maxChars?}`，返回 `{title, url, content, nextStartIndex, totalChars}`；content 是正文 markdown 切片，把返回的 nextStartIndex 作为下次的 startIndex 续读长文；读不动的来源立即换下一篇。
   - 每条发现用 writeFile 落到 `research/<slug>/findings/F<n>.md`（只写你自己的序号 n，别碰其它文件），每条格式：
     - `F<n>-<序号> <claim：一句可判定真伪的陈述>`
     - `引文：「…」（≤50 字，从 content 原文摘）`
     - `来源：<URL>｜访问：<YYYY-MM-DD>｜置信度：高/中/低（低须写原因）`
   - 结束只回 3–5 行摘要（视角结论 + 已落盘的文件名）；网页原文不回传，主 agent 上下文留给整合。
6. 用 waitForAgents 等全部终态（省略 ids 等所有，或传 spawn 返回的 id 列表）；status 非 done 的读 error 字段，按原因缩小任务重派一次，计入预算。需要逐条取回摘要时用 collectAgentResults。子 agent 持续检索或写盘不会被超时，长时间无任何产出才会被取消。完成后 updateTasks 勾掉 t2。

## Phase 3 独立复核
7. spawnAgent 1 个复核 agent（名字与任务都不得与 Phase 2 重叠），task：readFile brief.md 与全部 findings/*，只检查三件事——每个子问题是否有发现覆盖、发现之间的冲突点、来源可信度与时效；把缺口清单 writeFile 到 `research/<slug>/review.md`，每条缺口给出可执行的补查 query 与应归属的视角序号。
8. waitForAgents 收复核结果，按缺口做 delta query 补查：预算内 spawnAgent 1 个补查 agent，或主 agent 直接 webSearch + webFetch；新发现追加写进对应 F<n>.md，编号顺延。补查一轮即止。

## Phase 4 撰写报告
9. 主 agent readFile 全部 findings/* 与 review.md，单点撰写 `research/<slug>/REPORT.md`：
   - 结论先行：3–5 条核心判断，每条句尾带 [n] 引用。
   - 分主题论据：按视角或主题展开，行内 [n] 只指向来源清单里已记录的 URL；findings 之外的内容不得进正文。
   - 冲突并列：来源互相矛盾时并排呈现双方说法与出处，标注 [单一来源] 或 [推测]；证据不足的不下结论。
   - Open questions：本轮没能回答的子问题与原因。
   - 来源清单：`[n] 标题｜URL｜访问日期`，每条必须能在 findings 文件中找到相同 URL。
10. updateTasks 全部勾完；对话里回复报告路径 + 3–5 行核心结论，不复述全文。
