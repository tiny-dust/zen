# GitHub Device Flow（官方推荐）

Zen 桌面端使用 **GitHub 推荐的 OAuth Device Flow**（RFC 8628），适合 CLI / 桌面应用：

- 只需 **Client ID**，**不需要 Client Secret**
- 应用内展示设备码，并打开 `verification_uri_complete`（多数情况下浏览器会预填 code）
- 轮询获取 token，经 **safeStorage** 加密落盘

## 体验流程

1. 点击侧边栏「点击进行 GitHub 授权」
2. Zen 申请 device code，侧边栏显示 `XXXX-XXXX`
3. 自动打开浏览器到 GitHub（URL 带完整 code，通常不用手输）
4. 若页面未预填，手动输入侧边栏里的设备码并确认
5. Zen 轮询成功后写入登录态

## 1. 创建 GitHub App（一次）

纯桌面、无官网也可注册。GitHub 只要求一个合法 URL，**不要求产品主页真实存在**。

1. 打开 <https://github.com/settings/apps> → **New GitHub App**
2. 字段建议（离线桌面应用）：
   - **GitHub App name**：唯一、仅字母数字与 `-`（如 `zen-desktop-dev`）
   - **Homepage URL**：仓库/个人主页/任意合法 HTTPS URL
   - **User authorization callback URL**：Device Flow **不用**，可留空
   - **Webhook**：留空并取消 Active
3. **重要：开启 Device Flow**  
   GitHub App 默认**不**启用 Device Flow。创建时或创建后在 App 设置页勾选  
   **Enable Device Flow**（通常在 “Identifying and authorizing users” / 用户授权相关区块）。  
   未勾选时会报错：`Device flow must be explicitly enabled for this app`
4. 保存后记下 **Client ID**（**不要** Generate client secret）
5. 可选：Permissions 按需最小化（仅验证登录身份时可不勾业务权限）

也可使用 **OAuth App**（Developer settings → OAuth Apps）：

- Homepage URL：同上，仓库/个人主页即可
- **Authorization callback URL**：注册时 GitHub **强制要求**，但 Device Flow **不会用到**  
  可填占位 HTTPS 地址，例如 `https://example.com/callback` 或 `https://github.com/<you>`
- 记下 Client ID 即可

> 授权页上展示的是你填的 App name / Homepage，所以建议用真实仓库名，避免看起来像钓鱼。

## 2. 配置环境变量

electron-vite **只注入带前缀的变量**进主进程，请使用 `MAIN_VITE_`：

本机配置（推荐，已 gitignore）：

```bash
cp apps/desktop/.env.example apps/desktop/.env.local
# 编辑 .env.local：
# MAIN_VITE_GITHUB_CLIENT_ID=Iv23liOhaQpaMp6DyRzc
```

也可用 shell 环境变量（无前缀，走 process.env）：

```bash
export GITHUB_CLIENT_ID="你的 Client ID"
# OAuth App 可选 scope，默认 read:user
# export GITHUB_OAUTH_SCOPES="read:user"

pnpm --filter @zen/desktop dev
```

读取顺序：`process.env.GITHUB_CLIENT_ID` → `import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID` → `VITE_GITHUB_CLIENT_ID`。

## 3. 安全说明

- Access / refresh token 仅在主进程，经 Electron **safeStorage** 加密后写入 `userData/auth.json`
- 渲染进程只拿到 `AuthState` / `DeviceCodeInfo`（用户码、验证链接），不接触 token
- 不要把 Client ID 以外的密钥写进仓库；Device Flow 本身不需要 secret

## 4. 完全不想注册 App？

Device Flow 仍需要 Client ID。若希望零注册，可另做兜底（未实现则只能走 App）：

| 方式 | 配置 | 说明 |
|------|------|------|
| **PAT 粘贴** | Settings → Developer settings → Personal access tokens | 用户自己生成 `ghu_`/`gho_`/`github_pat_` 并粘贴进 App |
| **复用 gh CLI** | 已执行过 `gh auth login` 的机器 | 读 `gh auth token`，零 App 配置 |

产品默认仍推荐 Device Flow；PAT/gh 适合开发期兜底。

## 5. 相关代码

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/main/github-auth.ts` | device code、轮询、safeStorage |
| `apps/desktop/src/main/user-ipc.ts` | `auth:login` / `auth:logout` / `auth:device-code` |
| `apps/ui/src/stores/user.ts` | 登录中展示设备码与错误 |
