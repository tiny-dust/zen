import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { app, ipcMain, nativeImage, shell } from "electron";

const execFileAsync = promisify(execFile);

export interface DesktopOpener {
  id: string;
  label: string;
  /** data-url 图标；拿不到则为空 */
  icon: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pngDataUrl(image: Electron.NativeImage): string {
  if (image.isEmpty()) {
    return "";
  }
  return `data:image/png;base64,${image.toPNG().toString("base64")}`;
}

/** 优先 Electron getFileIcon，失败则从 .app 的 Info.plist / Resources 读 icns */
async function iconDataUrl(appPath: string): Promise<string> {
  try {
    const image = await app.getFileIcon(appPath, { size: "normal" });
    const url = pngDataUrl(image);
    if (url) {
      return url;
    }
  } catch {
    // fall through
  }

  if (!appPath.endsWith(".app")) {
    return "";
  }

  try {
    const plist = await readFile(join(appPath, "Contents/Info.plist"), "utf8");
    const match = plist.match(
      /<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/i,
    );
    if (match?.[1]) {
      const raw = match[1].trim();
      const iconName = raw.endsWith(".icns") ? raw : `${raw}.icns`;
      const icnsPath = join(appPath, "Contents/Resources", iconName);
      const url = pngDataUrl(nativeImage.createFromPath(icnsPath));
      if (url) {
        return url;
      }
    }
  } catch {
    // fall through
  }

  try {
    const resources = join(appPath, "Contents/Resources");
    const entries = await readdir(resources);
    const icns = entries.find((name) => name.endsWith(".icns"));
    if (icns) {
      const url = pngDataUrl(nativeImage.createFromPath(join(resources, icns)));
      if (url) {
        return url;
      }
    }
  } catch {
    // ignore
  }

  return "";
}

interface Candidate {
  id: string;
  label: string;
  /** macOS .app 路径 */
  macApp?: string;
  /** CLI 可执行（PATH 或绝对路径） */
  cli?: string;
  /** Windows 注册名 / 命令 */
  winCommand?: string;
  builtin?: boolean;
}

const CANDIDATES: Candidate[] = [
  { id: "finder", label: "Finder", macApp: "/System/Library/CoreServices/Finder.app", builtin: true },
  {
    id: "terminal",
    label: "Terminal",
    macApp: "/System/Applications/Utilities/Terminal.app",
    builtin: true,
  },
  { id: "iterm", label: "iTerm", macApp: "/Applications/iTerm.app", cli: "iterm" },
  {
    id: "vscode",
    label: "VS Code",
    macApp: "/Applications/Visual Studio Code.app",
    cli: "code",
    winCommand: "code",
  },
  {
    id: "cursor",
    label: "Cursor",
    macApp: "/Applications/Cursor.app",
    cli: "cursor",
    winCommand: "cursor",
  },
  {
    id: "android-studio",
    label: "Android Studio",
    macApp: "/Applications/Android Studio.app",
    winCommand: "studio",
  },
  {
    id: "webstorm",
    label: "WebStorm",
    macApp: "/Applications/WebStorm.app",
    winCommand: "webstorm",
  },
  { id: "idea", label: "IntelliJ IDEA", macApp: "/Applications/IntelliJ IDEA.app" },
  {
    id: "sublime",
    label: "Sublime Text",
    macApp: "/Applications/Sublime Text.app",
    cli: "subl",
    winCommand: "subl",
  },
  { id: "warp", label: "Warp", macApp: "/Applications/Warp.app" },
];

async function which(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function listMacOpeners(): Promise<Array<Candidate & { appPath?: string }>> {
  const found: Array<Candidate & { appPath?: string }> = [];
  for (const item of CANDIDATES) {
    if (item.macApp && (await pathExists(item.macApp))) {
      found.push({ ...item, appPath: item.macApp });
      continue;
    }
    if (item.cli && (await which(item.cli))) {
      found.push(item);
    }
  }
  return found;
}

async function listWinOpeners(): Promise<Candidate[]> {
  const found: Candidate[] = [
    { id: "explorer", label: "资源管理器", builtin: true },
  ];
  for (const item of CANDIDATES) {
    if (!item.winCommand) {
      continue;
    }
    // 粗探测：where 命令
    try {
      await execFileAsync("where", [item.winCommand]);
      found.push(item);
    } catch {
      // ignore
    }
  }
  return found;
}

async function listLinuxOpeners(): Promise<Candidate[]> {
  const found: Candidate[] = [{ id: "files", label: "文件管理器", builtin: true }];
  for (const item of CANDIDATES) {
    if (item.cli && (await which(item.cli))) {
      found.push(item);
    }
  }
  return found;
}

export async function listOpeners(): Promise<DesktopOpener[]> {
  let candidates: Array<Candidate & { appPath?: string }> = [];
  if (process.platform === "darwin") {
    candidates = await listMacOpeners();
  } else if (process.platform === "win32") {
    candidates = await listWinOpeners();
  } else {
    candidates = await listLinuxOpeners();
  }

  const result: DesktopOpener[] = [];
  for (const item of candidates) {
    const iconPath = item.appPath;
    const icon = iconPath ? await iconDataUrl(iconPath) : "";
    result.push({ id: item.id, label: item.label, icon });
  }
  return result;
}

async function openWithMac(openerId: string, path: string): Promise<void> {
  const candidate = CANDIDATES.find((item) => item.id === openerId);
  if (openerId === "finder") {
    await execFileAsync("open", [path]);
    return;
  }
  if (openerId === "terminal") {
    await execFileAsync("open", ["-a", "Terminal", path]);
    return;
  }
  if (candidate?.macApp && (await pathExists(candidate.macApp))) {
    await execFileAsync("open", ["-a", candidate.macApp, path]);
    return;
  }
  if (candidate?.cli) {
    await execFileAsync(candidate.cli, [path]);
    return;
  }
  await shell.openPath(path);
}

export function registerShellIpc(): void {
  ipcMain.handle("shell:platform-info", () => platformInfo());

  ipcMain.handle("shell:list-openers", async () => {
    try {
      return await listOpeners();
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "shell:open-with",
    async (_event, openerId: string, path: string): Promise<{ ok: boolean; error?: string }> => {
      if (typeof path !== "string" || !path.trim()) {
        return { ok: false, error: "路径为空" };
      }
      try {
        if (process.platform === "darwin") {
          await openWithMac(openerId, path);
          return { ok: true };
        }
        if (process.platform === "win32") {
          if (openerId === "explorer") {
            await execFileAsync("explorer", [path]);
            return { ok: true };
          }
          const candidate = CANDIDATES.find((item) => item.id === openerId);
          if (candidate?.winCommand) {
            await execFileAsync(candidate.winCommand, [path]);
            return { ok: true };
          }
        } else {
          if (openerId === "files") {
            await shell.openPath(path);
            return { ok: true };
          }
          const candidate = CANDIDATES.find((item) => item.id === openerId);
          if (candidate?.cli) {
            await execFileAsync(candidate.cli, [path]);
            return { ok: true };
          }
        }
        const err = await shell.openPath(path);
        return err ? { ok: false, error: err } : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "打开失败",
        };
      }
    },
  );

  ipcMain.handle(
    "shell:show-in-folder",
    async (_event, path: string): Promise<{ ok: boolean; error?: string }> => {
      if (typeof path !== "string" || !path.trim()) {
        return { ok: false, error: "路径为空" };
      }
      try {
        shell.showItemInFolder(path);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "打开失败",
        };
      }
    },
  );

  ipcMain.handle(
    "shell:open-path",
    async (_event, path: string): Promise<{ ok: boolean; error?: string }> => {
      if (typeof path !== "string" || !path.trim()) {
        return { ok: false, error: "路径为空" };
      }
      try {
        const err = await shell.openPath(path);
        return err ? { ok: false, error: err } : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "打开失败",
        };
      }
    },
  );
}

export function platformInfo() {
  const platform = process.platform as "darwin" | "win32" | "linux";
  return {
    platform,
    showInFolderLabel:
      platform === "darwin"
        ? "在 Finder 中显示"
        : platform === "win32"
          ? "在资源管理器中显示"
          : "在文件管理器中显示",
    openFolderLabel: platform === "win32" ? "打开文件资源管理器" : "打开文件夹",
  };
}
