import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

import {
  decryptTokens,
  encryptTokens,
  fetchGitHubUser,
  findClientId,
  loginWithGitHub,
  refreshAccessToken,
} from "./github-auth";

import type { EncryptedTokens, GitHubTokens } from "./github-auth";
import type { AppIconId, AppSettings, AuthState, GitHubUser } from "@zen/shared";
import { DEFAULT_SHORTCUTS, DEFAULT_CODE_THEME, DEFAULT_UPDATE_FEED_URL } from "@zen/shared";

const settingsFile = () => join(app.getPath("userData"), "settings.json");
/**
 * 登录态按运行形态分文件：dev（Electron）与打包版（Zen）的 safeStorage 钥匙串密钥不同，
 * 共用一个 auth.json 时，一边启动解不开另一边加密的凭据就会清空登录态（反复掉登录的根因）。
 */
const authFile = () =>
  join(app.getPath("userData"), app.isPackaged ? "auth.json" : "auth.dev.json");
const customIconDir = () => join(app.getPath("userData"), "icons");

/** 登录态有效期：自登录起 3 个月，到期需重新登录 */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** 访问令牌到期前提前续期的时间窗 */
const REFRESH_AHEAD_MS = 24 * 60 * 60 * 1000;

const defaultSettings: AppSettings = {
  iconId: "zen-ink",
  customIconPath: null,
  shortcuts: DEFAULT_SHORTCUTS.map((item) => ({ ...item })),
  updateFeedUrl: DEFAULT_UPDATE_FEED_URL,
  codeTheme: DEFAULT_CODE_THEME,
};

interface StoredAuth {
  loggedIn: boolean;
  user: GitHubUser | null;
  tokens?: EncryptedTokens | null;
  /** 本次登录时间戳（3 个月会话窗口起点） */
  loginAt?: number;
}

let cachedSettings: AppSettings | null = null;
let cachedAuth: StoredAuth | null = null;
let loginInFlight: Promise<AuthState> | null = null;

function toPublicAuth(stored: StoredAuth, error: string | null = null): AuthState {
  return {
    loggedIn: stored.loggedIn,
    user: stored.user,
    error,
    loginAt: stored.loginAt ?? null,
    expiresAt: stored.tokens?.expiresAt ?? null,
  };
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 原子写入：先写临时文件再 rename，避免进程被杀时留下截断的 JSON（截断 = 静默登出） */
async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
}

async function loadSettings(): Promise<AppSettings> {
  if (cachedSettings) {
    return cachedSettings;
  }
  const stored = await readJson<Partial<AppSettings>>(settingsFile(), {});
  cachedSettings = {
    ...defaultSettings,
    ...stored,
    shortcuts: stored.shortcuts?.length
      ? stored.shortcuts
      : defaultSettings.shortcuts.map((item) => ({ ...item })),
  };
  return cachedSettings;
}

/** 供 updater 等模块读取应用设置（带缓存） */
export async function loadAppSettings(): Promise<AppSettings> {
  return loadSettings();
}

async function loadStoredAuth(): Promise<StoredAuth> {
  if (cachedAuth) {
    return cachedAuth;
  }
  const stored = await readJson<StoredAuth>(authFile(), { loggedIn: false, user: null });
  cachedAuth = {
    loggedIn: stored.loggedIn === true && Boolean(stored.user),
    user: stored.user ?? null,
    tokens: stored.tokens ?? null,
    // 旧版 auth.json 无 loginAt：以本次升级为起点开 3 个月窗口
    loginAt: stored.loginAt ?? (stored.loggedIn === true ? Date.now() : undefined),
  };
  if (cachedAuth.loggedIn && stored.loginAt == null) {
    void writeJson(authFile(), cachedAuth);
  }
  return cachedAuth;
}

/** 3 个月会话窗口是否已过 */
function sessionExpired(stored: StoredAuth): boolean {
  return Boolean(stored.loggedIn && stored.loginAt && Date.now() - stored.loginAt > SESSION_TTL_MS);
}

async function loadAuth(): Promise<AuthState> {
  const stored = await loadStoredAuth();
  if (sessionExpired(stored)) {
    return persistAuth({ loggedIn: false, user: null, tokens: null }, "登录已超过 3 个月，请重新登录");
  }
  return toPublicAuth(stored);
}

