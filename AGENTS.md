# AGENTS.md

## 会话启动（强制）

每次对话开始、在写任何代码之前，必须先加载并调用以下三个技能：

1. **`coder`** — 开发总入口。铁律（禁止额外编程、不要预想未来、代码整齐、中低级可读）、查询索引、Vue3/TS 规范路由。`node ~/.agents/skills/coder/scripts/query.js --root .`；有索引先 query，变更后 `--refresh`，收工 `--check`。
2. **`ask-matt`** — 技能/流程路由。判断当前任务该走 grill / implement / diagnose / 哪条主流程，避免乱切流程。
3. **`codebase-memory`** — 结构查询。用 `list_projects` / `search_graph` / `trace_path` / `query_graph` 理清调用链与影响面，避免无目标 grep。

技能路径以本机实际安装为准（常见：`~/.agents/skills/`、`~/.config/mimocode/skills/`、项目 `.mimocode/skills/`）。

## 项目速览

Zen：Electron + Vue3 + better-sqlite3 的 AI 编程桌面端。

- `apps/desktop`：主进程（IPC、模型 DB、Agent）
- `apps/ui`：渲染层（shadcn-vue / Pinia）
- `packages/shared`：跨端类型
- UI 规范：`docs/design/UI_STYLE.md`（MiMo 深色 token，禁止组件内写死色值）

## 模型配置相关约定

- 供应商：协议、名称、Base URL、API Key、User-Agent
- 模型：启用开关、自定义标记、上下文长度、能力开关（工具/推理/视觉/媒体）、推理强度多选
- 市区模型能力落 SQLite（`catalog_models`），添加自定义模型时按 ID 拆分匹配（如 `VW2TTQCH/deepseek-v4-flash` → `deepseek-v4-flash`）
- 知名厂商 Logo 资源放在 `apps/ui/src/components/brand/`
