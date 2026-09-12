# 依赖版本调研纪要（2026-09-12）

## 方法

直接查询 `registry.npmjs.org` 的 `dist-tags.latest` 与 `time[version]`，覆盖 Zen 全部运行时与工具链依赖。

## 关键发现

1. **vue-router 5.3.1 已内置文件路由**  
   `unplugin-vue-router@0.19.2` 标注 DEPRECATED：`Merged into vuejs/router`。  
   新入口：`vue-router/vite` 插件 + `vue-router/auto-routes`。  
   迁移指南：https://router.vuejs.org/guide/migration/v4-to-v5.html

2. **electron-vite 5.0.0 的 peer 是 `vite ^5 || ^6 || ^7`**  
   npm latest Vite 为 **8.3.0**，本项目必须钉 **7.3.6**（`previous` tag）。

3. **electron-builder 稳定线是 26.x**  
   `latest=26.15.3`，`v26=26.16.1`，`next=27.0.0-alpha.8`。  
   上一版文档写 v27 为基线是错误的，已纠正为 **26.16.1**。

4. **Major 跳跃**  
   - Pinia **4.0.3**（不再是 3）  
   - zod **4.6.2**  
   - octokit **5.0.5**  
   - better-sqlite3 **13.0.3**  
   - chokidar **5.0.0**  
   - vitest **5.0.0**  
   - @electron/rebuild **4.2.0**  
   - @vitejs/plugin-vue **6.0.8**

5. **AI SDK 包版本不对齐 major 数字**  
   - `ai@7.0.99`  
   - `@ai-sdk/mcp@2.0.49`（不是 7）  
   - `@ai-sdk/vue@4.0.99`（新增，给 Vue 流式）  
   - peer zod：`^3.25.76 || ^4.1.8`

6. **TypeScript**  
   npm latest **7.0.2**（2026-07-08）。  
   vue-tsc peer 仅 `>=5.0.0`，但为稳妥钉 **5.9.3**（5.x latest）。

7. **仍可用的“旧但 latest”**  
   - vue-codemirror **6.1.1**（2022，peer vue 3.x）  
   - gray-matter **4.0.3**（2021）  
   - @codemirror/lang-css **6.3.1**（2024）

## 落地

- 所有 workspace `package.json` 已改为**精确版本**（去掉 `^`）
- 新增 `docs/architecture/VERSIONS.md` 作为唯一版本真源
- `TECH_STACK.md` 已同步纠正 v27 → 26.16、Pinia 4、vue-router 5 文件路由