/** 取可用的访问令牌：会话过期返回 null；令牌临近到期时用 refresh token 续期 */
async function ensureValidTokens(): Promise<string | null> {
  const stored = await loadStoredAuth();
  if (!stored.loggedIn || !stored.tokens) {
    return null;
  }
  if (sessionExpired(stored)) {
    await persistAuth({ loggedIn: false, user: null, tokens: null }, "登录已超过 3 个月，请重新登录");
    return null;
  }
  let tokens: GitHubTokens;
  try {
    tokens = await decryptTokens(stored.tokens);
  } catch {
    // 本地密钥失效 / token 损坏：清掉凭据，引导重新登录
    await persistAuth(
      { loggedIn: false, user: null, tokens: null },
      "本地密钥无法解密已保存的凭据，请重新登录",
    );
    return null;
  }
  const nearExpiry = tokens.expiresAt != null && tokens.expiresAt - Date.now() < REFRESH_AHEAD_MS;
  if (!nearExpiry || !tokens.refreshToken) {
    // 长期令牌（OAuth App）无过期时间，直接使用
    return tokens.accessToken;
  }
  const refreshed = await forceRefreshTokens(stored, tokens.refreshToken);
  return refreshed.tokens?.accessToken ?? tokens.accessToken;
}

/**
 * 强制续期并落库；失败时返回 error 原因，由调用方区分
 * 「refresh token 真失效（应清登录）」与「瞬时故障（应保留登录）」。
 */
async function forceRefreshTokens(
  stored: StoredAuth,
  refreshToken: string,
): Promise<{ tokens: GitHubTokens | null; error: string | null }> {
  try {
    const clientId = findClientId();
    if (!clientId) {
      return { tokens: null, error: "未配置 GITHUB_CLIENT_ID" };
    }
    const refreshed = await refreshAccessToken(clientId, refreshToken);
    const encrypted = await encryptTokens(refreshed);
    await persistAuth({ ...stored, tokens: encrypted });
    return { tokens: refreshed, error: null };
  } catch (error) {
    return { tokens: null, error: error instanceof Error ? error.message : "刷新令牌失败" };
  }
}

/** 供配置云同步读取已存 token；未登录/会话过期返回 null。token 不出 main 进程。 */
export async function getStoredAuthTokens(): Promise<string | null> {
  return ensureValidTokens();
}

async function persistAuth(stored: StoredAuth, error: string | null = null): Promise<AuthState> {
  cachedAuth = stored;
  await writeJson(authFile(), stored);
  const next = toPublicAuth(stored, error);
  broadcast("auth:changed", next);
  return next;
}

