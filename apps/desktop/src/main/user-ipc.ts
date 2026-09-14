import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

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

let cachedSettings: AppSettings | null = null;
let cachedAuth: AuthState | null = null;

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

async function loadAuth(): Promise<AuthState> {
  if (cachedAuth) {
    return cachedAuth;
  }
  cachedAuth = await readJson<AuthState>(authFile(), { loggedIn: false, user: null });
  return cachedAuth;
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

  const iconPath =
    settings.iconId === "custom" && settings.customIconPath
      ? settings.customIconPath
      : join(__dirname, "../renderer/assets", `app-icon-${settings.iconId}.png`);

  try {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      win.setIcon(image);
      if (process.platform === "darwin" && app.dock) {
        app.dock.setIcon(image);
      }
    }
  } catch {
    // keep default icon when asset missing
  }
}

export function registerUserIpc(): void {
  ipcMain.handle("auth:state", async () => loadAuth());

  ipcMain.handle("auth:login", async () => {
    // Device-flow placeholder. Replace with real GitHub Device Flow + safeStorage in P1.
    await shell.openExternal("https://github.com/login/device");
    const user: GitHubUser = {
      login: "zen-user",
      name: "Zen User",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      htmlUrl: "https://github.com/zen-user",
    };
    cachedAuth = { loggedIn: true, user };
    await writeJson(authFile(), cachedAuth);
    broadcast("auth:changed", cachedAuth);
    return cachedAuth;
  });

  ipcMain.handle("auth:logout", async () => {
    cachedAuth = { loggedIn: false, user: null };
    await writeJson(authFile(), cachedAuth);
    broadcast("auth:changed", cachedAuth);
    return cachedAuth;
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
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender) ?? undefined,
      {
        title: "选择应用图标",
        properties: ["openFile"],
        filters: [
          { name: "Images", extensions: ["png", "icns", "ico", "jpg", "jpeg", "webp", "svg"] },
        ],
      },
    );
    if (result.canceled || result.filePaths.length === 0) {
      return loadSettings();
    }

    const source = result.filePaths[0];
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
