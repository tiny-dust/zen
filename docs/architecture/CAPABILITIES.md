# 能力映射（Vue 3 定案）

| # | 需求 | 实现包 | 关键依赖 | Agent 工具名 | UI 组件 |
|---|------|--------|----------|--------------|---------|
| 1 | 文件编辑 | `tools/fs` + ui | CodeMirror 6, vue-codemirror, chokidar | `fs.read` `fs.write` `fs.edit` `fs.list` `fs.search` | Explorer, CodeMirror, MergeView |
| 2 | 终端执行 | `tools/terminal` + desktop | node-pty, @xterm/xterm；系统默认 shell（`$SHELL` + login） | `terminal.exec` `terminal.start_session` | TerminalPanel（底部面板） |
| 3 | 内嵌浏览器 + CDP | `tools/browser` + desktop | WebContentsView + CDP；**全应用 http(s) 链接优先右栏** | `browserOpen` … | BrowserPanel |
| 4 | MCP | `mcp-client` | @modelcontextprotocol/client v2, @ai-sdk/mcp | `mcp.<server>.<tool>` | MCPManager |
| 5 | Skills | `skills` | Agent Skills 标准（SKILL.md） | `skills.list` `skills.load` | SkillsPage |
| 6 | 系统能力 | `tools/system` | Electron clipboard/notification | `system.clipboard` `system.notify` `system.open_path` `system.os_info` | — |
| 7 | GitHub 认证 | desktop `github-auth` | Device Flow, safeStorage | `auth:login` | AuthState |
| 8 | Git 操作 | `tools/git` | simple-git | `git.status` `git.diff` `git.commit` `git.branch` `git.log` | GitPanel |
| 9 | Agent 循环 | `agent-core` | ai v7 ToolLoopAgent | （编排层） | ChatStream |
| 10 | 会话持久化 | `session` | better-sqlite3 + JSONL | — | SessionList |

## 工具风险分级

| 等级 | 示例 | 默认策略 |
|------|------|----------|
| `read` | 读文件、git status、浏览器打开 | 自动允许 |
| `write` | 写文件、改配置 | workspace 内自动；外部路径确认 |
| `exec` | 终端命令、git commit | 危险模式确认 + toolApproval |
| `network` | GitHub API、MCP、导航 | 会话级授权 |

## IPC 通道命名约定

```
agent:run / agent:cancel / agent:tool-confirm
agent:delta / agent:tool-start / agent:tool-progress / agent:tool-end
session:updated
fs:watch
pty:data / pty:resize
browser:extract-result
```
auth:status-changed
```

类型化方式：main 侧 channel map + preload `contextBridge` 暴露；渲染进程全局 `Window` 接口增强。

## 存储位置

```
用户数据目录/
├── settings.json
├── sessions/<session-id>/transcript.jsonl
├── sessions/<session-id>/meta.db
├── skills/
├── mcp.json
└── logs/
```

GitHub token / LLM API Key：`safeStorage`（Linux 无密钥环时检测 `basic_text` 并降级提示）。

## 禁止

- 渲染进程直接 `require('fs'|'child_process')`
- keytar / BrowserView 时代 API / Squirrel.Windows
- 把 Playwright 当作产品内浏览器（产品浏览器 = WebContentsView + CDP；Playwright 仅可选作开发期 E2E）
