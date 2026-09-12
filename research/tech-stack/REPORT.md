# Zen 技术栈深度调研报告（UI = Vue 3）

> Generated 2026-09-12 · depth: standard · 5 angles · 67 findings · workspace: research/tech-stack/

## Executive summary

1. **壳层锁定 Electron 44.x + electron-vite 5 + Vue 3 + Pinia 3**；安全默认必须 `contextIsolation` + `sandbox` + 仅经 `contextBridge` 的白名单 IPC [1][2][3][5][13]。
2. **electron-builder v27** 成为打包基线：Node ≥ 22.12、原生 ESM、`asar: true` 写法移除、Windows 用 **NSIS**（不可用 Squirrel.Windows）、macOS 自动更新必须签名且保留 **zip** target [11][12][43]。
3. **编辑器选 CodeMirror 6 + `vue-codemirror`**（对齐 Zen「极致精简」）：体积比 Monaco 小一个数量级，且有维护中的 Vue3 官方向封装；diff 用 `@codemirror/merge` [16][17][19][22]。Monaco 仅在强 LSP/Diff 产品面时再评估。
4. **终端锁定 `@xterm/xterm` 6 + `node-pty` 1.1**（VS Code 同源）；一 session 一 Terminal + 一 pty；WebGL addon 需处理 `onContextLoss` [24][25][27]。
5. **Agent 运行时用 Vercel AI SDK v7**（`ToolLoopAgent`、`toolApproval`、`@ai-sdk/mcp`、`fingerprintTools`）；MCP 用官方 **TS SDK v2** + 2026-07-28 **无状态**规范，本地 stdio / 远程 Streamable HTTP [28][30][31][32][34][35][36]。
6. **内置浏览器用 Electron `WebContentsView` + `executeJavaScript`/`Debugger`(CDP)**，不用 Playwright 作为产品路径（`_electron` 仅为实验性测试 API）[37][38][39]。
7. **Git 用 `simple-git`**（包装系统 git）；**GitHub 认证用 GitHub App Device Flow + Octokit**，token 存 **`safeStorage`**（**禁用已归档 keytar**）[41][42][44][45][46][47][48]。
8. **Skills 对齐 Agent Skills 开放标准**（`SKILL.md` + 渐进披露），兼容 Claude Code / Cursor 目录发现模式 [49][50][51][52][53]。
9. **会话：JSONL 逐条追加 + better-sqlite3（WAL）做索引/检索**；对话原文格式视为内部不稳定面 [54][55][58]。
10. Tauri（Cline Desktop 采用）体积更优，但 MCP/PTY/Monaco-or-CM/Vue 工具链在 Electron 更成熟；**v1 维持 Electron** [56]。

## Background & scope

Zen 是代码编程类 AI Agent 桌面产品，必须覆盖文件编辑、终端、内置浏览器理解、MCP、Skills、系统能力、GitHub 认证、Git 操作。UI 强制 Vue 3。本报告基于 2025–2026 一手文档/官方源，直接指导 monorepo 初始化与 `TECH_STACK.md` 改写。

## 最终选型表

| 层 | 敲定 | 版本基线 | 主要否决 |
|----|------|----------|----------|
| 桌面壳 | **Electron** | 44.x（Chromium 152 / Node 24） | Tauri（生态绕路，v1 不选） |
| 构建 | **electron-vite** | 5.x；Node 20.19+/22.12+，推荐 **22.12+** | 手写 Vite 三分包 |
| UI | **Vue 3** + Vite | 3.x | React（用户强制 Vue） |
| 状态 | **Pinia** | 3.x | Vuex |
| 编辑器 | **CodeMirror 6** + `vue-codemirror` | CM6 + vue-codemirror 6.x | Monaco（体积大、无一等 Vue 封装） |
| Diff | **@codemirror/merge** | 6.x | Monaco DiffEditor（除非产品强依赖） |
| 终端 | **@xterm/xterm** + fit/webgl + **node-pty** | xterm 6 / node-pty 1.1 | 无 pty 的伪终端 |
| Agent | **Vercel AI SDK v7** | ToolLoopAgent + toolApproval | LangChain 作核心 |
| MCP | **@modelcontextprotocol/client v2** + `@ai-sdk/mcp` | spec 2026-07-28 | 自研协议；SSE-only |
| 浏览器 | **WebContentsView** + CDP Debugger | Electron 内建 | Playwright 产品路径 |
| Git | **simple-git** | 包装系统 `git` | isomorphic-git（无 wire v2） |
| GitHub | **GitHub App Device Flow** + **Octokit** | `ghu_` 8h + `ghr_` 6mo | OAuth App；web-only flow |
| 密钥 | **safeStorage**（async） | Electron 内建 | keytar（2022 已归档） |
| Skills | **Agent Skills 标准** | SKILL.md 规范 | 私有格式 |
| 会话 | **JSONL + better-sqlite3** | WAL | 仅 SQLite 无原文 |
| 打包 | **electron-builder v27** + updater | NSIS / DMG+zip / AppImage | Squirrel.Windows；Forge+evite 默认 out |
| 测试 | Vitest + Playwright E2E（测自身） | — | 把 Playwright 当产品浏览器 |

