# ADR-001: Electron + TypeScript pnpm Monorepo（产品名 Zen）

- 状态: Accepted
- 日期: 2026-09-12

## 背景

需要构建代码编程类 AI Agent 桌面工具，核心能力包括文件编辑、终端、内置浏览器、MCP、Skills、系统能力、GitHub 认证与 Git 操作。

## 决策

采用 **Electron + TypeScript + pnpm workspace monorepo**，Agent 运行时独立进程，UI 使用 React。

## 备选

1. Tauri 2 + Rust + Web
2. 纯 CLI（无桌面壳）
3. VS Code Extension

## 理由

1. MCP、PTY、Playwright、Monaco 均在 Node/Electron 生态成熟。
2. monorepo 使 `tools/*`、`agent-core` 可单测、可复用。
3. 独立 Agent 进程保证 UI 流畅与崩溃隔离。
4. 比 VS Code 扩展有更高的产品形态自由度（内置浏览器、完整终端、自有 Skills）。

## 后果

- 需自行处理打包体积与原生模块 rebuild。
- 必须严格做渲染进程沙箱与工具权限门禁。

## 复议条件

- 若内存/体积成为发布阻塞，评估 Tauri + Node sidecar。
- 若产品形态收敛为「编辑器内 Agent」，评估 VS Code 扩展分发。
