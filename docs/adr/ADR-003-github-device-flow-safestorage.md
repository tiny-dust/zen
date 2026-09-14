# ADR-003: GitHub 认证使用 App Device Flow + safeStorage

- 状态: Accepted（2026-09-14 再确认为 Device Flow）
- 日期: 2026-09-12

## 背景

桌面端需要 GitHub 登录；初稿曾提及 keytar。调研确认 keytar 已于 2022-12 归档，且 GitHub 官方推荐 GitHub App。

## 决策

1. 认证：**GitHub App + OAuth Device Flow**（Octokit `oauth.createToken({ onVerification })`）。
2. 开发期允许 PAT 兜底，产品路径不用 OAuth App-only。
3. Token 存储：Electron **safeStorage async API**；禁止 keytar。
4. 生命周期：`ghu_` 默认 8h + `ghr_` refresh 6mo，由 tools/github 统一刷新。

## 后果

- 需注册 GitHub App 并配置 client_id。
- Linux 无 Secret Service 时探测 `basic_text`，UI 提示安全降级。

## 复议条件

- 企业客户要求 GitHub Enterprise Server 多实例。
- 必须使用带 client_secret 的 loopback web flow 作为唯一路径。

## 2026-09-14 修订记录

- 先因 VS Code 式 UX 短暂切到 loopback Web flow；随后确认桌面场景仍采用 **GitHub 官方推荐的 Device Flow**（仅 Client ID，无 secret）。
- 实现：`apps/desktop/src/main/github-auth.ts`；配置：`docs/auth/github-oauth-setup.md`。
- UI 通过 `auth:device-code` 展示 `user_code`，并打开 `verification_uri_complete` 以尽量预填。