## 分主题结论

### 1. Electron + Vue 3 工程

- Electron 稳定版 **44.3.0**（2026-09-09），支持策略为最近 3 个 stable major [1]。
- 安全：`contextIsolation`（12+ 默认）与 `sandbox`（20+ 默认）不可关；关 isolation 会连带关 sandbox [2]。IPC 只用 `invoke/handle` + `contextBridge` 按通道暴露，禁止把整个 `ipcRenderer` 丢给渲染进程 [3]；官方推荐 `Window` 接口 `.d.ts` 增强做类型化 [4]。
- **electron-vite 5** 是 Vue3 Electron 事实标准脚手架（`create @quick-start/electron --template vue-ts`），主进程/preload/renderer 一体构建，支持 HMR；**sandboxed preload 必须 `externalizeDeps: false`**，原生 `.node` 仍须 external [5][6]。
- 与 Forge 共存时 outDir 冲突（Forge 强制 `out`），evite 需 `--outDir=dist`；**推荐直接 electron-builder** [7]。
- 原生模块（`node-pty`、`better-sqlite3`）必须 `@electron/rebuild`，每次升级 Electron 后 rebuild；Windows 需 `win_delay_load_hook` [8]。
- **electron-builder v27**：Node ≥ 22.12、原生 ESM、`nativeModules` 分组、`asar: { unpack: ['**/*.node'] }`，可 `migrate-schema` [11]。Electron 44 已移除 Win ia32 / Linux armv7l [14]。
- Pinia 为 Vue3 官方默认状态库（v3.x，2025 起 drop Vue2）[13]。

### 2. 编辑器与终端（精简向）

Monaco 0.56 功能强（原生 lsp 命名空间、tree-shakeable ESM、advanced diff），但 npm unpacked **~93MB / 1909 files** [17][18][20]。CodeMirror 6 核心包合计约 **2MB 级**，模块化按语言 opt-in [19][21]。Vue 集成：`vue-codemirror` 6.x 维护良好、Vue3-only；Monaco 无一等 Vue 封装 [22]。Diff：CM 有 `@codemirror/merge`（split/unified）[20]。

**Zen 定案：CodeMirror 6 + vue-codemirror + @codemirror/merge。** 理由：产品名即「极致精简」；编码 Agent 主路径是读写与 apply diff，不是完整 IDE LSP。若后续强需求 LSP，再评估 Monaco 0.56 `lsp` 命名空间（不必回到 AMD）[18]。

终端：**xterm.js 6 + node-pty 1.1** 为桌面生产正确组合；xterm 不是 shell，必须接 pty [24]。Fit/WebGL 官方 addon；WebGL 需 `onContextLoss` dispose [25]。多终端 = 多 Terminal 实例 + 多 pty；node-pty **非线程安全**，勿跨 worker_threads [26][27]。

### 3. Agent 运行时与 MCP

- **AI SDK v7** 提供多 Provider、流式、tool-calling（Zod/JSON Schema）、`stopWhen` 多步、`prepareStep` 压缩上下文；**`toolApproval` 四态**（含 `user-approval`）是一等确认机制，旧 `needsApproval` 已弃用；人工确认是 **两段式调用** [28][29][30]。
- `experimental_toolApprovalSecret` 对 approval 做 HMAC，防止客户端伪造历史绕过确认 [31]。
- `@ai-sdk/mcp` 支持 HTTP（生产推荐）/SSE/stdio，并可复用官方 transport；**MCP annotations 不可信**，必须叠加 allowlist + 自有策略 [33][36]。
- **`fingerprintTools` + `detectToolDrift`** 防 MCP tool schema「rug pull」[37]。
- MCP TS SDK **v2**（`@modelcontextprotocol/client`）实现 **2026-07-28 无状态**规范；传输仅 **stdio** 与 **Streamable HTTP** 两条标准轨 [32][33][34]。桌面本地产物用 stdio，远程用 HTTP。
- **`ToolLoopAgent`** 为推荐 Agent 类；`HarnessAgent` 可外挂 Claude Code/Codex 作对照实现，非 Zen 主路径 [38]。
- Elicitation（server 在 tool 执行中要用户输入）必须在 App 层处理 accept/decline [39]。

### 4. 浏览器理解 + Git + GitHub

