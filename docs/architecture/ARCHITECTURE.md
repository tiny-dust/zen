# 整体架构

## 分层

```
┌──────────────────────────────────────────────────────────┐
│ Presentation Layer（apps/ui · Vue 3）                    │
│  Chat · Explorer · CodeMirror · xterm · Browser Panel    │
│  Git Panel · Skills · Settings · Auth                    │
└───────────────────────────┬──────────────────────────────┘
                            │ typed IPC（contextBridge 白名单）
┌───────────────────────────▼──────────────────────────────┐
│ Shell Layer（apps/desktop · Electron main）              │
│  Window/WebContentsView · Security Gate · safeStorage    │
│  Auto Update · Process Supervisor                        │
└───────────────────────────┬──────────────────────────────┘
                            │ stdio / local socket
┌───────────────────────────▼──────────────────────────────┐
│ Agent Runtime（packages/agent-core）                     │
│  AI SDK v7 ToolLoopAgent · Tool Registry                 │
│  Context/Memory · Skills Loader · MCP Pool · Policy      │
└───────┬───────────┬───────────┬───────────┬──────────────┘
        │           │           │           │
   ┌────▼───┐  ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
   │ tools  │  │  mcp   │  │ skills │  │session │
   │fs/pty  │  │ client │  │ loader │  │ store  │
   │git/gh  │  │  v2    │  │        │  │jsonl+  │
   │browser │  │        │  │        │  │sqlite  │
   └────────┘  └────────┘  └────────┘  └────────┘
```

## Agent 循环

```
User Message
    │
    ▼
[Context Assemble] ── system + skills hint + workspace + history
    │
    ▼
[AI SDK streamText / ToolLoopAgent]
    │
    ├─ text delta ──────────► Vue Chat bubble
    │
    └─ tool call
           │
           ▼
      [Policy + toolApproval] ── allow / user-approval / deny
           │
           ▼
      [Tool Execute] ── fs | terminal | git | github | browser | system | mcp.*
           │
           ▼
      [Result append] ── loop until stop / cancel / max steps
```

关键：`toolApproval` 使用 AI SDK 两段式人工确认；可选 HMAC secret 防伪造。MCP 工具叠加 allowlist 与 `detectToolDrift`。

## 工具契约

```ts
interface ToolDefinition {
  name: string;                 // e.g. "fs.read", "mcp.<server>.<tool>"
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema / Zod
  risk: "read" | "write" | "exec" | "network";
}

interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  signal: AbortSignal;
  confirm(prompt: string): Promise<boolean>;
  emit(event: ToolProgressEvent): void;
}
```

## 浏览器理解数据流

```
UI BrowserPanel ──ipc──► Main
                           │
                     WebContentsView.webContents
                           ├─ executeJavaScriptInIsolatedWorld
                           ├─ capturePage
                           └─ debugger (CDP)
                           │
                     extract { title, text, links, a11y }
                           │
UI ◄──ipc── Agent tool browser.extract 结果
```

## 模块边界

| 包 | 可依赖 | 不可依赖 |
|----|--------|----------|
| `shared` | 无 | 一切业务包 |
| `tools/*` | `shared` | UI、agent-core |
| `mcp-client` | `shared` | UI |
| `skills` | `shared` | UI |
| `session` | `shared` | UI |
| `agent-core` | 以上全部 | UI |
| `desktop` | 一切（组合根） | — |
| `ui` | `shared` | 直接 fs/pty/node/electron |

## 安全基线

1. `contextIsolation` + `sandbox` 开启；preload 只经 `contextBridge` 暴露白名单方法。
2. 工具按 risk 分级；`exec`/`write` 出工作区或命中危险模式必须确认。
3. GitHub/LLM token 只进 `safeStorage`，不进渲染进程、不进日志。
4. MCP 进程独立、可杀可重启；tool schema 变更触发 re-approval。
