# 下一步落地清单（Vue 3 定案）

## 1. 环境

- [ ] Node **≥ 22.12**（electron-builder v27）
- [ ] pnpm 9+
- [ ] `pnpm install`

## 2. 最小可运行壳（P0）

- [ ] `create @quick-start/electron` → 覆盖为本 monorepo 布局，或手工搭 electron-vite `vue-ts`
- [ ] 安全 preload + typed IPC
- [ ] Vue3 壳：聊天流式假回复（`agent:delta`）

## 3. 三件核心工具（P1）

- [ ] `tools/fs` + CodeMirror 6 编辑/diff
- [ ] `tools/terminal` + xterm/node-pty
- [ ] `tools/git` + simple-git
- [ ] `agent-core` 接入 AI SDK v7 ToolLoopAgent，跑通「改文件 → 跑测试 → commit」

## 4. 扩展（P2）

- [ ] MCP client v2（stdio 本地 / HTTP 远程）
- [ ] Agent Skills 加载（含 `.claude/skills` 兼容）
- [x] GitHub Device Flow + safeStorage（见 `docs/auth/github-oauth-setup.md`）
- [ ] WebContentsView 浏览器理解

## 5. 发布（P4）

- [ ] electron-builder v27：macOS 签名公证 + zip；Windows NSIS
- [ ] electron-updater 渠道 latest/beta

## 首周目标

**用户说话 → Agent 改文件 → 终端跑测试 → git commit**，UI 为 Vue3。
