import { generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseIdTokenClaims } from "./chatgpt-auth";
import { verifyChatGptIdToken } from "./chatgpt-oauth-validation";

/** b64url 编码 JWT 段（无 padding） */
function jwtSegments(payload: Record<string, unknown>): string {
  const enc = (input: string) =>
    Buffer.from(input, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${enc("header")}.${enc(JSON.stringify(payload))}.${enc("sig")}`;
}

describe("parseIdTokenClaims", () => {
  it("解析标准 claims：email / 账号 id / 订阅类型 / 过期时间", () => {
    const token = jwtSegments({
      email: "user@example.com",
      exp: 1767225600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc-123",
        chatgpt_plan_type: "plus",
      },
    });
    expect(parseIdTokenClaims(token)).toEqual({
      email: "user@example.com",
      accountId: "acc-123",
      planType: "plus",
      expiresAt: 1767225600 * 1000,
    });
  });

  it("email 缺省时回落 profile 命名空间", () => {
    const token = jwtSegments({
      exp: 100,
      "https://api.openai.com/profile": { email: "fallback@example.com" },
      "https://api.openai.com/auth": { chatgpt_account_id: "org-1" },
    });
    const claims = parseIdTokenClaims(token);
    expect(claims.email).toBe("fallback@example.com");
    expect(claims.accountId).toBe("org-1");
    expect(claims.planType).toBeUndefined();
  });

  it("非 JWT / 空 token 返回未知过期时间，不抛错", () => {
    expect(parseIdTokenClaims("")).toEqual({ expiresAt: 0 });
    expect(parseIdTokenClaims("not-a-jwt")).toEqual({ expiresAt: 0 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("verifyChatGptIdToken", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "zen-test-key", alg: "RS256", use: "sig" };
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = (claims: Record<string, unknown>) => {
    const body = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(claims)}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  };
  const validClaims = () => ({
    iss: "https://auth.openai.com",
    aud: "oaiapp_zen",
    sub: "account-123",
    nonce: "attempt-123",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "user@example.com",
  });

  it("仅信任正确签名、受众、nonce 和原账号的令牌", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })));
    const valid = token(validClaims());
    expect(await verifyChatGptIdToken(valid, "oaiapp_zen", "attempt-123", "account-123"))
      .toMatchObject({ subject: "account-123", email: "user@example.com" });
    await expect(verifyChatGptIdToken(valid, "oaiapp_other", "attempt-123")).rejects.toThrow();
    await expect(verifyChatGptIdToken(valid, "oaiapp_zen", "wrong-nonce")).rejects.toThrow();
    await expect(verifyChatGptIdToken(valid, "oaiapp_zen", "attempt-123", "other-account")).rejects.toThrow();
    const changedPayload = `${valid.split(".")[0]}.${encode({ ...validClaims(), sub: "attacker" })}.${valid.split(".")[2]}`;
    await expect(verifyChatGptIdToken(changedPayload, "oaiapp_zen", "attempt-123")).rejects.toThrow("签名");
  });

  it("过期令牌和未知密钥均拒绝", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })));
    await expect(verifyChatGptIdToken(token({ ...validClaims(), exp: 1 }), "oaiapp_zen", "attempt-123"))
      .rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [] }), { status: 200 })));
    await expect(verifyChatGptIdToken(token(validClaims()), "oaiapp_zen", "attempt-123"))
      .rejects.toThrow("密钥未知");
  });
});
