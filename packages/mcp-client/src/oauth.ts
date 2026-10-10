import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { McpServerConfig } from "@zen/shared";

/**
 * 远程 MCP 的 OAuth 2.1 浏览器授权（RFC 6750/8707/9728 + 动态客户端注册 + PKCE）：
 * 401 挑战里的 resource_metadata → 资源元数据给出 authorization_servers →
 * 拉 AS 元数据 → 动态注册 → 系统浏览器完成授权 → 本地 127.0.0.1 回调收 code → 换 token。
 * 仅依赖 node:crypto / node:http / fetch，Electron 无关（openExternal 由调用方注入）。
 */

export interface McpOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** 绝对过期时间戳（ms） */
  expiresAt?: number;
  scope?: string;
}

export interface McpOAuthRegistration {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  /** RFC 8707 资源标识，换发/刷新时原样回传 */
  resource?: string;
}

export interface McpOAuthResult {
  tokens: McpOAuthTokens;
  registration: McpOAuthRegistration;
}

export interface BrowserAuthOptions {
  /** 连接失败时捕获的 WWW-Authenticate 挑战；缺失则按 well-known 默认路径推导 */
  challenge?: string | null;
  /** 打开系统浏览器（Electron main 注入 shell.openExternal） */
  openExternal(url: string): void;
  /** 等待浏览器回调的最长时间，默认 5 分钟 */
  timeoutMs?: number;
}

interface ResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  grant_types_supported?: string[];
}

interface ClientRegistration {
  client_id: string;
  client_secret?: string;
}

const DEFAULT_CALLBACK_TIMEOUT_MS = 300_000;

function challengeResourceUrl(challenge: string | null | undefined, serverUrl: string): string {
  const quoted = /resource_metadata\s*=\s*"([^"]+)"/i.exec(challenge ?? "");
  if (quoted?.[1]) {
    return quoted[1];
  }
  // RFC 9728 默认路径：在 path 前插入 /.well-known/oauth-protected-resource
  const url = new URL(serverUrl);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）：${url}`);
  }
  return (await response.json()) as T;
}

async function fetchResourceMetadata(url: string): Promise<ResourceMetadata> {
  let metadata: ResourceMetadata;
  try {
    metadata = await fetchJson<ResourceMetadata>(url);
  } catch {
    throw new Error("无法读取服务的 OAuth 资源元数据（resource metadata）");
  }
  if (!metadata.authorization_servers?.length) {
    throw new Error("资源元数据未提供 authorization_servers，无法发起 OAuth 授权");
  }
  return metadata;
}

async function fetchServerMetadata(issuer: string): Promise<AuthorizationServerMetadata> {
  const wellKnown = `${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
  const metadata = await fetchJson<AuthorizationServerMetadata>(wellKnown);
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(`授权服务器元数据缺少端点：${issuer}`);
  }
  return metadata;
}

async function discoverServerMetadata(
  issuers: string[],
): Promise<{ metadata: AuthorizationServerMetadata; scopesSupported?: string[] }> {
  let lastError: Error | null = null;
  for (const issuer of issuers) {
    try {
      const metadata = await fetchServerMetadata(issuer);
      return { metadata };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`无法读取授权服务器元数据：${lastError?.message ?? "无可用 issuer"}`);
}

/** 动态客户端注册（公共客户端 + PKCE）；不支持 DCR 的服务器明确报错并给出手动替代 */
async function registerClient(
  metadata: AuthorizationServerMetadata,
  redirectUri: string,
  scope: string,
): Promise<ClientRegistration> {
  if (!metadata.registration_endpoint) {
    throw new Error(
      "该授权服务器不支持动态客户端注册，请在 MCP 服务的「附加请求头」里手动填写 API Key",
    );
  }
  const registration = await fetchJson<ClientRegistration>(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Zen",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope,
    }),
  });
  if (!registration.client_id) {
    throw new Error("动态客户端注册响应缺少 client_id");
  }
  return registration;
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * 本地回调服务器：随机端口绑定 127.0.0.1，等待 ?code&state；超时自动 reject。
 * 返回 assigned 端口与完成 Promise；close() 取消等待（finally 兜底）。
 */