async function performLogin(): Promise<AuthState> {
  try {
    const { user, tokens } = await loginWithGitHub({
      onDeviceCode: (info) => {
        broadcast("auth:device-code", info);
      },
    });
    const encrypted = await encryptTokens(tokens);
    return await persistAuth({ loggedIn: true, user, tokens: encrypted, loginAt: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub 登录失败";
    const current = await loadStoredAuth();
    return toPublicAuth(current, message);
  }
}

async function refreshProfile(): Promise<AuthState> {
  const stored = await loadStoredAuth();
  if (!stored.loggedIn || !stored.tokens) {
    return loadAuth();
  }
  try {
    const accessToken = await ensureValidTokens();
    if (!accessToken) {
      return loadAuth();
    }
    const user = await fetchGitHubUser(accessToken);
    return await persistAuth({ ...stored, user });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "刷新资料失败";
    // 本地密钥失效 / token 损坏：清掉凭据，引导重新登录，避免一直弹 ByteString
    if (/解密|凭据无效|ByteString/i.test(raw)) {
      return await persistAuth({ loggedIn: false, user: null, tokens: null });
    }
    // 令牌过期/吊销（401）：有 refresh token 时续期重试一次
    if (/HTTP 401/.test(raw)) {
      const tokens = await decryptTokens(stored.tokens).catch(() => null);
      if (!tokens?.refreshToken) {
        // 无 refresh token 的长期令牌：401 即凭据失效，清除
        return await persistAuth(
          { loggedIn: false, user: null, tokens: null },
          "登录态已失效，请重新登录",
        );
      }
      const refreshed = await forceRefreshTokens(stored, tokens.refreshToken);
      if (refreshed.tokens) {
        try {
          const user = await fetchGitHubUser(refreshed.tokens.accessToken);
          return await persistAuth({ ...stored, user });
        } catch {
          // 新令牌仍被拒：凭据确实失效，清除
          return await persistAuth(
            { loggedIn: false, user: null, tokens: null },
            "登录态已失效，请重新登录",
          );
        }
      }
      if (/invalid_grant|bad_refresh_token|expired/i.test(refreshed.error ?? "")) {
        // GitHub 明确判定 refresh token 失效：清登录引导重登
        return await persistAuth(
          { loggedIn: false, user: null, tokens: null },
          "登录态已失效，请重新登录",
        );
      }
      // 瞬时失败（网络/限流/服务波动）：保留登录态，只上报错误，下次再试
      return toPublicAuth(stored, "令牌续期未成功（网络或服务波动），已保留登录态");
    }
    // 其余错误（403 多为限流/代理拦截等）不是凭据失效：保留登录态，仅上报
    return toPublicAuth(stored, raw);
  }
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

async function applyAppIcon(settings: AppSettings) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    return;
  }

  const fileName =
    settings.iconId === "custom" && settings.customIconPath
      ? null
      : `app-icon-${settings.iconId}.png`;
  const candidates = fileName
    ? [
        join(__dirname, "../renderer/assets", fileName),
        join(__dirname, "../../ui/public/assets", fileName),
      ]
    : [];
  if (settings.iconId === "custom" && settings.customIconPath) {
    candidates.push(settings.customIconPath);
  }

  for (const iconPath of candidates) {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        win.setIcon(image);
        if (process.platform === "darwin" && app.dock) {
          await app.dock.setIcon(image);
        }
        return;
      }
    } catch {
      // try next candidate
    }
  }
}

export function registerUserIpc(): void {
  ipcMain.handle("auth:state", async () => loadAuth());

  ipcMain.handle("auth:login", async () => {
    if (loginInFlight) {
      return loginInFlight;
    }
    loginInFlight = performLogin().finally(() => {
      loginInFlight = null;
    });
    return loginInFlight;
  });

  ipcMain.handle("auth:logout", async () => {
    return persistAuth({ loggedIn: false, user: null, tokens: null });
  });

  ipcMain.handle("auth:refresh-profile", async () => refreshProfile());

  ipcMain.handle("app:open-external", async (_event, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { ok: false };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("settings:get", async () => loadSettings());

  ipcMain.handle("settings:set", async (_event, partial: Partial<AppSettings>) => {
    const current = await loadSettings();
    const next: AppSettings = {
      ...current,
      ...partial,
      shortcuts: partial.shortcuts?.length
        ? partial.shortcuts
        : current.shortcuts.map((item) => ({ ...item })),
    };
    cachedSettings = next;
    await writeJson(settingsFile(), next);
    broadcast("settings:changed", next);
    return next;
  });

  ipcMain.handle("settings:pick-icon", async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: "选择应用图标",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["png", "icns", "ico", "jpg", "jpeg", "webp", "svg"] },
      ],
    };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const source = result.canceled ? undefined : result.filePaths[0];
    if (!source) {
      return loadSettings();
    }

    const dir = customIconDir();
    await ensureDir(dir);
    const target = join(dir, `custom-${Date.now()}-${basename(source)}`);
    await copyFile(source, target);

    const current = await loadSettings();
    const next: AppSettings = {
      ...current,
      iconId: "custom",
      customIconPath: target,
    };
    cachedSettings = next;
    await writeJson(settingsFile(), next);
    broadcast("settings:changed", next);
    void applyAppIcon(next);
    return next;
  });

  ipcMain.handle("settings:apply-icon", async () => {
    const settings = await loadSettings();
    await applyAppIcon(settings);
    return settings;
  });
}

export async function initUserState() {
  const settings = await loadSettings();
  await applyAppIcon(settings);
  return settings;
}
