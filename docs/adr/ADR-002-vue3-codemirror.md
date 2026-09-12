# ADR-002: UI 定为 Vue 3，编辑器选 CodeMirror 6

- 状态: Accepted
- 日期: 2026-09-12

## 背景

产品 Zen（极致精简，专注编程）。初稿 UI 为 React + Monaco；需求改为 Vue 3，并要求深度调研后敲定全栈。

## 决策

1. UI：**Vue 3 + Pinia 3 + vue-router 4**，工程 **electron-vite 5**。
2. 默认编辑器：**CodeMirror 6 + vue-codemirror + @codemirror/merge**，不用 Monaco。
3. 其余层按 `TECH_STACK.md`：Electron 44、AI SDK v7、MCP SDK v2、WebContentsView、simple-git、GitHub App Device Flow、safeStorage、Agent Skills、JSONL+better-sqlite3、electron-builder v27。

## 依据（调研摘要）

- electron-vite 官方脚手架提供 `vue-ts` 模板；Pinia 为 Vue3 官方默认状态库。
- Monaco npm unpacked ~93MB，且无一等 Vue 封装；CodeMirror 6 核心为 MB 级且 `vue-codemirror` 维护中。
- 编码 Agent 主路径是编辑 + apply diff，不是完整 IDE LSP；与「极致精简」一致。

## 后果

- 需自管 CM 语言包按需安装，避免一次打全量。
- 若未来以 LSP/超大仓库为主，可引入 Monaco 0.56 tree-shakeable 路径（见 ADR 复议）。

## 复议条件

- LSP 成为 P0 且 CM6 生态不足。
- 团队强制 Monaco 生态组件。