async function startCallbackServer(
  state: string,
  timeoutMs: number,
): Promise<{ port: number; done: Promise<{ code: string }>; close(): void }> {
  let resolveDone: (value: { code: string }) => void;
  let rejectDone: (reason: Error) => void;
  let server: Server | null = null;
  let timer: NodeJS.Timeout | null = null;
  let settled = false;

  const done = new Promise<{ code: string }>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const finish = (outcome: { code: string } | Error): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    server?.close();
    server = null;
    if (outcome instanceof Error) {
      rejectDone(outcome);
    } else {
      resolveDone(outcome);
    }
  };

  const close = (): void => {
    finish(new Error("授权已取消"));
  };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const page = (message: string): void => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Zen 授权</title>` +
          `<body style="font-family:system-ui,sans-serif;background:#181818;color:#f4f4f5;` +
          `display:grid;place-items:center;height:100vh;margin:0"><p>${message}</p></body>`,
      );
    };
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end();
      return;
    }
    const authError = url.searchParams.get("error");
    if (authError) {
      page("授权未完成，可以关闭此页面回到 Zen。");
      finish(new Error(`授权失败：${authError}${url.searchParams.get("error_description") ?? ""}`));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.get("state") !== state) {
      page("回调参数无效，可以关闭此页面回到 Zen 重试。");
      finish(new Error("授权回调缺少 code 或 state 校验失败"));
      return;
    }
    page("授权完成，可以关闭此页面回到 Zen 继续。");
    finish({ code });
  });

  // address() 要等 listening 事件后才可用，必须 await
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  }).catch(() => {
    throw new Error("本地 OAuth 回调端口监听失败");
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    finish(new Error("本地 OAuth 回调端口分配失败"));
    throw new Error("本地 OAuth 回调端口分配失败");
  }
  timer = setTimeout(() => {
    finish(new Error("授权超时：浏览器回调未在时限内返回，请重试"));
  }, timeoutMs);
  return { port: address.port, done, close };
}

function buildAuthorizeUrl(input: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope: string;
  resource?: string;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.scope) {
    url.searchParams.set("scope", input.scope);
  }
  if (input.resource) {
    url.searchParams.set("resource", input.resource);
  }
  return url.toString();
}

/** scope 取资源元数据声明为主；服务器支持 offline_access 时追加，保证拿到 refresh token */
function pickScope(resource: ResourceMetadata, metadata: AuthorizationServerMetadata): string {
  const scopes = new Set(resource.scopes_supported ?? metadata.scopes_supported ?? []);
  const grants = metadata.grant_types_supported ?? ["authorization_code", "refresh_token"];
  if (grants.includes("refresh_token") && metadata.scopes_supported?.includes("offline_access")) {
    scopes.add("offline_access");
  }
  return [...scopes].join(" ");
}

async function postTokenForm(
  tokenEndpoint: string,
  params: Record<string, string>,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }
    | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(`换取访问令牌失败（HTTP ${response.status}）${body?.error ? `: ${body.error}` : ""}`);
  }
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    scope: body.scope,
  };
}

function toTokens(
  raw: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
): McpOAuthTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_in ? Date.now() + raw.expires_in * 1000 : undefined,
    scope: raw.scope,
  };
}

/** 全流程：元数据 → 动态注册 → 浏览器授权 → 本地回调收 code → 换 token */
export async function runBrowserAuthorization(
  config: McpServerConfig,
  options: BrowserAuthOptions,
): Promise<McpOAuthResult> {
  if (!config.url) {
    throw new Error("远程 server 缺少 url");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  const resource = await fetchResourceMetadata(challengeResourceUrl(options.challenge, config.url));
  const { metadata } = await discoverServerMetadata(resource.authorization_servers ?? []);
  const scope = pickScope(resource, metadata);
  const resourceIndicator = resource.resource;

  const state = randomBytes(16).toString("base64url");
  const pkce = createPkce();
  const callback = await startCallbackServer(state, timeoutMs);
  // 中途失败走 finally close() 取消等待；预挂 catch 防止悬空 rejection（await 处仍拿到真实结果）
  callback.done.catch(() => undefined);
  try {
    const redirectUri = `http://127.0.0.1:${callback.port}/callback`;
    const registration = await registerClient(metadata, redirectUri, scope);
    options.openExternal(
      buildAuthorizeUrl({
        endpoint: metadata.authorization_endpoint,
        clientId: registration.client_id,
        redirectUri,
        state,
        challenge: pkce.challenge,
        scope,
        resource: resourceIndicator,
      }),
    );
    const { code } = await callback.done;
    const raw = await postTokenForm(metadata.token_endpoint, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: registration.client_id,
      ...(registration.client_secret ? { client_secret: registration.client_secret } : {}),
      code_verifier: pkce.verifier,
      ...(resourceIndicator ? { resource: resourceIndicator } : {}),
    });
    return {
      tokens: toTokens(raw),
      registration: {
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        tokenEndpoint: metadata.token_endpoint,
        resource: resourceIndicator,
      },
    };
  } finally {
    callback.close();
  }
}

/** 用 refresh token 换新 access token；失败向上抛（调用方决定是否清除凭据） */
export async function refreshAccessToken(
  registration: McpOAuthRegistration,
  refreshToken: string,
): Promise<McpOAuthTokens> {
  const raw = await postTokenForm(registration.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: registration.clientId,
    ...(registration.clientSecret ? { client_secret: registration.clientSecret } : {}),
    ...(registration.resource ? { resource: registration.resource } : {}),
  });
  return toTokens(raw);
}
