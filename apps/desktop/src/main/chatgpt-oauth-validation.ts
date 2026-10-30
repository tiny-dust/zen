import { createPublicKey, verify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

const ISSUER = "https://auth.openai.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const CLOCK_SKEW_SECONDS = 5;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(Buffer.from(segment, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** 仅用于展示字段；身份和权限必须先经 verifyChatGptIdToken 验证。 */
export function parseIdTokenClaims(idToken: string): {
  email?: string;
  accountId?: string;
  planType?: string;
  expiresAt: number;
} {
  const claims = decodeSegment(idToken.split(".")[1] ?? "");
  if (!claims) return { expiresAt: 0 };
  const profile = record(claims["https://api.openai.com/profile"]);
  const auth = record(claims["https://api.openai.com/auth"]);
  return {
    email: typeof claims.email === "string" ? claims.email
      : typeof profile?.email === "string" ? profile.email : undefined,
    accountId: typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined,
    planType: typeof auth?.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined,
    expiresAt: typeof claims.exp === "number" ? claims.exp * 1000 : 0,
  };
}

/** 验签并校验本次 OAuth 请求绑定的客户端、nonce 和账号身份。 */
export async function verifyChatGptIdToken(
  idToken: string,
  clientId: string,
  nonce?: string,
  expectedSubject?: string,
): Promise<{ subject: string; email?: string; accountId?: string; planType?: string; expiresAt: number }> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("ChatGPT 身份令牌格式无效");
  }
  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("ChatGPT 身份令牌签名算法无效");
  }
  const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("无法获取 ChatGPT 登录验签密钥");
  const jwks = record(await response.json());
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = keys.map(record).find((key) =>
    key?.kid === header.kid && key?.kty === "RSA" &&
    (key.alg === undefined || key.alg === "RS256") &&
    (key.use === undefined || key.use === "sig"),
  );
  if (!jwk) throw new Error("ChatGPT 身份令牌签名密钥未知");
  let signatureValid = false;
  try {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
    signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    throw new Error("ChatGPT 身份令牌签名无效");
  }
  if (!signatureValid) throw new Error("ChatGPT 身份令牌签名无效");

  const now = Math.floor(Date.now() / 1000);
  const audience = claims.aud;
  const allowedAudience = audience === clientId ||
    (Array.isArray(audience) && audience.includes(clientId) &&
      (audience.length === 1 || claims.azp === clientId));
  if (
    claims.iss !== ISSUER || !allowedAudience ||
    typeof claims.sub !== "string" || !claims.sub ||
    typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW_SECONDS ||
    typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS ||
    (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_SECONDS) ||
    (nonce !== undefined && claims.nonce !== nonce) ||
    (expectedSubject !== undefined && claims.sub !== expectedSubject)
  ) {
    throw new Error("ChatGPT 身份令牌校验失败");
  }
  return { subject: claims.sub, ...parseIdTokenClaims(idToken) };
}
