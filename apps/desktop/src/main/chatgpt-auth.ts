import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";

import { shell } from "electron";

import { getDb } from "./model-db-connection";
import { decryptSecret, encryptSecret } from "./secret";

import type { ChatGptAuthStatus } from "@zen/shared";

/**
 * ChatGPT 账号 OAuth 登录（对齐 Codex CLI 的认证协议）：
 * - 授权端点 auth.openai.com/oauth/authorize + PKCE(S256) + state
 * - 本地 127.0.0.1 回调服务（Codex 同款端口 1455，被占用回落 1457——两者都在
 *   Hydra redirect URI 白名单内）
 * - code 换 token 走 form 编码；刷新走 JSON 编码（auth.openai.com 的差异行为，
 *   见 codex-rs login/src/auth/manager.rs）
 * - 令牌（access/refresh/id）经 aes:v1 加密存 model_providers 行，随 provider 走
 *
 * client_id 是 Codex CLI 的公开 OAuth app id（客户端 OAuth 无秘密可言，Codex 开源
 * 仓库同样内置）；真正的凭据保护靠 PKCE + 本地回调。
 */

const OAUTH_ISSUER = "https://auth.openai.com";
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_SCOPE = "openid profile email offline_access";
const CALLBACK_PORT = 1455;
const CALLBACK_FALLBACK_PORT = 1457;
/** access_token 到期前 5 分钟内触发刷新 */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** 本地回调服务整体超时（浏览器一直不回来则放弃） */
const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** access_token 过期时间（ms epoch；由 expires_at claim 推出，未知为 0） */
  expiresAt: number;
  email?: string;
  accountId?: string;
  planType?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlJson(input: string): Record<string, unknown> | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** 解析 id_token JWT claims：email / 账号 id / 订阅类型（codex-rs token_data 同款路径） */
export function parseIdTokenClaims(idToken: string): {
  email?: string;
  accountId?: string;
  planType?: string;
  expiresAt: number;
} {
  const part = idToken.split(".")[1];
  const claims = part ? b64urlJson(part) : null;
  if (!claims) {
    return { expiresAt: 0 };
  }
  const profile = claims["https://api.openai.com/profile"] as { email?: string } | undefined;
  const auth = claims["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string; chatgpt_plan_type?: string }
    | undefined;
  const exp = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  return {
    email: typeof claims.email === "string" ? claims.email : profile?.email,
    accountId: auth?.chatgpt_account_id,
    planType: auth?.chatgpt_plan_type,
    expiresAt: exp,
  };
}

// ---------- 令牌存取（model_providers 行） ----------

function readTokensRow(providerId: string): { authMode: string | null; oauthEnc: string | null } {
  const row = getDb()
    .prepare(`SELECT auth_mode AS authMode, oauth_enc AS oauthEnc FROM model_providers WHERE id = ?`)
    .get(providerId) as { authMode: string | null; oauthEnc: string | null } | undefined;
  return row ?? { authMode: null, oauthEnc: null };
}

async function saveTokens(providerId: string, tokens: StoredTokens): Promise<void> {
  const enc = await encryptSecret(JSON.stringify(tokens));
  getDb()
    .prepare(
      `UPDATE model_providers
       SET auth_mode = 'chatgpt-oauth', oauth_enc = ?, oauth_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(enc, Date.now(), Date.now(), providerId);
}

async function loadTokens(providerId: string): Promise<StoredTokens | null> {
  const row = readTokensRow(providerId);
  if (!row?.oauthEnc) {
    return null;
  }
  try {
    const parsed = JSON.parse(await decryptSecret(row.oauthEnc)) as StoredTokens;
    return parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

function clearTokens(providerId: string): void {
  getDb()
    .prepare(
      `UPDATE model_providers
       SET oauth_enc = NULL, oauth_updated_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(Date.now(), providerId);
}

// ---------- 对外状态与凭据解析 ----------

export async function getChatGptAuthStatus(providerId: string): Promise<ChatGptAuthStatus> {
  const tokens = await loadTokens(providerId);
  if (!tokens) {
    return { loggedIn: false, expiresAt: 0 };
  }
  return {
    loggedIn: true,
    email: tokens.email,
    accountId: tokens.accountId,
    planType: tokens.planType,
    expiresAt: tokens.expiresAt,
  };
}

/** 刷新去重：同 provider 并发解析只发一次刷新请求（refresh token 轮换下重放即失效） */
const inflightRefresh = new Map<string, Promise<StoredTokens> | null>();

async function refreshTokens(providerId: string, tokens: StoredTokens): Promise<StoredTokens> {
  const response = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: OAUTH_CLIENT_ID,
      refresh_token: tokens.refreshToken,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
  if (!response.ok || !data.access_token) {
    // refresh token 失效（登出/轮换丢失/长期离线）：清掉本地令牌，提示重新登录
    clearTokens(providerId);
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`ChatGPT 登录已失效（${detail}），请重新登录`);
  }
  const idToken = data.id_token || tokens.idToken;
  const claims = parseIdTokenClaims(idToken);
  const next: StoredTokens = {
    accessToken: data.access_token,
    // auth.openai.com 的刷新响应可能不回传 refresh_token（未轮换），沿用旧值
    refreshToken: data.refresh_token || tokens.refreshToken,
    idToken,
    expiresAt: claims.expiresAt || Date.now() + (data.expires_in ?? 3600) * 1000,
    email: claims.email ?? tokens.email,
    accountId: claims.accountId ?? tokens.accountId,
    planType: claims.planType ?? tokens.planType,
  };
  await saveTokens(providerId, next);
  return next;
}

/**
 * 解析可用凭据：临近过期（或已过期）先刷新。返回 access_token 与账号 id；
 * 未登录抛错（调用方决定提示登录）。
 */
export async function resolveChatGptCredentials(
  providerId: string,
): Promise<{ accessToken: string; accountId?: string }> {
  const row = readTokensRow(providerId);
  if (row?.authMode !== "chatgpt-oauth") {
    throw new Error("该供应商未启用 ChatGPT 登录");
  }
  let tokens = await loadTokens(providerId);
  if (!tokens) {
    throw new Error("ChatGPT 未登录，请到设置页完成登录");
  }
  if (tokens.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
    const existing = inflightRefresh.get(providerId);
    const task =
      existing ??
      refreshTokens(providerId, tokens).finally(() => inflightRefresh.delete(providerId));
    inflightRefresh.set(providerId, task);
    tokens = await task;
  }
  return { accessToken: tokens.accessToken, accountId: tokens.accountId };
}

// ---------- 登录流程（本地回调 + 浏览器授权） ----------

let loginInFlight: Promise<ChatGptAuthStatus> | null = null;

const SUCCESS_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录成功</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#1f2328}
.card{text-align:center}h1{font-size:20px}p{color:#57606a}</style></head>
<body><div class="card"><h1>登录成功</h1><p>已连接 Zen 桌面端，可以关闭此页返回应用。</p></div></body></html>`;

const ERROR_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录失败</title></head>
<body><h1>登录失败</h1><p id="msg">授权未完成，请回到 Zen 重试。</p>
<script>const m=new URLSearchParams(location.search).get("error_description")||new URLSearchParams(location.search).get("error");if(m)document.getElementById("msg").textContent=decodeURIComponent(m);</script></body></html>`;

async function exchangeCode(code: string, redirectUri: string, verifier: string): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OAUTH_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`授权码换取令牌失败：${detail}`);
  }
  return data;
}

