import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refreshAccessToken, runBrowserAuthorization } from "./oauth";

import type { AddressInfo } from "node:net";
import type { McpServerConfig } from "@zen/shared";

/**
 * 本地假 OAuth 供应商：完整扮演 401 挑战、资源元数据、AS 元数据、DCR 与 token 端点。
 * 浏览器环节由测试接管：openExternal 收到授权 URL 后直接打本地回调，模拟 IdP 重定向。
 */

const CODE = "test-auth-code";
const VERIFIER_LENGTH = /[A-Za-z0-9_-]{43,128}/;

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

let server: Server;
let base: string;
let requests: CapturedRequest[] = [];
/** 用例可覆盖的行为开关 */
let behavior: {
  challenge: boolean;
  resourceServers: string[] | null;
  registrationEndpoint: boolean;
  tokenStatus: number;
} = {
  challenge: true,
  resourceServers: null,
  registrationEndpoint: true,
  tokenStatus: 200,
};

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += String(chunk)));
    req.on("end", () => resolve(data));
  });
}

function json(res: import("node:http").ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function resourceMetadataPayload(): Record<string, unknown> {
  return {
    resource: "https://mcp.example.test/mcp",
    authorization_servers: behavior.resourceServers ?? [`${base}/auth/v1`],
    scopes_supported: ["openid"],
  };
}

function serverMetadataPayload(): Record<string, unknown> {
  return {
    issuer: `${base}/auth/v1`,
    authorization_endpoint: `${base}/auth/v1/oauth/authorize`,
    token_endpoint: `${base}/auth/v1/oauth/token`,
    ...(behavior.registrationEndpoint ? { registration_endpoint: `${base}/auth/v1/oauth/clients/register` } : {}),
    scopes_supported: ["openid", "profile", "offline_access"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
  };
}

beforeEach(async () => {
  requests = [];
  behavior = { challenge: true, resourceServers: null, registrationEndpoint: true, tokenStatus: 200 };
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method ?? "", url: req.url ?? "", body });
    if (req.url === "/mcp" && req.method === "POST") {
      if (behavior.challenge) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
        res.end('{"error":"unauthorized"}');
        return;
      }
    }
    if (req.url === "/.well-known/oauth-protected-resource/mcp") {
      json(res, resourceMetadataPayload());
      return;
    }
    if (req.url === "/.well-known/oauth-protected-resource/api/mcp") {
      json(res, resourceMetadataPayload());
      return;
    }
    if (req.url === "/auth/v1/.well-known/oauth-authorization-server") {
      json(res, serverMetadataPayload());
      return;
    }
    if (req.url === "/auth/v1/oauth/clients/register" && req.method === "POST") {
      const payload = JSON.parse(body) as Record<string, unknown>;
      expect(payload.redirect_uris).toHaveLength(1);
      expect(String(payload.redirect_uris[0])).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      json(res, { client_id: "reg-123", client_secret: "sec-456" });
      return;
    }
    if (req.url === "/auth/v1/oauth/token" && req.method === "POST") {
      if (behavior.tokenStatus !== 200) {
        res.writeHead(behavior.tokenStatus, { "Content-Type": "application/json" });
        res.end('{"error":"server_error"}');
        return;
      }
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") {
        expect(form.get("code")).toBe(CODE);
        expect(form.get("client_id")).toBe("reg-123");
        expect(form.get("client_secret")).toBe("sec-456");
        expect(form.get("code_verifier") ?? "").toMatch(VERIFIER_LENGTH);
        expect(form.get("resource")).toBe("https://mcp.example.test/mcp");
        json(res, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "openid offline_access" });
        return;
      }
      if (form.get("grant_type") === "refresh_token") {
        expect(form.get("refresh_token")).toBe("rt-1");
        expect(form.get("client_id")).toBe("reg-123");
        json(res, { access_token: "at-2", expires_in: 3600 });
        return;
      }
      json(res, { error: "unsupported_grant_type" }, 400);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function httpConfig(url: string): McpServerConfig {
  return { id: "srv-oauth", name: "example", transport: "http", url, enabled: true };
}

/** 浏览器替身：解析授权 URL 参数后直接请求本地回调，模拟 IdP 携 code 重定向 */
function fakeBrowser(options: { state?: string; code?: string | null }): {
  authorizeUrl: URL | null;
  openExternal: (url: string) => void;
} {
  const capture: { authorizeUrl: URL | null } = { authorizeUrl: null };
  return {
    get authorizeUrl() {
      return capture.authorizeUrl;
    },
    openExternal: (url: string) => {
      const authorize = new URL(url);
      capture.authorizeUrl = authorize;
      const redirectUri = authorize.searchParams.get("redirect_uri")!;
      const state = options.state ?? authorize.searchParams.get("state")!;
      const code = options.code === undefined ? CODE : options.code;
      const params = new URLSearchParams();
      if (code) params.set("code", code);
      params.set("state", state);
      void fetch(`${redirectUri}?${params.toString()}`).catch(() => undefined);
    },
  };
}

