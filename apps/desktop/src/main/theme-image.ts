import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BrowserWindow, app, ipcMain } from "electron";

import { showOpenDialogSafe } from "./dialog-safe";

import {
  MAX_THEME_IMAGE_BYTES,
  THEME_IMAGE_EXTENSIONS,
  isValidThemeImageId,
} from "@zen/shared";

import type { ThemeImagePickResult } from "@zen/shared";

/**
 * 图片背景的本地存储：只存 userData/theme-images 下的复制件。
 * 渲染层永远拿不到任意路径能力——选图由主进程弹窗，读取只接受白名单文件名。
 */
export function themeImageDir(): string {
  return join(app.getPath("userData"), "theme-images");
}

/** 按文件头判断真实格式：扩展名可以造假，content-type 也不可信 */
function detectExtension(buffer: Buffer): string | null {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * 按显式 id 删除图片。
 * 不做目录扫描：目录里可能有用户还没保存的选择、其它主题的图，甚至手工放进来的文件，
 * 「列目录然后删掉不认识的」迟早会删掉不该删的东西。调用方必须给出确定的 id 列表。
 */
export async function deleteThemeImages(ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids
      .filter((id) => isValidThemeImageId(id))
      .map((id) => rm(join(themeImageDir(), id), { force: true })),
  );
}

/** 选图 → 校验 → 复制进应用数据目录；失败时不动磁盘上原有图片 */
export async function pickThemeImage(window: BrowserWindow | null): Promise<ThemeImagePickResult> {
  const picked = await showOpenDialogSafe(window, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: [...THEME_IMAGE_EXTENSIONS] }],
  });
  if (picked.canceled || !picked.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const source = picked.filePaths[0];
  if (!source) {
    return { ok: false, canceled: true };
  }
  try {
    const info = await stat(source);
    if (!info.isFile()) {
      return { ok: false, error: "not-a-file" };
    }
    if (info.size > MAX_THEME_IMAGE_BYTES) {
      return { ok: false, error: "too-large" };
    }
    const buffer = await readFile(source);
    const ext = detectExtension(buffer);
    if (!ext) {
      return { ok: false, error: "unsupported-format" };
    }
    await mkdir(themeImageDir(), { recursive: true });
    const id = `${randomBytes(12).toString("hex")}.${ext}`;
    await writeFile(join(themeImageDir(), id), buffer);
    // 这里不删旧图：设置还没保存，删了就可能两者都丢。旧图由设置保存后的「释放」逻辑删。
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 读取为 data URL；文件被移走/损坏时返回 error，让界面回退 */
export async function readThemeImage(id: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (!isValidThemeImageId(id)) {
    return { ok: false, error: "invalid-id" };
  }
  const file = join(themeImageDir(), id);
  try {
    // 读之前再限一次大小，并用文件头确认确实是图片：文件可能被替换成别的内容
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_THEME_IMAGE_BYTES) {
      return { ok: false, error: "too-large" };
    }
    const buffer = await readFile(file);
    const ext = detectExtension(buffer);
    if (!ext) {
      return { ok: false, error: "unsupported-format" };
    }
    return { ok: true, dataUrl: `data:${MIME[ext]};base64,${buffer.toString("base64")}` };
  } catch {
    return { ok: false, error: "missing" };
  }
}

/** 文件是否还在（启动校验用，不读内容） */
export async function themeImageExists(id: string): Promise<boolean> {
  if (!isValidThemeImageId(id)) {
    return false;
  }
  try {
    return (await stat(join(themeImageDir(), id))).isFile();
  } catch {
    return false;
  }
}

/** 移除背景：只删指定那张；是否仍被设置引用由 user-ipc 在调用前判断 */
export async function clearThemeImage(id: string): Promise<void> {
  await deleteThemeImages([id]);
}

export function registerThemeImageIpc(): void {
  ipcMain.handle("theme-image:pick", async (event) => {
    return pickThemeImage(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle("theme-image:read", async (_event, id: string) => readThemeImage(id));
  ipcMain.handle("theme-image:clear", async (_event, id: string) => {
    // 删除由 user-ipc 统一把关（仍被设置引用时拒绝），这里只做执行
    const { releaseThemeImage } = await import("./user-ipc");
    return releaseThemeImage(id);
  });
  // 启动校验：设置里登记的图被用户删掉时，只回答「不存在」，由设置层回退
  ipcMain.handle("theme-image:exists", async (_event, id: string) => themeImageExists(id));
}
