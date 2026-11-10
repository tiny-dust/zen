import { generateKeyPairSync, sign } from "node:crypto";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let conn: Database.Database;
const browser = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({ shell: browser }));
vi.mock("./model-db-connection", () => ({ getDb: () => conn }));
vi.mock("./secret", () => ({
  encryptSecret: async (value: string) => value,
  decryptSecret: async (value: string) => value,
}));

import {
  CODEX_API_BASE_URL,
  CODEX_CLIENT_ID,
  codexLoginCancel,
  codexLoginComplete,
  codexLoginStart,
  getChatGptAuthStatus,
  parseCodexCallbackInput,
  resolveChatGptCredentials,
} from "./chatgpt-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "codex-login-test", alg: "RS256", use: "sig" };
const REDIRECT = "http://localhost:1455/auth/callback";
/** 走真实网络：用于验证本地回调页与「登录后端口关闭」 */
const realFetch = globalThis.fetch.bind(globalThis);

function signedIdToken(): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://auth.openai.com",
    aud: CODEX_CLIENT_ID,
    sub: "user-codex",
    iat: now,
    exp: now + 3600,
    email: "codex@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-1",
      chatgpt_plan_type: "plus",
    },
  };
  const body = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(payload)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

function callbackUrl(redirectUri: string, state: string, code = "one-time-code"): string {
  return `${redirectUri}?code=${code}&state=${state}`;
}

beforeEach(() => {
  conn = new Database(":memory:");
  conn.exec(`CREATE TABLE model_providers (
    id TEXT PRIMARY KEY, auth_mode TEXT, oauth_enc TEXT, oauth_updated_at INTEGER, updated_at INTEGER
  ); INSERT INTO model_providers (id, auth_mode, updated_at) VALUES ('p', 'chatgpt-oauth', 0)`);
  browser.openExternal.mockReset();
});

afterEach(async () => {
  await codexLoginCancel("p");
  await codexLoginCancel("p-fresh");
  conn.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseCodexCallbackInput", () => {
  it("接受完整地址、查询串与裸 code=…&state=…", () => {
    expect(parseCodexCallbackInput(`${REDIRECT}?code=abc&state=xyz`)).toEqual({
      code: "abc",
      state: "xyz",
    });
    expect(parseCodexCallbackInput("?code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz" });
    expect(parseCodexCallbackInput("code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz" });
  });

  it("空值、无效地址、缺授权码与授权错误都给出明确提示", () => {
    expect(() => parseCodexCallbackInput("  ")).toThrow("请粘贴");
    expect(() => parseCodexCallbackInput("not a url")).toThrow("请粘贴完整回调地址");
    expect(() => parseCodexCallbackInput(`${REDIRECT}?state=xyz`)).toThrow("没有授权码");
    expect(() => parseCodexCallbackInput(`${REDIRECT}?error=access_denied`)).toThrow("授权被拒绝");
  });
});

