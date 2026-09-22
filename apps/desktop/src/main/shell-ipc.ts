import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
  /** 探测到的可执行文件完整路径（Windows where / Linux which），用作图标来源 */
  exePath?: string;
  /** Linux .desktop 解析出的图标文件路径 */
  linuxIconPath?: string;
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

/** which 的完整路径版：返回可执行文件绝对路径（失败返回空串） */
async function whichPath(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("which", [command]);
    return stdout.trim().split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** where 的完整路径版（Windows）：返回第一个 .exe 的绝对路径 */
async function wherePath(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("where", [command]);
    const line = stdout.trim().split(/\r?\n/).find((item) => item.trim());
    return line?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * macOS：从 CLI 可执行文件反查所在 .app 包（CLI 通常是 app 内 bin 的软链/脚本，
 * 如 /usr/local/bin/code → Visual Studio Code.app/Contents/Resources/app/bin/code）。
 */
async function resolveMacAppBundle(command: string): Promise<string | undefined> {
  let binPath = await whichPath(command);
  if (!binPath) {
    return undefined;
  }
  try {
    binPath = (await realpath(binPath)) || binPath;
  } catch {
    // 保留原始路径继续向上找
  }
  let dir = dirname(binPath);
  while (dir && dir !== "/") {
    if (dir.endsWith(".app") && (await pathExists(dir))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

/** Linux：在 .desktop 文件里按 Exec 找 Icon= 字段，并解析为可用图标文件路径 */
async function resolveLinuxDesktopIcon(command: string): Promise<string | undefined> {
  const appDirs = [
    join(homedir(), ".local/share/applications"),
    "/usr/share/applications",
  ];
  const executable = command.trim().split(/\s+/)[0] ?? command;
  for (const dir of appDirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".desktop")) {
        continue;
      }
      let content: string;
      try {
        content = await readFile(join(dir, entry), "utf8");
      } catch {
        continue;
      }
      const execMatch = content.match(/^Exec=(.*)$/m);
      const execFirst = execMatch?.[1]?.trim().split(/\s+/)[0] ?? "";
      if (execFirst !== command && execFirst !== executable) {
        continue;
      }
      const iconMatch = content.match(/^Icon=(.*)$/m);
      const iconValue = iconMatch?.[1]?.trim();
      if (!iconValue) {
        continue;
      }
      // 绝对路径直接用；主题名到 hicolor 常见尺寸下找 png/svg
      if (iconValue.startsWith("/")) {
        return iconValue;
      }
      const sizes = ["256x256", "128x128", "64x64", "48x48", "scalable"];
      for (const size of sizes) {
        for (const ext of ["png", "svg"]) {
          const candidate = `/usr/share/icons/hicolor/${size}/apps/${iconValue}.${ext}`;
          if (await pathExists(candidate)) {
            return candidate;
          }
        }
      }
      return undefined;
    }
  }
  return undefined;
}

/** png/svg 图标文件 → data-url（Linux .desktop 图标用） */
async function fileIconDataUrl(iconPath: string): Promise<string> {
  try {
    const info = await stat(iconPath);
    if (!info.isFile() || info.size > 512 * 1024) {
      return "";
    }
    const ext = iconPath.toLowerCase().split(".").pop() ?? "";
    const mime = ext === "svg" ? "image/svg+xml" : ext === "ico" ? "image/x-icon" : "image/png";
    const buffer = await readFile(iconPath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return "";
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
      // CLI 命中：反查所属 .app 包，保证下拉框能显示应用图标
      const bundle = await resolveMacAppBundle(item.cli);
      found.push({ ...item, appPath: bundle });
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
    // where 返回完整 exe 路径，用作 getFileIcon 的图标来源
    const exePath = await wherePath(item.winCommand);
    if (exePath) {
      found.push({ ...item, exePath });
    }
  }
  return found;
}

async function listLinuxOpeners(): Promise<Candidate[]> {
  const found: Candidate[] = [{ id: "files", label: "文件管理器", builtin: true }];
  for (const item of CANDIDATES) {
    if (item.cli && (await which(item.cli))) {
      const exePath = await whichPath(item.cli);
      const linuxIconPath = await resolveLinuxDesktopIcon(item.cli);
      found.push({ ...item, exePath, linuxIconPath });
    }
  }
  return found;
}

/** 三平台各自的图标来源：Windows exe → getFileIcon；macOS .app；Linux .desktop 图标文件 */
async function iconForCandidate(
  item: Candidate & { appPath?: string },
): Promise<string> {
  if (process.platform === "win32" && item.exePath) {
    try {
      const url = pngDataUrl(await app.getFileIcon(item.exePath, { size: "normal" }));
      if (url) {
        return url;
      }
    } catch {
      // fall through
    }
  }
  if (item.appPath) {
    return await iconDataUrl(item.appPath);
  }
  if (process.platform === "linux" && item.linuxIconPath) {
    return await fileIconDataUrl(item.linuxIconPath);
  }
  return "";
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
    result.push({ id: item.id, label: item.label, icon: await iconForCandidate(item) });
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
