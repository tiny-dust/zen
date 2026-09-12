# 技术选型（已敲定 · 2026-09-12）

> 依据：`research/tech-stack/REPORT.md` + `docs/architecture/VERSIONS.md`（npm registry 实测）  
> 产品：**Zen** — 极致精简，专注编程 · UI 层强制 **Vue 3**

## 一句话

**Electron 44.3.0 + electron-vite 5.0.0 + Vue 3.5 + Pinia 4 + vue-router 5（文件路由）+ CodeMirror 6 + xterm/node-pty + AI SDK 7 + MCP Client 2 + WebContentsView + simple-git + GitHub App Device Flow + Agent Skills + JSONL/better-sqlite3 13 + electron-builder 26.16。**

完整版本锁定见 [VERSIONS.md](./VERSIONS.md)。

## 决策总表

| 层 | 敲定（精确 latest） | 否决 / 备注 |
|----|---------------------|-------------|
| 桌面壳 | **Electron 44.3.0** | Tauri v1 不选 |
| 工程 | **electron-vite 5.0.0** + pnpm **12.4.1** | 手写三分包；Forge `out` 冲突 |
| UI | **Vue 3.5.42** + **Vite 7.3.6** | React；**Vite 8 不可用**（evite peer ≤7） |
| 状态 | **Pinia 4.0.3** | Vuex；Pinia 3 已过 |
| 路由 | **vue-router 5.3.1 文件路由** | unplugin-vue-router（已并入官方并弃用） |
| 编辑器 | **CodeMirror 6** + **vue-codemirror 6.1.1** | Monaco |
| Diff | **@codemirror/merge 6.12.2** | Monaco DiffEditor |
| 终端 | **@xterm/xterm 6.0.0** + fit/webgl/serialize + **node-pty 1.1.0** | 无 pty 伪终端 |
| Agent | **ai 7.0.99**（ToolLoopAgent + toolApproval） | LangChain 核心 |
| Vue 流式 | **@ai-sdk/vue 4.0.99** | — |
| MCP | **@modelcontextprotocol/client 2.0.0** + **@ai-sdk/mcp 2.0.49** | v1 sdk 作主路径；自研协议 |
| 校验 | **zod 4.6.2** | zod 3 |
| 浏览器 | **WebContentsView** + CDP | Playwright 产品路径 |
| Git | **simple-git 3.36.0** | isomorphic-git |
| GitHub | **GitHub App Device Flow** + **octokit 5.0.5** | OAuth App；keytar |
| 密钥 | **safeStorage** async | keytar 已归档 |
| Skills | **Agent Skills 标准** | 私有格式 |
| 会话 | **JSONL** + **better-sqlite3 13.0.3** | 只存 SQLite |
| 文件监听 | **chokidar 5.0.0** | — |
| 打包 | **electron-builder 26.16.1** + updater **6.8.9** | **27 仅 alpha**；Squirrel.Windows |
| 原生 rebuild | **@electron/rebuild 4.2.0** | — |
| TS | **TypeScript 5.9.3** + **vue-tsc 3.3.11** | TS 7.0.2 待 Volar 确认后再切 |
| 测试 | **Vitest 5.0.0** + Playwright **1.63.0**（仅 E2E） | Playwright 当产品浏览器 |

---

## 1. 壳与工程

| 项 | 值 |
|----|-----|
| Electron | **44.3.0** |
| Node | **≥ 22.12** |
| 构建 | electron-vite **5.0.0**（peer：vite ^5\|\|^6\|\|^7 → **Vite 7.3.6**） |
| 打包 | electron-builder **26.16.1**（勿用 27-alpha） |
| 安全 | `contextIsolation` + `sandbox` + `contextBridge` 白名单 |
| IPC | invoke/handle + `Window` 类型增强 |
| 原生模块 | `@electron/rebuild@4.2.0`；external + `asarUnpack` |

## 2. UI（Vue 3 · 文件路由）

```jsonc
{
  "vue": "3.5.42",
  "pinia": "4.0.3",
  "vue-router": "5.3.1",
  "vite": "7.3.6",
  "@ai-sdk/vue": "4.0.99"
}
```

### vue-router 5 文件路由

`unplugin-vue-router` 已弃用并并入 `vue-router` v5：

```ts
// vite.config.ts
import VueRouter from 'vue-router/vite'

export default {
  plugins: [
    VueRouter({ dts: 'src/route-map.d.ts', routesFolder: 'src/pages' }),
    vue(),
  ],
}

// router
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
```

- 页面：`src/pages/**/*.vue`
- 参数：`[id].vue` / 可选 `[[id]].vue`
- 桌面端 history 推荐 **hash**（`createWebHashHistory`）

## 3. 编辑器与终端

按需安装语言包；一终端 session = 一 Terminal + 一 pty。

## 4–7. Agent / MCP / 浏览器 / Git GitHub

架构不变；版本已按 VERSIONS.md 钉死。注意：

- `@ai-sdk/mcp` 现行为 **2.x**（不是 7.x）
- MCP 主客户端用 **`@modelcontextprotocol/client@2.0.0`**
- 浏览器：WebContentsView + Debugger，不用 Playwright 产品路径

## 8. Skills / 会话 / 打包

- Skills：Agent Skills 标准
- 会话：JSONL + better-sqlite3 **13**
- 打包：electron-builder **26.16**；macOS DMG+zip；Windows **NSIS**；updater **6.8.9**

## 9. 依赖锁定摘要

见各包 `package.json` 精确版本（无 `^`），以及 [VERSIONS.md](./VERSIONS.md)。

## 10. 明确不选

| 项 | 原因 |
|----|------|
| Vite 8.3.0 | electron-vite 5 peer 不支持 |
| TypeScript 7.0.2 | 生态未齐；暂钉 5.9.3 |
| electron-builder 27-alpha | 非稳定 |
| unplugin-vue-router | 已并入 vue-router 5 |
| Pinia 3 / vue-router 4 | 已被 4 / 5 取代 |
| keytar / BrowserView / Squirrel.Windows | 死路 |
| Playwright 产品浏览器 | 仅 E2E |

## 11. 落地顺序

1. P0：electron-vite vue-ts + vue-router5 文件路由 + typed IPC  
2. P1：CodeMirror + xterm/pty + simple-git + ai ToolLoopAgent  
3. P2：MCP client 2 + Skills + GitHub Device Flow  
4. P3：WebContentsView 理解 + merge diff + 权限  
5. P4：electron-builder 26 签名公证 + updater  

## 12. 复议条件

- electron-vite 支持 Vite 8 → 升 Vite 8  
- vue-tsc/Volar 官方支持 TS 7 → 升 TypeScript 7  
- electron-builder 27 转正 → 评估 v27 schema  
- 体积成为阻塞 → Tauri sidecar  