- **BrowserView 已弃用** → **`WebContentsView`** [40]。产品内浏览器理解用 `executeJavaScript` / `executeJavaScriptInIsolatedWorld` / `capturePage` + **Debugger (CDP)**，无需第二套浏览器进程 [41]。
- Playwright `_electron` **实验性**且面向测试自动化，**不作产品浏览器** [42]。
- **simple-git** 依赖系统 `git`，符合桌面「复用用户真实 git/hooks/LFS」预期；isomorphic-git **无 wire protocol v2** 且 add 需显式路径 [44][45]。
- GitHub 官方建议 **GitHub App** 而非 OAuth App（细粒度权限、短时 token）[46]。桌面明确推荐 **Device Flow**（无 client_secret，user_code 8 位，900s）[47]。备选：loopback `127.0.0.1` + PKCE S256（需 client_secret）[48]。用户 token `ghu_` 默认 **8h**，refresh `ghr_` **6mo** [50]。
- **Octokit** 内建 device flow：`app.oauth.createToken({ onVerification })` [51]。
- 密钥：**safeStorage async API**；无密钥环时 Linux 会落到 `basic_text` 明文，必须 `getSelectedStorageBackend()` 探测 [52]。**keytar 2022-12-15 已归档** [53]。

### 5. Skills、存储、分发

- **Agent Skills 开放标准**：目录 + 必填 `SKILL.md`；`name` 1–64 且与目录名一致，`description` 1–1024；**三层渐进披露**（~100 token 元数据 → 激活后 body <5k token → scripts 按需）[49][50]。已被 Claude Code / Cursor / Copilot / VS Code 等广泛采用 [51]。
- 发现层可抄 Claude/Cursor：用户 `~/…/skills/`、项目 `.zen|claude|cursor/skills/`、兼容读取 `.claude/skills` 等 [52][53]。
- 会话：Claude Code 用 **JSONL append-only**，路径 sanitize，**格式不稳定**只作导出/调试面 [54]。Zen 采用 **JSONL 原文 + better-sqlite3 索引**（WAL）[58]。
- 打包：**electron-updater**；macOS DMG+**zip**（Squirrel.Mac 要签名）；Windows **NSIS only**；Linux AppImage/DEB/RPM；渠道 latest/beta/alpha + `stagingPercentage` [59][60]。macOS 未签名则 safeStorage/autoUpdater 等直接坏 [61]。
- 竞品：Cline Desktop 为 Tauri+Bun+Next.js [56]——证明小体积可行，但不改变 Zen v1 的 Electron 决策（MCP/PTY/Vue 桌面工具链成熟度）。

## 与初版选型的差异（必须改文档处）

| 项 | 初版 | 调研后定案 |
|----|------|------------|
| UI | React 18 | **Vue 3 + Pinia 3** |
| 编辑器 | Monaco | **CodeMirror 6 + vue-codemirror** |
| GitHub 密钥 | keytar | **safeStorage**（keytar 已死） |
| GitHub 认证 | OAuth Device Flow 泛写 | **GitHub App + Device Flow + Octokit** |
| 浏览器 | Playwright 优先 | **WebContentsView + CDP**；Playwright 仅 E2E |
| Agent | 自研循环 + AI SDK 可选 | **AI SDK v7 ToolLoopAgent + toolApproval** |
| MCP | 旧 SDK 泛写 | **TS SDK v2 + 2026-07-28 无状态 + stdio/HTTP** |
| Skills | 自定 frontmatter | **兼容 Agent Skills 标准** |
| 打包 | electron-builder 泛写 | **v27：Node22.12+、NSIS、asar unpack** |
| 密钥/keychain | 提及 keytar | 删除 keytar |

## Open questions

1. GitHub App 已创建前，本地开发用 PAT 兜底的 UX 与轮换策略。
2. CM6 相对 Monaco 的「真·shipped payload」尚未在 Vite 产物上实测（调研仅有 unpackedSize 量级）。
3. pnpm workspace + electron-builder v27 `nativeModules` 的 monorepo 重建路径需在首次 `pnpm package` 验证。
4. Linux `basic_text` 时是否禁用「记住 GitHub 登录」。
5. MCP stdio 子进程崩溃重启与 env 隔离策略需在 `mcp-client` 包落地时细化。

## Sources

