import { describe, expect, it } from "vitest";

import { parseIdTokenClaims } from "./chatgpt-auth";

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
