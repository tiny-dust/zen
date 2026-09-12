# 依赖版本锁定（2026-09-12 npm registry）

> 原则：在 **peer 兼容前提下** 全部钉到当前 npm `latest` 稳定版。  
> 查询时间：2026-09-12 · 见 `research/tech-stack/`

## 硬兼容约束

| 约束 | 结论 |
|------|------|
| electron-vite@5.0.0 peer `vite ^5\|\|^6\|\|^7` | **Vite 钉 7.3.6**，不能上 8.3.0 |
| vue-router@5.3.1 peer `vite ^7.3\|\|^8`、`pinia ^3.0.4\|\|^4.0.2` | 与 Vite 7.3.6 + Pinia 4 对齐 |
| unplugin-vue-router@0.19.2 | **已弃用**，并入 vue-router v5；勿再安装 |
| electron-builder | npm latest=26.15.3，`v26` tag=**26.16.1**；27 仅 alpha |
| TypeScript | npm latest=7.0.2；本栈钉 **5.9.3**（vue-tsc/Volar 生态已验证线） |
| Node | **≥ 22.12**（Vite 7 / electron-vite / AI SDK / @ai-sdk/mcp） |

## 锁定表

### 运行时 / 工具链

| 包 | 版本 | 发布 | 备注 |
|----|------|------|------|
| electron | **44.3.0** | 2026-09-08 | Chromium 152 / Node 24.20 |
| electron-vite | **5.0.0** | 2025-12-07 | peer vite≤7 |
| electron-builder | **26.16.1** | — | 稳定线；勿用 27-alpha |
| electron-updater | **6.8.9** | 2026-06-05 | |
| @electron/rebuild | **4.2.0** | 2026-07-07 | |
| node | **≥22.12** | — | engines |
| pnpm | **12.4.1** | 2026-09-10 | packageManager |
| typescript | **5.9.3** | — | latest 5.x |
| @types/node | **22.20.2** | — | |

### Vue 栈

| 包 | 版本 | 发布 | 备注 |
|----|------|------|------|
| vue | **3.5.42** | 2026-08-27 | |
| pinia | **4.0.3** | 2026-08-12 | major 4 |
| vue-router | **5.3.1** | 2026-09-02 | **内置文件路由** |
| vite | **7.3.6** | — | previous tag；evite 约束 |
| @vitejs/plugin-vue | **6.0.8** | 2026-07-14 | peer vite 5–8 |
| vue-tsc | **3.3.11** | 2026-08-21 | |
| @vue/tsconfig | **0.9.1** | — | |
| @ai-sdk/vue | **4.0.99** | 2026-09-12 | Vue 流式/composables |

### 编辑器 / 终端

| 包 | 版本 |
|----|------|
| codemirror | **6.0.2** |
| @codemirror/view | **6.43.11** |
| @codemirror/state | **6.7.4** |
| @codemirror/commands | **6.11.0** |
| @codemirror/language | **6.12.4** |
| @codemirror/lang-javascript | **6.2.5** |
| @codemirror/lang-json | **6.0.2** |
| @codemirror/lang-markdown | **6.5.2** |
| @codemirror/lang-python | **6.2.1** |
| @codemirror/lang-html | **6.4.12** |
| @codemirror/lang-css | **6.3.1** |
| @codemirror/merge | **6.12.2** |
| @codemirror/theme-one-dark | **6.1.3** |
| vue-codemirror | **6.1.1** |
| @xterm/xterm | **6.0.0** |
| @xterm/addon-fit | **0.11.0** |
| @xterm/addon-webgl | **0.19.0** |
| @xterm/addon-serialize | **0.14.0** |
| node-pty | **1.1.0** |

### Agent / MCP / 工具

| 包 | 版本 | 备注 |
|----|------|------|
| ai | **7.0.99** | Vercel AI SDK；peer zod 3.25.76+ \| 4.1.8+ |
| @ai-sdk/mcp | **2.0.49** | peer zod；node≥22 |
| @modelcontextprotocol/client | **2.0.0** | SDK v2；勿混用 v1 `@modelcontextprotocol/sdk` 作主路径 |
| zod | **4.6.2** | |
| simple-git | **3.36.0** | |
| octokit | **5.0.5** | |
| better-sqlite3 | **13.0.3** | 原生模块 |
| chokidar | **5.0.0** | |
| gray-matter | **4.0.3** | |
| vitest | **5.0.0** | |
| playwright | **1.63.0** | 仅 E2E，非产品浏览器 |

## vue-router 5 文件路由（取代 unplugin-vue-router）

```ts
// apps/ui/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueRouter from 'vue-router/vite'

export default defineConfig({
  plugins: [
    VueRouter({
      // 生成类型建议放在 src 内，便于 tsconfig 自动包含
      dts: 'src/route-map.d.ts',
      routesFolder: 'src/pages',
    }),
    vue(),
  ],
})
```

```ts
// apps/ui/src/router/index.ts
import { createRouter, createWebHashHistory } from 'vue-router'
// 桌面端建议 hash history，避免 file:// 或自定义协议问题
import { routes } from 'vue-router/auto-routes'

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
```

约定：

- 页面目录：`src/pages/**/*.vue`
- 动态段：`[id].vue` → `:id`
- 可选段：`[[id]].vue` → `:id?`
- 布局/扩展：`definePage({ name, meta, ... })`
- Volar 插件（可选）：`vue-router/volar/sfc-typed-router`
- **删除** `unplugin-vue-router` 依赖与 `unplugin-vue-router/client` 类型引用

## 相对上一版 TECH_STACK 的修正

| 项 | 旧 | 新 |
|----|----|----|
| vue-router | 4.x 手写 routes | **5.3.1 文件路由** |
| pinia | ^3 | **4.0.3** |
| vite | ^5.4 | **7.3.6**（evite 禁 8） |
| electron-builder | ^27（错误） | **26.16.1**（27 仅 alpha） |
| @electron/rebuild | ^3.7 | **4.2.0** |
| ai | ^7 泛写 | **7.0.99** |
| @ai-sdk/mcp | ^7 泛写（错） | **2.0.49** |
| mcp | sdk 泛写 | **@modelcontextprotocol/client 2.0.0** |
| zod | ^3 | **4.6.2** |
| octokit | ^4 | **5.0.5** |
| better-sqlite3 | ^11 | **13.0.3** |
| chokidar | ^4 | **5.0.0** |
| node-pty | ^1.1 泛写 | **1.1.0** |
| typescript | ^5.6 | **5.9.3** |
| @ai-sdk/vue | 无 | **4.0.99**（新增） |
| pnpm | 9.15 | **12.4.1** |

## 升级时注意

1. **Vite 8**：等 electron-vite 放开 peer 后再升。
2. **TypeScript 7**：npm latest 已是 7.0.2；待 vue-tsc/Volar 官方标注支持后再切。
3. **electron-builder 27**：仅 alpha；文档里的 v27 行为勿当生产基线。
4. **原生模块**：`node-pty`、`better-sqlite3` 每次升 Electron 后 `@electron/rebuild`。
5. **AI SDK**：`ai` 与 `@ai-sdk/*` 需同 major 线；当前 `ai@7` + `@ai-sdk/mcp@2` + `@ai-sdk/vue@4`。