[1] Electron Releases — https://releases.electronjs.org/  
[2] Electron Security Tutorial — https://www.electronjs.org/docs/latest/tutorial/security  
[3] Electron IPC — https://www.electronjs.org/docs/latest/tutorial/ipc  
[4] Context Isolation / typed API — https://www.electronjs.org/docs/latest/tutorial/context-isolation  
[5] electron-vite Guide — https://electron-vite.org/guide/  
[6] electron-vite Dependency Handling — https://electron-vite.org/guide/dependency-handling  
[7] electron-vite Distribution — https://electron-vite.org/guide/distribution  
[8] Native Node Modules — https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules  
[9] node-pty — https://github.com/microsoft/node-pty  
[10] better-sqlite3 compilation — https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/compilation.md  
[11] electron-builder v27 breaking changes — https://www.electron.build/docs/migration/v27-breaking-changes  
[12] electron-builder Auto Update — https://www.electron.build/docs/features/auto-update  
[13] Pinia — https://pinia.vuejs.org/introduction.html  
[14] electron-builder v27 + Electron 44 arch notes — https://www.electron.build/docs/migration/v27-breaking-changes  
[15] monaco-editor — https://github.com/microsoft/monaco-editor  
[16] monaco-editor CHANGELOG — https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md  
[17] monaco-editor npm registry — https://registry.npmjs.org/monaco-editor/latest  
[18] monaco-languageclient — https://github.com/TypeFox/monaco-languageclient  
[19] CodeMirror Guide — https://codemirror.net/docs/guide/  
[20] codemirror/merge — https://github.com/codemirror/merge  
[21] @codemirror/state & view npm — https://registry.npmjs.org/@codemirror/view/latest  
[22] vue-codemirror — https://github.com/surmon-china/vue-codemirror  
[23] @guolao/vue-monaco-editor — https://github.com/guolao/vue-monaco-editor  
[24] xterm.js — https://github.com/xtermjs/xterm.js/blob/master/README.md  
[25] xterm addon-webgl — https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl  
[26] @xterm/headless — https://github.com/xtermjs/xterm.js  
[27] node-pty thread-safety — https://github.com/microsoft/node-pty  
[28] AI SDK Introduction — https://ai-sdk.dev/docs/introduction  
[29] AI SDK Tools & Tool Calling — https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling  
[30] AI SDK Tool Approvals — https://ai-sdk.dev/docs/agents/tool-approvals  
[31] experimental_toolApprovalSecret — https://ai-sdk.dev/docs/agents/tool-approvals  
[32] MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk  
[33] MCP Transports — https://modelcontextprotocol.io/docs/concepts/transports  
[34] MCP Spec 2026-07-28 — https://modelcontextprotocol.io/specification/2026-07-28/basic/index  
[35] AI SDK MCP Tools — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools  
[36] MCP annotations untrusted — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools  
[37] fingerprintTools / detectToolDrift — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools  
[38] AI SDK Agents Overview — https://ai-sdk.dev/docs/agents/overview  
[39] MCP Elicitation — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools  
[40] WebContentsView — https://www.electronjs.org/docs/latest/api/web-contents-view  
[41] WebContents / Debugger — https://www.electronjs.org/docs/latest/api/web-contents  
[42] Playwright Electron — https://playwright.dev/docs/api/class-electron  
[43] electron-updater targets/channels — https://www.electron.build/docs/features/auto-update  
[44] simple-git — https://github.com/steveukx/git-js  
[45] isomorphic-git FAQ — https://isomorphic-git.org/docs/en/faq  
[46] GitHub Apps vs OAuth Apps — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps  
[47] GitHub Device Flow — https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app  
[48] OAuth loopback + PKCE — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps  
[49] Agent Skills Spec — https://agentskills.io/specification  
[50] Agent Skills progressive disclosure — https://agentskills.io/specification  
[51] Agent Skills adoption — https://agentskills.io  
[52] Claude Code Skills — https://docs.anthropic.com/en/docs/claude-code/skills  
[53] Cursor Skills — https://cursor.com/docs/context/skills  
[54] Claude Code Sessions/JSONL — https://docs.anthropic.com/en/docs/claude-code/sessions  
[55] Claude Code Memory — https://docs.anthropic.com/en/docs/claude-code/memory  
[56] Cline monorepo (Tauri desktop) — https://github.com/cline/cline  
[57] better-sqlite3 — https://github.com/WiseLibs/better-sqlite3  
[58] better-sqlite3 WAL — https://github.com/WiseLibs/better-sqlite3  
[59] electron-updater Windows/macOS targets — https://www.electron.build/docs/features/auto-update  
[60] Release channels — https://www.electron.build/docs/tutorials/release-using-channels  
[61] Electron Code Signing — https://www.electronjs.org/docs/latest/tutorial/code-signing  
[62] safeStorage — https://www.electronjs.org/docs/latest/api/safe-storage  
[63] keytar archived — https://github.com/atom/node-keytar  
[64] Octokit — https://github.com/octokit/octokit.js  
[65] GitHub user token lifetime — https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app  

（全部来源访问日期：2026-09-12；详见 `findings/F1–F5.md`）
