# 在线更新（临时开放功能）

状态: 临时开放（Beta）。通用更新源（generic provider），前期只保证局域网或本机可用，不做 CDN/签名发布。

## 组成

- 更新源地址是**应用设置**（`updateFeedUrl`，设置 → 通用 → 软件更新），默认 `http://127.0.0.1:8899`；清空表示不启用。
- main 进程 `apps/desktop/src/main/updater.ts` 封装 electron-updater：手动检查 → 发现新版本 → 手动下载（带进度）→「立即安装并重启」或退出时自动安装。
- 更新源就是一个静态目录，electron-updater 按 generic 协议拉取：

```
<更新源>/
├── latest-mac.yml              # 版本清单（版本号 + sha512 + 文件名）
├── Zen-<ver>-arm64-mac.zip     # 更新包（mac 走 zip）
└── Zen-<ver>-arm64-mac.zip.blockmap  # 差量下载用
```

## 发布一个新版本

```bash
# 1. 改版本号（apps/desktop/package.json 的 version）
# 2. 构建并打包：release/ 下会生成 latest-mac.yml + zip/dmg + blockmap
pnpm build && pnpm --filter @zen/desktop package
# 3. 启动内置更新源静态服务（apps/desktop/scripts/updates-server.mjs，支持 Range 差量）
pnpm updates:serve        # 或 PORT=9000 指定端口
# 4. 客户端设置里填 http://<本机或局域网IP>:8899，点「检查更新」
```

## 约束与注意

- 应用内置默认更新源 `http://127.0.0.1:8899`（`DEFAULT_UPDATE_FEED_URL`，与 updates-server 端口约定一致）；清空设置里的地址表示不启用。

- 开发模式（electron-vite dev）不支持在线更新，UI 会提示使用打包版本。
- macOS 未配置 Developer ID 证书，打包为 ad-hoc 签名；跨机器分发时 macOS Gatekeeper 会拦截（右键打开），正式分发前需要接签名与公证。
- `package.json` 的 `build.publish` 只是让 electron-builder 生成 `latest-mac.yml`；运行时实际拉取地址以应用设置里的 `updateFeedUrl` 为准（`autoUpdater.setFeedURL` 覆盖）。
- 同一台机器自测：起 `python3 -m http.server` 后填 `http://127.0.0.1:8899`。
- 差量下载依赖 blockmap；若换目录/改名导致 blockmap 404，electron-updater 会自动回退全量下载。