/** 单次监听尝试：成功/失败都收敛为 boolean（失败不抛错，供端口回落重试） */
function listenOn(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      cleanup();
      resolve(false);
    };
    const onListening = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.on("error", onError);
    server.on("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * 发起 ChatGPT OAuth 登录：起本地回调服务 → 打开系统浏览器授权 →
 * code 换 token → 加密落库。并发调用复用同一次流程。
 */
export async function chatgptLogin(providerId: string): Promise<ChatGptAuthStatus> {
  if (loginInFlight) {
    return loginInFlight;
  }
  loginInFlight = (async () => {
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(24));

    const server = http.createServer();
    if (
      !(await listenOn(server, CALLBACK_PORT)) &&
      !(await listenOn(server, CALLBACK_FALLBACK_PORT))
    ) {
      throw new Error(`本地回调端口 ${CALLBACK_PORT}/${CALLBACK_FALLBACK_PORT} 被占用，无法发起登录`);
    }
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

    const finish = new Promise<{ code: string; state: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("登录超时：浏览器未在 5 分钟内完成授权"));
      }, LOGIN_TIMEOUT_MS);
      server.on("request", (req, res) => {
        const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        const code = url.searchParams.get("code");
        const callbackState = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (error) {
          res.end(ERROR_PAGE);
          clearTimeout(timer);
          reject(new Error(`授权被拒绝：${error}`));
          return;
        }
        res.end(SUCCESS_PAGE);
        if (code && callbackState === state) {
          clearTimeout(timer);
          resolve({ code, state: callbackState });
        } else {
          clearTimeout(timer);
          reject(new Error("授权回调校验失败（state 不匹配）"));
        }
      });
    });

    const authorizeUrl =
      `${OAUTH_ISSUER}/oauth/authorize?` +
      new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        // Codex 同款简化登录参数：授权页直接进入 ChatGPT 账号流程
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
      }).toString();

    try {
      await shell.openExternal(authorizeUrl);
      const { code } = await finish;
      const tokens = await exchangeCode(code, redirectUri, verifier);
      const claims = parseIdTokenClaims(tokens.id_token || "");
      await saveTokens(providerId, {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || "",
        idToken: tokens.id_token || "",
        expiresAt: claims.expiresAt || Date.now() + (tokens.expires_in ?? 3600) * 1000,
        email: claims.email,
        accountId: claims.accountId,
        planType: claims.planType,
      });
      return getChatGptAuthStatus(providerId);
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  })().finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

/** 退出登录：清除本地令牌（不动供应商与模型配置） */
export function chatgptLogout(providerId: string): void {
  clearTokens(providerId);
}
