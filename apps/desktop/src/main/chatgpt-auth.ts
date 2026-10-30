import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";

import { shell } from "electron";

import { getDb } from "./model-db-connection";
import { decryptSecret, encryptSecret } from "./secret";
import { parseIdTokenClaims, verifyChatGptIdToken } from "./chatgpt-oauth-validation";

import type { ChatGptAuthStatus } from "@zen/shared";

/** Zen 自己的 ChatGPT 计划授权：动态注册客户端 + 回环回调 + PKCE。 */

const OAUTH_ISSUER = "https://auth.openai.com";
const OAUTH_AUTHORIZE_URL = `${OAUTH_ISSUER}/api/accounts/authorize`;
const OAUTH_TOKEN_URL = `${OAUTH_ISSUER}/api/accounts/oauth/token`;
const OAUTH_RESOURCE = "https://api.openai.com/v1";
const OAUTH_SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const CALLBACK_PORT = 1455;
/** access_token 到期前 5 分钟内触发刷新 */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** 本地回调服务整体超时（浏览器一直不回来则放弃） */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const OAUTH_FETCH_TIMEOUT_MS = 15_000;
const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

interface StoredTokens {
  clientId: string;
  subject: string;
  scopes: string[];
  hostId: string;
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
  scope?: string;
  token_type?: string;
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

export { parseIdTokenClaims } from "./chatgpt-oauth-validation";

function scopesFrom(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function hasPlanPermission(scopes: string[]): boolean {
  return scopes.includes("chatgpt.tokens.use.direct");
}

function hostId(): string {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS chatgpt_oauth_host (id INTEGER PRIMARY KEY CHECK (id = 1), host_id TEXT NOT NULL)`);
  const row = db.prepare("SELECT host_id FROM chatgpt_oauth_host WHERE id = 1").get() as { host_id: string } | undefined;
  if (row) return row.host_id;
  const generated = `urn:uuid:${randomUUID()}`;
  db.prepare("INSERT OR IGNORE INTO chatgpt_oauth_host (id, host_id) VALUES (1, ?)").run(generated);
  const saved = db.prepare("SELECT host_id FROM chatgpt_oauth_host WHERE id = 1").get() as { host_id: string };
  return saved.host_id;
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
    const parsed: unknown = JSON.parse(await decryptSecret(row.oauthEnc));
    if (!parsed || typeof parsed !== "object") return null;
    const tokens = parsed as Partial<StoredTokens>;
    // 旧版借用 Codex CLI client_id 的令牌不属于 Zen 的 OAuth 注册，不能继续使用。
    if (
      typeof tokens.clientId !== "string" || !tokens.clientId ||
      typeof tokens.subject !== "string" || !tokens.subject ||
      typeof tokens.hostId !== "string" || !tokens.hostId ||
      !Array.isArray(tokens.scopes)
    ) return null;
    return {
      clientId: tokens.clientId,
      subject: tokens.subject,
      hostId: tokens.hostId,
      scopes: tokens.scopes.filter((scope): scope is string => typeof scope === "string"),
      accessToken: typeof tokens.accessToken === "string" ? tokens.accessToken : "",
      refreshToken: typeof tokens.refreshToken === "string" ? tokens.refreshToken : "",
      idToken: typeof tokens.idToken === "string" ? tokens.idToken : "",
      expiresAt: typeof tokens.expiresAt === "number" ? tokens.expiresAt : 0,
      email: typeof tokens.email === "string" ? tokens.email : undefined,
      accountId: typeof tokens.accountId === "string" ? tokens.accountId : undefined,
      planType: typeof tokens.planType === "string" ? tokens.planType : undefined,
    };
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
  if (!tokens?.accessToken || !tokens.refreshToken || !hasPlanPermission(tokens.scopes)) {
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
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: tokens.clientId,
      refresh_token: tokens.refreshToken,
      resource: OAUTH_RESOURCE,
    }).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
  if (!response.ok || !data.access_token || !data.refresh_token) {
    if (data.error && TERMINAL_REFRESH_ERRORS.has(data.error)) {
      // 只在明确确认 refresh token 不可用时清除会话；注册 ID 留给重新登录。
      await saveTokens(providerId, { ...tokens, accessToken: "", refreshToken: "", idToken: "", expiresAt: 0 });
      throw new Error("ChatGPT 登录已失效，请重新登录");
    }
    // 网络、服务端 5xx、畸形响应与 invalid_client 都不证明用户会话失效。
    throw new Error(`ChatGPT 暂时无法刷新登录状态（HTTP ${response.status}），请稍后重试`);
  }
  const scopes = data.scope ? scopesFrom(data.scope) : tokens.scopes;
  const claims = data.id_token
    ? await verifyChatGptIdToken(data.id_token, tokens.clientId, undefined, tokens.subject)
    : parseIdTokenClaims(tokens.idToken);
  const next: StoredTokens = {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token || tokens.idToken,
    scopes,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: claims.email ?? tokens.email,
    accountId: claims.accountId ?? tokens.accountId,
    planType: claims.planType ?? tokens.planType,
  };
  await saveTokens(providerId, next);
  if (!hasPlanPermission(scopes)) {
    throw new Error("ChatGPT 未授权使用账号计划，请重新登录并允许该权限");
  }
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
  if (!tokens?.accessToken || !tokens.refreshToken || !hasPlanPermission(tokens.scopes)) {
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

const loginInFlight = new Map<string, Promise<ChatGptAuthStatus>>();

const SUCCESS_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>授权已返回</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#1f2328}
.card{text-align:center}h1{font-size:20px}p{color:#57606a}</style></head>
<body><div class="card"><h1>授权已返回</h1><p>Zen 正在验证登录结果，可以关闭此页返回应用查看状态。</p></div></body></html>`;

const ERROR_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>登录失败</title></head>
<body><h1>登录失败</h1><p id="msg">授权未完成，请回到 Zen 重试。</p>
<script>const m=new URLSearchParams(location.search).get("error_description")||new URLSearchParams(location.search).get("error");if(m)document.getElementById("msg").textContent=decodeURIComponent(m);</script></body></html>`;

async function exchangeCode(
  code: string,
  clientId: string,
  redirectUri: string,
  verifier: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: OAUTH_RESOURCE,
  });
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
    body: body.toString(),
  });
  const data = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
  if (!response.ok || !data.access_token || !data.refresh_token || !data.id_token) {
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
  const active = loginInFlight.get(providerId);
  if (active) return active;
  const login = (async () => {
    const previous = await loadTokens(providerId);
    const requestClientId = previous?.clientId ?? REGISTRATION_CLIENT_ID;
    const currentHostId = hostId();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));

    const server = http.createServer();
    if (!(await listenOn(server, CALLBACK_PORT)) && !(await listenOn(server, 0))) {
      throw new Error("本地回调端口不可用，无法发起登录");
    }
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = new Promise<{ code: string; clientId: string | null }>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("登录超时：浏览器未在 5 分钟内完成授权")), LOGIN_TIMEOUT_MS);
      server.on("request", (req, res) => {
        const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404).end();
          return;
        }
        res.setHeader("content-type", "text/html; charset=utf-8");
        const code = url.searchParams.get("code");
        const callbackState = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (callbackState !== state) {
          res.writeHead(400).end(ERROR_PAGE);
          reject(new Error("授权回调校验失败（state 不匹配）"));
          return;
        }
        if (error) {
          res.writeHead(400).end(ERROR_PAGE);
          reject(new Error(`授权被拒绝：${error}`));
          return;
        }
        if (!code) {
          res.writeHead(400).end(ERROR_PAGE);
          reject(new Error("授权回调缺少授权码"));
          return;
        }
        res.writeHead(200).end(SUCCESS_PAGE);
        resolve({ code, clientId: url.searchParams.get("client_id") });
      });
    });
    // 浏览器启动失败时，定时器仍可能拒绝回调 Promise，提前接住该错误。
    void finish.catch(() => undefined);

    const authorizeUrl =
      `${OAUTH_AUTHORIZE_URL}?` +
      new URLSearchParams({
        client_id: requestClientId,
        ext_agent_host_id: currentHostId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPE,
        resource: OAUTH_RESOURCE,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(previous ? {} : { agent_name_hint: "Zen" }),
        ...(previous?.idToken ? { id_token_hint: previous.idToken } : {}),
        ...(previous?.email ? { login_hint: previous.email } : {}),
        ...(previous && !hasPlanPermission(previous.scopes) ? { prompt: "consent" } : {}),
      }).toString();

    try {
      await shell.openExternal(authorizeUrl);
      const callback = await finish;
      const clientId = previous?.clientId ?? callback.clientId;
      if (!clientId || clientId === REGISTRATION_CLIENT_ID || (previous && callback.clientId && callback.clientId !== previous.clientId)) {
        throw new Error("ChatGPT 客户端注册未完成，请重新登录");
      }
      const tokens = await exchangeCode(callback.code, clientId, redirectUri, verifier);
      const claims = await verifyChatGptIdToken(tokens.id_token!, clientId, nonce, previous?.subject);
      const scopes = scopesFrom(tokens.scope);
      if (tokens.token_type && tokens.token_type.toLowerCase() !== "bearer") {
        throw new Error("ChatGPT 返回了不支持的令牌类型");
      }
      await saveTokens(providerId, {
        clientId,
        subject: claims.subject,
        hostId: currentHostId,
        scopes,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        idToken: tokens.id_token!,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        email: claims.email,
        accountId: claims.accountId,
        planType: claims.planType,
      });
      if (!hasPlanPermission(scopes)) {
        // 保留 Zen 的注册 ID 与已验身份；此供应商暂不能使用 ChatGPT 计划推理。
        throw new Error("ChatGPT 未授权使用账号计划，请在授权页允许该权限");
      }
      return getChatGptAuthStatus(providerId);
    } finally {
      if (timeout) clearTimeout(timeout);
      server.close();
      server.closeAllConnections?.();
    }
  })().finally(() => {
    loginInFlight.delete(providerId);
  });
  loginInFlight.set(providerId, login);
  return login;
}

/** 退出登录时先撤销可续期会话；保留注册 ID 供下次登录。 */
export async function chatgptLogout(providerId: string): Promise<void> {
  const tokens = await loadTokens(providerId);
  if (!tokens) {
    clearTokens(providerId);
    return;
  }
  try {
    if (tokens.refreshToken) {
      const discovery = await fetch(`${OAUTH_ISSUER}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
      });
      if (!discovery.ok) throw new Error("无法获取 ChatGPT 登出地址");
      const config = await discovery.json() as { revocation_endpoint?: unknown };
      if (typeof config.revocation_endpoint !== "string" || !config.revocation_endpoint.startsWith(`${OAUTH_ISSUER}/`)) {
        throw new Error("ChatGPT 登出地址无效");
      }
      const response = await fetch(config.revocation_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
        body: new URLSearchParams({
          token: tokens.refreshToken,
          token_type_hint: "refresh_token",
          client_id: tokens.clientId,
        }).toString(),
      });
      if (!response.ok) throw new Error("ChatGPT 远端登出失败");
    }
  } catch (error) {
    throw new Error("已在 Zen 中退出登录，但远端撤销未确认；可到 ChatGPT 设置中断开 Zen", { cause: error });
  } finally {
    await saveTokens(providerId, { ...tokens, accessToken: "", refreshToken: "", idToken: "", expiresAt: 0 });
  }
}