describe("Codex CLI 手动回调登录", () => {
  it("授权地址使用 Codex 公共客户端，并允许粘贴回调换令牌", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string) => {
      if (input.endsWith("/jwks.json")) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        access_token: "codex-access",
        refresh_token: "codex-refresh",
        id_token: signedIdToken(),
        token_type: "Bearer",
        scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
        expires_in: 3600,
      }), { status: 200 });
    }));

    const start = await codexLoginStart("p");
    const authorize = new URL(start.authorizeUrl);
    expect(authorize.origin + authorize.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe(CODEX_CLIENT_ID);
    expect(authorize.searchParams.get("redirect_uri")).toBe(start.redirectUri);
    expect(start.redirectUri).toMatch(/^http:\/\/localhost:(1455|1457)\/auth\/callback$/);
    expect(authorize.searchParams.get("scope")).toContain("api.connectors.invoke");
    expect(authorize.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(authorize.searchParams.get("originator")).toBe("codex_cli_rs");
    expect(browser.openExternal).toHaveBeenCalledWith(start.authorizeUrl);
    expect(start.redirectUri).toMatch(/^http:\/\/localhost:(1455|1457)\/auth\/callback$/);

    // 回调页是一个真实的本地服务页面，提示用户复制地址栏
    const page = await realFetch(`${start.redirectUri}?code=x&state=y`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("复制回 Zen");

    const state = authorize.searchParams.get("state")!;
    const status = await codexLoginComplete("p", callbackUrl(start.redirectUri, state));
    expect(status).toMatchObject({
      loggedIn: true,
      email: "codex@example.com",
      accountId: "acct-1",
      planType: "plus",
    });

    const tokenCall = vi.mocked(fetch).mock.calls.find(
      ([url]) => url === "https://auth.openai.com/oauth/token",
    )!;
    expect(tokenCall).toBeDefined();
    const body = new URLSearchParams(String((tokenCall[1] as RequestInit).body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe(CODEX_CLIENT_ID);
    expect(body.get("redirect_uri")).toBe(start.redirectUri);
    expect(body.has("resource")).toBe(false);

    expect(await resolveChatGptCredentials("p")).toEqual({
      accessToken: "codex-access",
      accountId: "acct-1",
      profile: "codex",
    });
    expect(await getChatGptAuthStatus("p")).toMatchObject({ loggedIn: true });

    // 登录完成后本地回调服务应已关闭
    await expect(realFetch(`${start.redirectUri}`)).rejects.toThrow();
  });

  it("回调 state 不匹配时拒绝，不落库", async () => {
    const start = await codexLoginStart("p");
    await expect(
      codexLoginComplete("p", callbackUrl(start.redirectUri, "forged")),
    ).rejects.toThrow("state 不匹配");
    expect(await getChatGptAuthStatus("p")).toEqual({ loggedIn: false, expiresAt: 0 });
  });

  it("未先发起授权就粘贴回调会提示重新授权", async () => {
    // 用没发起过授权的 provider，避开同文件里已缓存的授权态
    await expect(
      codexLoginComplete("p-fresh", "http://localhost:1455/auth/callback?code=a&state=b"),
    ).rejects.toThrow("授权已失效");
  });

  it("刷新用 Codex token 端点且不带 resource，保留 codex 授权来源", async () => {
    const start = await codexLoginStart("p");
    const authorize = new URL(browser.openExternal.mock.calls[0]![0]);
    vi.stubGlobal("fetch", vi.fn()
      // 换码 → 验签取 JWKS → 刷新
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "access-1",
        refresh_token: "refresh-1",
        id_token: signedIdToken(),
        scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
        expires_in: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 3600,
      }), { status: 200 })));
    await codexLoginComplete("p", callbackUrl(start.redirectUri, authorize.searchParams.get("state")!));

    // 让令牌过期以触发刷新
    const row = conn.prepare("SELECT oauth_enc FROM model_providers WHERE id = 'p'").get() as { oauth_enc: string };
    conn.prepare("UPDATE model_providers SET oauth_enc = ? WHERE id = 'p'").run(
      JSON.stringify({ ...JSON.parse(row.oauth_enc), expiresAt: 0 }),
    );

    expect(await resolveChatGptCredentials("p")).toMatchObject({
      accessToken: "access-2",
      profile: "codex",
    });
    const refreshCall = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(refreshCall[0]).toBe("https://auth.openai.com/oauth/token");
    const body = new URLSearchParams(String((refreshCall[1] as RequestInit).body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(CODEX_CLIENT_ID);
    expect(body.has("resource")).toBe(false);
  });
});

describe("Codex refresh token 轮换", () => {
  function stored(refreshToken: string, accessToken: string, expiresAt = 0) {
    return {
      profile: "codex", clientId: CODEX_CLIENT_ID, subject: "user-codex", hostId: "urn:uuid:test",
      scopes: ["api.connectors.invoke"], accessToken, refreshToken, idToken: "",
      expiresAt, accountId: "acct-1",
    };
  }

  function save(value: ReturnType<typeof stored>) {
    conn.prepare("UPDATE model_providers SET oauth_enc = ? WHERE id = 'p'").run(JSON.stringify(value));
  }

  it("旧刷新被拒绝时不能抹去另一进程已轮换的有效令牌", async () => {
    save(stored("old-refresh", "old-access"));
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = resolveChatGptCredentials("p");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    save(stored("new-refresh", "new-access", Date.now() + 3600_000));
    finish(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(await pending).toMatchObject({ accessToken: "new-access" });
    expect(await getChatGptAuthStatus("p")).toMatchObject({ loggedIn: true });
  });

  it("旧刷新成功也不能覆盖另一进程已轮换的有效令牌", async () => {
    save(stored("old-refresh", "old-access"));
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = resolveChatGptCredentials("p");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    save(stored("new-refresh", "new-access", Date.now() + 3600_000));
    finish(new Response(JSON.stringify({ access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 3600 }), { status: 200 }));
    expect(await pending).toMatchObject({ accessToken: "new-access" });
    expect(await resolveChatGptCredentials("p")).toMatchObject({ accessToken: "new-access" });
  });
});

describe("Codex 账号接口前缀", () => {
  it("指向 ChatGPT 后端的 Codex 端点", () => {
    expect(CODEX_API_BASE_URL).toBe("https://chatgpt.com/backend-api/codex");
  });
});
