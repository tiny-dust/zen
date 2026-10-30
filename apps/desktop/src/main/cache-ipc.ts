import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";

import { ipcMain, session } from "electron";

import { clearFaviconMemory, faviconCacheDir } from "./favicons";
import { zenCacheRoot } from "./zen-dir";

/**
 * 临时资源一律落在用户域 ~/.zen/cache（不进软件包、不进 userData 应用目录）。
 * paste：剪贴板粘贴的无路径文件/图像
 * screenshots：浏览器截图等
 */

function safeName(name: string): string {
  const base = basename(name || "paste.bin").replace(/[^\w.\-]+/g, "_");
  return base.slice(0, 80) || "paste.bin";
}

export function pasteCacheDir(): string {
  return join(zenCacheRoot(), "paste");
}

export function screenshotCacheDir(): string {
  return join(zenCacheRoot(), "screenshots");
}

/** 仅清除可重新生成的图标；会话文件、附件和截图可能被消息引用。 */
export async function clearTemporaryCache(): Promise<void> {
  await rm(faviconCacheDir(), { recursive: true, force: true });
  clearFaviconMemory();
}

export function registerCacheIpc(): void {
  ipcMain.handle(
    "cache:save-paste",
    async (
      _event,
      payload: { name: string; mime?: string; data: ArrayBuffer | Uint8Array },
    ): Promise<{ ok: boolean; path?: string; error?: string }> => {
      try {
        if (!payload?.data) {
          return { ok: false, error: "empty paste payload" };
        }
        const dir = pasteCacheDir();
        await mkdir(dir, { recursive: true });
        const stamp = Date.now().toString(36);
        const id = randomBytes(4).toString("hex");
        const file = join(dir, `${stamp}-${id}-${safeName(payload.name)}`);
        const buffer =
          payload.data instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(payload.data))
            : Buffer.from(payload.data);
        await writeFile(file, buffer);
        return { ok: true, path: file };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "save paste failed",
        };
      }
    },
  );

  ipcMain.handle("cache:roots", () => ({
    root: zenCacheRoot(),
    paste: pasteCacheDir(),
    screenshots: screenshotCacheDir(),
  }));

  ipcMain.handle("cache:clear-temporary", async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await clearTemporaryCache();
      await session.defaultSession.clearCache();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "clear cache failed",
      };
    }
  });
}
