# Zen 技术选型深度调研 Brief

## 研究问题

为代码编程类 AI Agent 桌面产品 **Zen**（寓意：极致精简、专注编程）敲定最终技术栈。UI 层强制 **Vue 3**；其余各层在调研后给出唯一推荐 + 明确否决项。

## 能力边界（必须覆盖）

1. 文件编辑（工作区读写、diff）
2. 终端执行（内嵌 PTY）
3. 内置浏览器 + 内容读取理解
4. MCP 客户端
5. Skills 系统
6. 系统能力（剪贴板、通知、路径等）
7. GitHub 认证授权
8. Git 操作
9. Agent 循环（LLM tool-calling、流式、取消、权限确认）
10. 会话持久化与打包分发

## 范围

- **In**: 桌面端（macOS 优先，兼容 Win/Linux）；本地优先；单机产品形态
- **Out**: 移动端、纯 Web SaaS、多租户云同步（可列为远期）
- **时间窗**: 以 2025-2026 生态为准；优先官方文档与一手公告
- **决策用途**: 直接写入仓库 `docs/architecture/TECH_STACK.md` 并指导 monorepo 初始化

## 假设

- 团队熟悉 TypeScript；Vue 3 为团队主栈
- 允许 Electron 体积换取生态完整度（除非调研出现更强否决证据）
- Agent 核心可独立进程，不与 UI 同进程强耦合
- 需兼容官方 MCP 生态，不自研协议

## 深度模式

**standard**（3-5 个并行子代理，1 轮补查，目标 15+ 来源）

## Angles

1. **F1 Electron + Vue 3 桌面工程栈**：electron-vite / electron-builder / 安全模型 / Pinia / 最新版本与坑
2. **F2 编辑器与终端**：Monaco vs CodeMirror 6（Vue 集成、diff、体积）；xterm.js + node-pty 现状
3. **F3 Agent 运行时与 MCP**：Vercel AI SDK / 原生 tool-calling；@modelcontextprotocol/sdk；桌面内 MCP 进程管理
4. **F4 浏览器理解 + Git/GitHub**：Playwright vs WebContentsView vs WebContents 抽取；simple-git；GitHub Device Flow/Octokit/keytar
5. **F5 Skills、存储、分发与竞品架构**：Claude Code/Cursor/Windsurf 等 skills 与 agent 架构启发；SQLite/JSONL；electron-updater

## 日期

2026-09-12
