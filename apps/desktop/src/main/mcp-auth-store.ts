import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { refreshAccessToken } from "@zen/mcp-client";
import type { McpOAuthRegistration, McpOAuthTokens } from "@zen/mcp-client";

import { decryptSecret, encryptSecret } from "./secret";
import { zenRoot } from "./zen-dir";

/**
 * MCP OAuth 凭据存储（~/.zen/mcp-auth.json）：access/refresh token 与 clientSecret 一律密文（aes:v1）。
 * 该文件含密钥，只允许本模块读写；config-sync 仅同步 zen-config.json / mcp.json，
 * 不读取此文件 —— 严禁把 mcp-auth.json 加入云同步或任何导出。
 */

interface EncryptedTokens {
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  expiresAt?: number;
}

interface StoredRegistration {
  clientId: string;
  clientSecretEnc?: string;
  tokenEndpoint: string;
  resource?: string;
}

interface StoredAuthEntry {
  tokensEnc: EncryptedTokens;
  registration: StoredRegistration;
}

type McpAuthFile = Record<string, StoredAuthEntry>;

/** 提前 1 分钟视为过期，避免把将死的 token 注入 header 后请求途中失效 */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function mcpAuthFile(): string {
  return join(zenRoot(), "mcp-auth.json");
}

async function readAuthFile(): Promise<McpAuthFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(mcpAuthFile(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as McpAuthFile;
  } catch {
    return {};
  }
}

async function writeAuthFile(data: McpAuthFile): Promise<void> {
  const file = mcpAuthFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

/** 读回解密后的凭据（save 的对称操作）；条目缺失、字段不全或密文损坏返回 null */
export async function readMcpAuthEntry(
  serverId: string,
): Promise<{ tokens: McpOAuthTokens; registration: McpOAuthRegistration } | null> {
  const entry = (await readAuthFile())[serverId];
  if (!entry?.tokensEnc?.accessTokenEnc || !entry.registration?.clientId || !entry.registration?.tokenEndpoint) {
    return null;
  }
  try {
    const tokens: McpOAuthTokens = { accessToken: await decryptSecret(entry.tokensEnc.accessTokenEnc) };
    if (entry.tokensEnc.refreshTokenEnc) {
      tokens.refreshToken = await decryptSecret(entry.tokensEnc.refreshTokenEnc);
    }
    if (entry.tokensEnc.expiresAt !== undefined) {
      tokens.expiresAt = entry.tokensEnc.expiresAt;
    }
    const registration: McpOAuthRegistration = {
      clientId: entry.registration.clientId,
      tokenEndpoint: entry.registration.tokenEndpoint,
    };
    if (entry.registration.clientSecretEnc) {
      registration.clientSecret = await decryptSecret(entry.registration.clientSecretEnc);
    }
    if (entry.registration.resource) {
      registration.resource = entry.registration.resource;
    }
    return { tokens, registration };
  } catch {
    return null;
  }
}

export async function saveMcpAuthEntry(
  serverId: string,
  tokens: McpOAuthTokens,
  registration: McpOAuthRegistration,
): Promise<void> {
  const data = await readAuthFile();
  const tokensEnc: EncryptedTokens = { accessTokenEnc: await encryptSecret(tokens.accessToken) };
  if (tokens.refreshToken) {
    tokensEnc.refreshTokenEnc = await encryptSecret(tokens.refreshToken);
  }
  if (tokens.expiresAt !== undefined) {
    tokensEnc.expiresAt = tokens.expiresAt;
  }
  const registrationStored: StoredRegistration = {
    clientId: registration.clientId,
    tokenEndpoint: registration.tokenEndpoint,
  };
  if (registration.clientSecret) {
    registrationStored.clientSecretEnc = await encryptSecret(registration.clientSecret);
  }
  if (registration.resource) {
    registrationStored.resource = registration.resource;
  }
  data[serverId] = { tokensEnc, registration: registrationStored };
  await writeAuthFile(data);
}

export async function clearMcpAuthEntry(serverId: string): Promise<void> {
  const data = await readAuthFile();
  if (!data[serverId]) {
    return;
  }
  delete data[serverId];
  await writeAuthFile(data);
}

/** 删除 ids 之外的凭据；服务被移除后调用，避免 ~/.zen/mcp-auth.json 残留孤儿密文 */
export async function clearMcpAuthExcept(ids: string[]): Promise<void> {
  const keep = new Set(ids);
  const data = await readAuthFile();
  const stale = Object.keys(data).filter((id) => !keep.has(id));
  if (stale.length === 0) {
    return;
  }
  for (const id of stale) {
    delete data[id];
  }
  await writeAuthFile(data);
}

/** 可用的 access token：未过期直接返回；过期则用 refresh token 续期并回写；任何失败返回 null 不抛 */
export async function getValidAccessToken(serverId: string): Promise<string | null> {
  const entry = await readMcpAuthEntry(serverId);
  if (!entry) {
    return null;
  }
  const { tokens, registration } = entry;
  const stillFresh = !tokens.expiresAt || tokens.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS;
  if (stillFresh) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    return null;
  }
  try {
    const refreshed = await refreshAccessToken(registration, tokens.refreshToken);
    await saveMcpAuthEntry(serverId, refreshed, registration);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}