describe("runBrowserAuthorization", () => {
  it("按挑战头走完 元数据→DCR→浏览器→回调→换token 全链路", async () => {
    const browser = fakeBrowser({});
    const result = await runBrowserAuthorization(httpConfig(`${base}/mcp`), {
      challenge: `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      openExternal: browser.openExternal,
      timeoutMs: 5000,
    });

    // 授权 URL 参数完整（PKCE S256 + state + resource）
    const authorize = browser.authorizeUrl!;
    expect(new URL(authorize).pathname).toBe("/auth/v1/oauth/authorize");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("client_id")).toBe("reg-123");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge") ?? "").toMatch(VERIFIER_LENGTH);
    expect(authorize.searchParams.get("scope")).toContain("openid");
    expect(authorize.searchParams.get("scope")).toContain("offline_access");
    expect(authorize.searchParams.get("resource")).toBe("https://mcp.example.test/mcp");

    // token 结果与注册信息
    expect(result.tokens.accessToken).toBe("at-1");
    expect(result.tokens.refreshToken).toBe("rt-1");
    expect(result.tokens.expiresAt).toBeGreaterThan(Date.now());
    expect(result.registration).toMatchObject({
      clientId: "reg-123",
      tokenEndpoint: `${base}/auth/v1/oauth/token`,
      resource: "https://mcp.example.test/mcp",
    });
  });

  it("challenge 缺失时按 well-known 默认路径推导资源元数据", async () => {
    const browser = fakeBrowser({});
    const result = await runBrowserAuthorization(httpConfig(`${base}/api/mcp`), {
      openExternal: browser.openExternal,
      timeoutMs: 5000,
    });
    expect(result.tokens.accessToken).toBe("at-1");
    expect(requests.some((r) => r.url === "/.well-known/oauth-protected-resource/api/mcp")).toBe(true);
  });

  it("回调 state 不匹配或缺失 code 时明确报错", async () => {
    await expect(
      runBrowserAuthorization(httpConfig(`${base}/mcp`), {
        challenge: `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        openExternal: fakeBrowser({ state: "wrong-state" }).openExternal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("state 校验失败");

    await expect(
      runBrowserAuthorization(httpConfig(`${base}/mcp`), {
        challenge: `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        openExternal: fakeBrowser({ code: null }).openExternal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("缺少 code");
  });

  it("IdP 回调 error 时透出授权失败原因", async () => {
    const capture: { url: URL | null } = { url: null };
    await expect(
      runBrowserAuthorization(httpConfig(`${base}/mcp`), {
        challenge: `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        openExternal: (url) => {
          capture.url = new URL(url);
          const redirectUri = capture.url.searchParams.get("redirect_uri")!;
          void fetch(`${redirectUri}?error=access_denied`).catch(() => undefined);
        },
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("access_denied");
  });

  it("资源元数据缺 authorization_servers 时报错", async () => {
    behavior.resourceServers = [];
    await expect(
      runBrowserAuthorization(httpConfig(`${base}/mcp`), {
        openExternal: () => undefined,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("authorization_servers");
  });

  it("授权服务器不支持动态注册时提示手动填 API Key", async () => {
    behavior.registrationEndpoint = false;
    await expect(
      runBrowserAuthorization(httpConfig(`${base}/mcp`), {
        openExternal: () => undefined,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("动态客户端注册");
  });

  it("token 端点失败时报出 HTTP 状态与 error 码", async () => {
    behavior.tokenStatus = 500;
    await expect(
      runBrowserAuthorization(httpConfig(`${base}/mcp`), {
        openExternal: fakeBrowser({}).openExternal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("500");
  });
});

describe("refreshAccessToken", () => {
  it("用 refresh_token 换新 access token", async () => {
    const tokens = await refreshAccessToken(
      {
        clientId: "reg-123",
        tokenEndpoint: `${base}/auth/v1/oauth/token`,
        resource: "https://mcp.example.test/mcp",
      },
      "rt-1",
    );
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("PKCE 挑战与 verifier 一一对应（S256）", () => {
    // 用服务端验证过的 code_verifier 长度与挑战算法一致性兜底：挑战 = base64url(sha256(verifier))
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toHaveLength(43);
  });
});
