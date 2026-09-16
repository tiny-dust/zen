import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

import {
  decryptTokens,
  encryptTokens,
  fetchGitHubUser,
  loginWithGitHub,
} from "./github-auth";

import type { EncryptedTokens } from "./github-auth";
import type { AppIconId, AppSettings, AuthState, GitHubUser } from "@zen/shared";
import { DEFAULT_SHORTCUTS } from "@zen/shared";

const settingsFile = () => join(app.getPath("userData"), "settings.json");
const authFile = () => join(app.getPath("userData"), "auth.json");
const customIconDir = () => join(app.getPath("userData"), "icons");

const defaultSettings: AppSettings = {
  iconId: "zen-ink",
  customIconPath: null,
  shortcuts: DEFAULT_SHORTCUTS.map((item) => ({ ...item })),
};

interface StoredAuth {
  loggedIn: boolean;
  user: GitHubUser | null;
  tokens?: EncryptedTokens | null;
}

let cachedSettings: AppSettings | null = null;
let cachedAuth: StoredAuth | null = null;
let loginInFlight: Promise<AuthState> | null = null;

function toPublicAuth(stored: StoredAuth): AuthState {
  return {
    loggedIn: stored.loggedIn,
    user: stored.user,
    error: null,
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

async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
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

async function loadStoredAuth(): Promise<StoredAuth> {
  if (cachedAuth) {
    return cachedAuth;
  }
  const stored = await readJson<StoredAuth>(authFile(), { loggedIn: false, user: null });
  cachedAuth = {
    loggedIn: stored.loggedIn === true && Boolean(stored.user),
    user: stored.user ?? null,
    tokens: stored.tokens ?? null,
  };
  return cachedAuth;
}

async function loadAuth(): Promise<AuthState> {
  return toPublicAuth(await loadStoredAuth());
}

async function persistAuth(stored: StoredAuth): Promise<AuthState> {
  cachedAuth = stored;
  await writeJson(authFile(), stored);
  const next = toPublicAuth(stored);
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
    return await persistAuth({ loggedIn: true, user, tokens: encrypted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub 登录失败";
    const current = await loadStoredAuth();
    return {
      loggedIn: current.loggedIn,
      user: current.user,
      error: message,
    };
  }
}

async function refreshProfile(): Promise<AuthState> {
  const stored = await loadStoredAuth();
  if (!stored.loggedIn || !stored.tokens) {
    return loadAuth();
  }
  try {
    const tokens = await decryptTokens(stored.tokens);
    const user = await fetchGitHubUser(tokens.accessToken);
    return await persistAuth({ ...stored, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "刷新资料失败";
    return {
      loggedIn: stored.loggedIn,
      user: stored.user,
      error: message,
    };
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
