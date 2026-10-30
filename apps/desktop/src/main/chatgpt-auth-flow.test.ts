import { generateKeyPairSync, sign } from "node:crypto";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let conn: Database.Database;
const browser = vi.hoisted(() => ({ openExternal: vi.fn() }));
const callbackServer = vi.hoisted(() => ({
  current: null as null | { emitRequest: (url: string) => void },
}));

vi.mock("electron", () => ({ shell: browser }));
vi.mock("node:http", () => ({
  default: {
    createServer: () => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const server = {
        on(event: string, listener: (...args: unknown[]) => void) {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(listener);
          listeners.set(event, handlers);
          return server;
        },
        off(event: string, listener: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(listener);
          return server;
        },
        listen(port: number) {
          server.port = port || 45678;
          queueMicrotask(() => listeners.get("listening")?.forEach((handler) => handler()));
        },
        port: 0,
        address() { return { port: server.port }; },
        close() {},
        closeAllConnections() {},
        emitRequest(url: string) {
          const response = {
            setHeader() {},
            writeHead() { return response; },
            end() {},
          };
          listeners.get("request")?.forEach((handler) => handler({ url }, response));
        },
      };
      callbackServer.current = server;
      return server;
    },
  },
}));
vi.mock("./model-db-connection", () => ({ getDb: () => conn }));
vi.mock("./secret", () => ({
  encryptSecret: async (value: string) => value,
  decryptSecret: async (value: string) => value,
}));

import { chatgptLogin, chatgptLogout, getChatGptAuthStatus, resolveChatGptCredentials } from "./chatgpt-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "zen-login-test", alg: "RS256", use: "sig" };

function signedIdToken(nonce: string): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = {
    iss: "https://auth.openai.com", aud: "oaiapp_zen", sub: "user-123", nonce,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
    email: "zen@example.com",
  };
  const body = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(payload)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

beforeEach(() => {
  conn = new Database(":memory:");
  conn.exec(`CREATE TABLE model_providers (
    id TEXT PRIMARY KEY, auth_mode TEXT, oauth_enc TEXT, oauth_updated_at INTEGER, updated_at INTEGER
  ); INSERT INTO model_providers (id, auth_mode, updated_at) VALUES ('p', 'chatgpt-oauth', 0)`);
  browser.openExternal.mockReset();
});

afterEach(() => {
  conn.close();
  vi.unstubAllGlobals();
});

describe("ChatGPT dynamic OAuth", () => {
  it("注册 Zen 客户端，保存 issued client_id，并在再次登录时复用", async () => {
    let authorization: URL | null = null;
    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    browser.openExternal.mockImplementation(async (raw: string) => {
      authorization = new URL(raw);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "one-time-code");
      callback.searchParams.set("state", authorization.searchParams.get("state")!);
      if (browser.openExternal.mock.calls.length === 1) callback.searchParams.set("client_id", "oaiapp_zen");
      callbackServer.current?.emitRequest(`${callback.pathname}${callback.search}`);
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/jwks.json")) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      const body = new URLSearchParams(String(init?.body));
      requests.push({ url: input, body });
      return new Response(JSON.stringify({
        access_token: `access-${requests.length}`,
        refresh_token: `refresh-${requests.length}`,
        id_token: signedIdToken(authorization!.searchParams.get("nonce")!),
        token_type: "Bearer",
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        expires_in: 3600,
      }), { status: 200 });
    }));

    const first = await chatgptLogin("p");
    expect(first).toMatchObject({ loggedIn: true, email: "zen@example.com" });
    const firstUrl = new URL(browser.openExternal.mock.calls[0]![0]);
    expect(firstUrl.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(firstUrl.searchParams.get("agent_name_hint")).toBe("Zen");
    expect(firstUrl.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    expect(requests[0]?.url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(requests[0]?.body.get("client_id")).toBe("oaiapp_zen");
    expect(requests[0]?.body.get("resource")).toBe("https://api.openai.com/v1");
    expect(await resolveChatGptCredentials("p")).toMatchObject({ accessToken: "access-1" });

    await chatgptLogin("p");
    const secondUrl = new URL(browser.openExternal.mock.calls[1]![0]);
    expect(secondUrl.searchParams.get("client_id")).toBe("oaiapp_zen");
    expect(secondUrl.searchParams.has("agent_name_hint")).toBe(false);
    expect(secondUrl.searchParams.get("ext_agent_host_id")).toBe(firstUrl.searchParams.get("ext_agent_host_id"));
    expect(requests[1]?.body.get("client_id")).toBe("oaiapp_zen");

    const saved = conn.prepare("SELECT oauth_enc FROM model_providers WHERE id = 'p'").get() as { oauth_enc: string };
    const expired = { ...JSON.parse(saved.oauth_enc), expiresAt: 0 };
    conn.prepare("UPDATE model_providers SET oauth_enc = ? WHERE id = 'p'").run(JSON.stringify(expired));
    expect(await resolveChatGptCredentials("p")).toMatchObject({ accessToken: "access-3" });
    expect(requests[2]?.body.get("grant_type")).toBe("refresh_token");
    expect(requests[2]?.body.get("client_id")).toBe("oaiapp_zen");
    expect(requests[2]?.body.get("resource")).toBe("https://api.openai.com/v1");
  });

  it("离线退出会清除本机令牌并提示远端撤销未确认", async () => {
    conn.prepare("UPDATE model_providers SET oauth_enc = ? WHERE id = 'p'").run(JSON.stringify({
      clientId: "oaiapp_zen", subject: "user-123", hostId: "urn:uuid:host",
      scopes: ["chatgpt.tokens.use.direct"], accessToken: "access", refreshToken: "refresh",
      idToken: "id", expiresAt: Date.now() + 3600_000,
    }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(chatgptLogout("p")).rejects.toThrow("远端撤销未确认");
    expect(await getChatGptAuthStatus("p")).toEqual({ loggedIn: false, expiresAt: 0 });
  });

  it("刷新临时故障保留凭据，确认令牌失效才清除会话", async () => {
    conn.prepare("UPDATE model_providers SET oauth_enc = ? WHERE id = 'p'").run(JSON.stringify({
      clientId: "oaiapp_zen", subject: "user-123", hostId: "urn:uuid:host",
      scopes: ["chatgpt.tokens.use.direct"], accessToken: "access", refreshToken: "refresh",
      idToken: "id", expiresAt: 0,
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "server_error" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    await expect(resolveChatGptCredentials("p")).rejects.toThrow("暂时无法刷新");
    expect(await getChatGptAuthStatus("p")).toMatchObject({ loggedIn: true });
    await expect(resolveChatGptCredentials("p")).rejects.toThrow("登录已失效");
    expect(await getChatGptAuthStatus("p")).toEqual({ loggedIn: false, expiresAt: 0 });
  });

  it("已注册但未获计划权限时请求重新同意", async () => {
    conn.prepare("UPDATE model_providers SET oauth_enc = ? WHERE id = 'p'").run(JSON.stringify({
      clientId: "oaiapp_zen", subject: "user-123", hostId: "urn:uuid:host",
      scopes: ["openid", "profile"], accessToken: "access", refreshToken: "refresh",
      idToken: "", expiresAt: Date.now() + 3600_000,
    }));
    browser.openExternal.mockRejectedValue(new Error("browser failed"));
    await expect(chatgptLogin("p")).rejects.toThrow("browser failed");
    const url = new URL(browser.openExternal.mock.calls[0]![0]);
    expect(url.searchParams.get("client_id")).toBe("oaiapp_zen");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});
