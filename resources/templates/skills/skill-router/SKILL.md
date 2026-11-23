---
name: skill-router
description: 技能统一入口：把任务意图映射到本机已安装技能，避免日常对话漏加载。编码、审查、调试、测试、调研、UI、飞书类任务开始时先加载本技能，按路由表加载对应技能后再动手。
triggers:
  - 该用哪个技能
  - 技能路由
  - 加载技能
  - skill router
---

# Skill Router（技能统一入口）

本机装了上百个技能，同名/近义的有好几组。本技能的唯一职责：判断当前任务该加载哪些技能，然后只加载命中的那几个——不要凭印象跳过 `coder` 这类强制入口，也不要一次加载一堆。

## 一、先加载（强制，命中即加载，不询问）

| 场景 | 技能 |
| --- | --- |
| 写 / 改 / 审 / 调 / 重构代码 | `coder`（项目要求：所有开发任务必须走它） |
| 任何触碰 `.vue`、Vite+Vue、Pinia、Vue Router 的任务 | `vue-best-practices` |
| 用户说「简单点 / 别过度设计 / 最小改动 / yagni」，或怀疑自己在加没必要的代码 | `ponytail` |
| 「谁调用了 X」「改这个会坏什么」「这块架构长什么样」 | `codebase-memory`（先查图谱再 grep） |

代码类任务 = `coder` + 任务域技能（Vue / 测试 / 审查…）。风格约束（`ponytail`）与入口技能不冲突，可叠加。

## 二、意图路由表

| 任务意图 | 首选 | 备选 |
| --- | --- | --- |
| 写/改/重构代码 | `coder` | `implement`（已有 spec/工单时） |
| 写或改 Vue 组件、页面、store、路由 | `vue-best-practices` | 细分：`vue-pinia-best-practices` / `vue-router-best-practices` |
| 新建可复用 composable | `create-adaptable-composable` | `vue-best-practices` |
| 用/加/改 shadcn-vue 组件 | `shadcn-vue` | `vue-best-practices` |
| Vue 运行时报错、水合失败、告警 | `vue-debug-guides` | `diagnosing-bugs` |
| 难 bug、性能回归、偶发失败 | `diagnosing-bugs` | `vue-debug-guides` |
| 先写测试 / 红绿重构 | `tdd` | `vue-testing-best-practices` |
| Vue 组件测试、E2E | `vue-testing-best-practices` | `tdd` |
| 审 PR / diff / 质量 / 安全 | `code-review` | `review` |
| «按 issue/PRD 核对是否做对» | `review` | `code-review` |
| UI 代码可访问性 / 规范审计 | `web-design-guidelines` | `impeccable` |
| 前端界面设计、重设计、打磨 | `impeccable` | `ui-taste` |
| 要并排多个 UI 方案挑选 | `prototype` | `ui-taste` |
| iOS 界面设计 / HIG | `ios-design` | `ui-taste` |
| 需求模糊，先想清楚再动手 | `grill-me` | `grilling` |
| 出实施计划 / 拆工单 | `decision-mapping` | `to-issues` |
| 把方案写成 PRD | `to-prd` | `to-issues` |
| 解 merge/rebase 冲突 | `resolving-merge-conflicts` | — |
| 配 husky / pre-commit | `setup-pre-commit` | — |
| 深度调研 / 调研报告 | `deep-investigate` | `web-search` |
| 查资料、抽取网页正文 | `web-search` | 内置 `webSearch` 工具 |
| 网页自动化、抓数据、截图 | `agent-browser` | `chrome-devtools` |
| DevTools 级网络/性能排障 | `chrome-devtools` | `agent-browser` |
| 操作桌面原生 App（GUI） | `computer-use` | — |
| 飞书任何资源（文档/表格/Base/IM/日历/任务/邮件/审批/OKR/幻灯片/画板/知识库） | 对应 `lark-<资源>` | `lark-openapi-explorer` |
| 飞书认证、scope、缺权限 | `lark-shared` | `lark-openapi-explorer` |
| 飞书没封装的能力 | `lark-openapi-explorer` | `lark-skill-maker` |
| 会议纪要 / 妙记 / 逐字稿 | `lark-meeting` | — |
| Three.js 场景/几何/材质/加载 | 对应 `threejs-*` | — |
| 加 AI 功能 / Agent / 流式 | `ai-sdk` | — |
| Hono 后端接口 | `hono` | — |
| Neon / Postgres 建模与迁移 | `neon-postgres` | — |
| Redis 数据结构选型 | `redis-core` | — |
| 写长文 / 技术文档 | `writing-shape` | `writing-fragments` → `writing-beats` |
| 换 agent 接手当前对话 | `handoff` | — |
| 找技能 / 装技能 | `find-skills` | — |
| 写或改技能本身 | `writing-great-skills` | — |

## 三、冲突消解（近义技能怎么选）

| 冲突 | 规则 |
| --- | --- |
| `code-review` vs `review` | 要 CodeRabbit 风格审查/取 fix prompt → `code-review`；要「标准 + 需求双轴」评审 → `review`。不明确时用 `code-review`。 |
| `impeccable` vs `ui-taste` vs `ui-ux-pro-max` vs `frontend-design` | 实现类改动用 `impeccable`；只要品味/反向参考用 `ui-taste`；要配色/字体/组件数据查询用 `ui-ux-pro-max`。三者别同时加载。 |
| `agent-browser` vs `chrome-devtools` vs zen 内置浏览器工具 | 普通页面交互优先 zen 内置 `browser*` 工具；CLI 态批量抓取用 `agent-browser`；要看网络/性能面板用 `chrome-devtools`。 |
| `deep-investigate` | 只用 `~/.zen/skills` 或 `~/.agents/skills` 那份；`~/.dimcode` 下同名 legacy 版本不要加载。 |
| `grill-me` vs `grill-with-docs` vs `grilling` | 要顺手产出 ADR/术语表 → `grill-with-docs`；只压测想法 → `grill-me`（或 `grilling`）。 |
| `lark-minutes` / `lark-note` / `lark-vc` / `lark-vc-agent` | 都是转发壳，一律加载 `lark-meeting`。 |
| `ubiquitous-language` | 已弃用，用 `domain-modeling` 或 `grill-with-docs` 代替。 |

## 四、不要加载

- 空壳目录（没有 SKILL.md 内容）：`brainstorming`、`writing-plans`、`test-driven-development`、`systematic-debugging`、`verification-before-completion`、`using-superpowers` 等。加载会失败，改用上表对应技能。
- `~/.dimcode/v2/skills` 下的 legacy 集合：与主集合同名但实现不同（`ponytail`、`computer-use`、`deep-investigate`），只作参考，不加载。
- 仅显式请求才用的技能：`prototype`、`ask-matt`、`handoff`、`teach`、`triage`、`implement`、`decision-mapping`、`grill-me`、`to-prd`、`to-issues`、`qa`、`scaffold-exercises`。用户没点名就别自作主张。

## 五、怎么用

1. 判断任务属于上表哪一行（可多行）。
2. 逐个 `loadSkill` 命中技能，读完再动手；一次不超过 3 个。
3. 表里没有的领域：直接按技能清单描述匹配，别硬套无关技能。
4. 加载失败（技能被删/移动）：说明一声，按表里的备选继续，不要反复重试同一个 id。

## 六、面板（panel.json）

本技能目录带 `panel.json`：zen 在本会话用到本技能后，会在输入框上方用内置面板显示轮数 / 工具调用 / 会话时长 / 最后一条测试结果。自带 HTML 的 `srcdoc` 面板内联脚本受宿主 CSP 限制，当前不用于本技能。
