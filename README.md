# Zen

Zen — 极致精简，专注编程。面向代码编程场景的 AI Agent 桌面端工具。

## 核心能力

| 能力 | 说明 |
|------|------|
| 文件编辑 | 工作区读写、diff 预览、多文件批量编辑（CodeMirror 6） |
| 终端执行 | 内嵌 PTY 终端（xterm.js + node-pty） |
| 内置浏览器 | WebContentsView + DOM/CDP 内容抽取与理解 |
| MCP | 官方 TS SDK v2，stdio / Streamable HTTP |
| Skills | Agent Skills 开放标准（SKILL.md） |
| 系统能力 | 剪贴板、通知、路径、系统信息 |
| GitHub 认证 | Device Flow + safeStorage |
| Git 操作 | simple-git：status / diff / commit / branch |

## 技术栈（已敲定 · 全 latest 稳定版）

**Electron 44.3.0 · electron-vite 5.0.0 · Vue 3.5.42 · Pinia 4.0.3 · vue-router 5.3.1（文件路由）· Vite 7.3.6 · CodeMirror 6 · xterm/node-pty · AI SDK 7 + @ai-sdk/vue · MCP Client 2 · WebContentsView · simple-git · Octokit 5 · Agent Skills · JSONL + better-sqlite3 13 · electron-builder 26.16.1**

版本真源：[docs/architecture/VERSIONS.md](./docs/architecture/VERSIONS.md)  
选型报告：[research/tech-stack/REPORT.md](./research/tech-stack/REPORT.md)

## 目录结构

```
zen/
├── apps/
│   ├── desktop/          # Electron 主进程 + preload
│   └── ui/               # Vue 3 渲染进程
├── packages/
│   ├── agent-core/       # AI SDK ToolLoopAgent、工具编排
│   ├── mcp-client/       # MCP v2 客户端
│   ├── skills/           # Skills 发现 / 加载
│   ├── tools/            # fs · terminal · browser · git · github · system
│   ├── session/          # JSONL + SQLite 会话
│   └── shared/           # 公共类型
├── docs/
│   ├── architecture/
│   └── adr/
├── research/tech-stack/  # 选型调研报告
└── resources/            # 内置 Skills 模板
```

## 快速开始

```bash
# 需要 Node >= 22.12
pnpm install
pnpm dev
pnpm typecheck
pnpm package
```

## 文档

- [技术选型](./docs/architecture/TECH_STACK.md)
- [依赖版本锁定](./docs/architecture/VERSIONS.md)
- [整体架构](./docs/architecture/ARCHITECTURE.md)
- [能力映射](./docs/architecture/CAPABILITIES.md)
- [调研报告](./research/tech-stack/REPORT.md)
- [版本调研纪要](./research/tech-stack/VERSION_RESEARCH.md)
- [ADR-001 Electron monorepo](./docs/adr/ADR-001-electron-typescript-monorepo.md)
- [ADR-002 Vue3 + CodeMirror](./docs/adr/ADR-002-vue3-codemirror.md)
- [ADR-003 GitHub Device Flow](./docs/adr/ADR-003-github-device-flow-safestorage.md)
