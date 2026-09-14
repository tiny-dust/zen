import { safeStorage, shell } from "electron";

import type { DeviceCodeInfo, GitHubUser } from "@zen/shared";

export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface EncryptedTokens {
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  expiresAt?: number;
}

const DEFAULT_SCOPES = "read:user";

function readEnv(key: string): string | undefined {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) {
    return fromProcess;
  }
  const env = import.meta.env as Record<string, string | undefined>;
  const candidates = [
    `MAIN_VITE_${key}`,
    `VITE_${key}`,
    key,
  ];
  for (const name of candidates) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function requireClientId(): string {
  const clientId = readEnv("GITHUB_CLIENT_ID");
  if (!clientId) {
    throw new Error(
      "未配置 GITHUB_CLIENT_ID。请在 apps/desktop/.env.local 设置 MAIN_VITE_GITHUB_CLIENT_ID",
    );
  }
  return clientId;
}

async function encryptToken(plain: string): Promise<string> {
  if (safeStorage.isEncryptionAvailable()) {
    const buf = await safeStorage.encryptStringAsync(plain);
    return buf.toString("base64");
  }
  return Buffer.from(`plain:${plain}`, "utf8").toString("base64");
}

async function decryptToken(encoded: string): Promise<string> {
  const raw = Buffer.from(encoded, "base64");
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const { result } = await safeStorage.decryptStringAsync(raw);
      return result;
    } catch {
      // plain-prefixed fallback
    }
  }
  const text = raw.toString("utf8");
  return text.startsWith("plain:") ? text.slice("plain:".length) : text;
}

export async function encryptTokens(tokens: GitHubTokens): Promise<EncryptedTokens> {
  const accessTokenEnc = await encryptToken(tokens.accessToken);
  const encrypted: EncryptedTokens = { accessTokenEnc };
  if (tokens.refreshToken) {
    encrypted.refreshTokenEnc = await encryptToken(tokens.refreshToken);
  }
  if (tokens.expiresAt) {
    encrypted.expiresAt = tokens.expiresAt;
  }
  return encrypted;
}

export async function decryptTokens(encrypted: EncryptedTokens): Promise<GitHubTokens> {
  const accessToken = await decryptToken(encrypted.accessTokenEnc);
  const tokens: GitHubTokens = { accessToken };
  if (encrypted.refreshTokenEnc) {
    tokens.refreshToken = await decryptToken(encrypted.refreshTokenEnc);
  }
  if (encrypted.expiresAt) {
    tokens.expiresAt = encrypted.expiresAt;
  }
  return tokens;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface TokenPollResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const scopes = readEnv("GITHUB_OAUTH_SCOPES") || DEFAULT_SCOPES;
  const body: Record<string, string> = { client_id: clientId };
  // GitHub Apps ignore scopes on device/code; OAuth Apps need them.
  body.scope = scopes;

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "zen-desktop",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as Partial<DeviceCodeResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.device_code || !data.user_code) {
    throw new Error(
      data.error_description || data.error || `申请 device code 失败（HTTP ${response.status}）`,
    );
  }
  return data as DeviceCodeResponse;
}

async function pollForAccessToken(options: {
  clientId: string;
  deviceCode: string;
  intervalSec: number;
  expiresAt: number;
  onSlowDown?: (nextIntervalSec: number) => void;
}): Promise<GitHubTokens> {
  let intervalMs = Math.max(1, options.intervalSec) * 1000;

  while (Date.now() < options.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "zen-desktop",
      },
      body: JSON.stringify({
        client_id: options.clientId,
        device_code: options.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await response.json()) as TokenPollResponse;

    if (data.access_token) {
      const tokens: GitHubTokens = { accessToken: data.access_token };
      if (data.refresh_token) {
        tokens.refreshToken = data.refresh_token;
      }
      if (data.expires_in) {
        tokens.expiresAt = Date.now() + data.expires_in * 1000;
      }
      return tokens;
    }

    switch (data.error) {
      case "authorization_pending":
      case "slow_down": {
        if (data.error === "slow_down") {
          intervalMs += 5000;
          options.onSlowDown?.(Math.round(intervalMs / 1000));
        }
        continue;
      }
      case "expired_token":
        throw new Error("设备码已过期，请重新点击登录");
      case "access_denied":
        throw new Error("你在 GitHub 上拒绝了授权");
      default:
        throw new Error(data.error_description || data.error || "等待 GitHub 授权时出错");
    }
  }

  throw new Error("GitHub 授权超时，请重试");
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "zen-desktop",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`获取 GitHub 用户信息失败（HTTP ${response.status}）`);
  }
  const data = (await response.json()) as {
    login: string;
    name?: string | null;
    avatar_url?: string | null;
    html_url?: string | null;
    bio?: string | null;
    company?: string | null;
    location?: string | null;
    blog?: string | null;
    email?: string | null;
    followers?: number;
    following?: number;
    public_repos?: number;
    public_gists?: number;
    updated_at?: string | null;
  };
  return {
    login: data.login,
    name: data.name || data.login,
    avatarUrl: data.avatar_url || "",
    htmlUrl: data.html_url || `https://github.com/${data.login}`,
    bio: data.bio ?? null,
    company: data.company ?? null,
    location: data.location ?? null,
    blog: data.blog ?? null,
    email: data.email ?? null,
    followers: data.followers ?? 0,
    following: data.following ?? 0,
    publicRepos: data.public_repos ?? 0,
    publicGists: data.public_gists ?? 0,
    updatedAt: data.updated_at ?? null,
  };
}

// GitHub 推荐桌面/CLI 使用 Device Flow：只需 Client ID，浏览器打开 verification_uri_complete 可预填 code。
export async function loginWithGitHub(options: {
  onDeviceCode: (info: DeviceCodeInfo) => void;
}): Promise<{ user: GitHubUser; tokens: GitHubTokens }> {
  const clientId = requireClientId();
  const device = await requestDeviceCode(clientId);

  const verificationUri = device.verification_uri_complete || device.verification_uri;
  const info: DeviceCodeInfo = {
    userCode: device.user_code,
    verificationUri,
    expiresAt: Date.now() + device.expires_in * 1000,
  };
  options.onDeviceCode(info);
  await shell.openExternal(verificationUri);

  const tokens = await pollForAccessToken({
    clientId,
    deviceCode: device.device_code,
    intervalSec: device.interval ?? 5,
    expiresAt: info.expiresAt,
  });
  const user = await fetchGitHubUser(tokens.accessToken);
  return { user, tokens };
}
