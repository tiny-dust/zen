import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";

import { loadAppSettings } from "./user-ipc";

import type { UpdateStatusInfo } from "@zen/shared";

const { autoUpdater } = electronUpdater;

/** 当前已设置的更新源；变化时重新 setFeedURL */
let activeFeedUrl = "";

function broadcast(status: UpdateStatusInfo) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("update:status", status);
    }
  }
}

function releaseNotesText(notes: unknown): string | null {
  if (typeof notes === "string") {
    return notes;
  }
  if (Array.isArray(notes)) {
    return notes
      .map((item) => (typeof item === "string" ? item : (item as { note?: string }).note ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return null;
}

function wireAutoUpdaterEvents(): void {
  autoUpdater.on("checking-for-update", () => {
    broadcast({ phase: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    broadcast({
      phase: "available",
      version: info.version,
      releaseNotes: releaseNotesText(info.releaseNotes),
    });
  });
  autoUpdater.on("update-not-available", () => {
    broadcast({ phase: "not-available" });
  });
  autoUpdater.on("download-progress", (progress) => {
    broadcast({ phase: "downloading", percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    broadcast({
      phase: "downloaded",
      version: info.version,
      releaseNotes: releaseNotesText(info.releaseNotes),
    });
  });
  autoUpdater.on("error", (error) => {
    broadcast({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  });
}

export function registerUpdaterIpc(): void {
  // 手动确认下载；下载完成后退出时自动安装，也可在 UI 里立即安装
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  wireAutoUpdaterEvents();

  ipcMain.handle("update:check", async (): Promise<{ ok: boolean; error?: string }> => {
    // electron-vite dev 会注入渲染层地址，用它区分开发模式（品牌化 dev 包的 isPackaged 不可靠）
    if (process.env.ELECTRON_RENDERER_URL) {
      return { ok: false, error: "开发模式不支持在线更新，请使用打包版本" };
    }
    const settings = await loadAppSettings();
    const url = settings.updateFeedUrl?.trim();
    if (!url) {
      return { ok: false, error: "请先在设置中配置更新源地址" };
    }
    if (url !== activeFeedUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url });
      activeFeedUrl = url;
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "检查更新失败";
      broadcast({ phase: "error", message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    "update:download",
    async (): Promise<{ ok: boolean; error?: string }> => {
      if (process.env.ELECTRON_RENDERER_URL) {
        return { ok: false, error: "开发模式不支持在线更新" };
      }
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "下载更新失败";
        broadcast({ phase: "error", message });
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle("update:install", () => {
    // 退出并安装已下载的更新；未下载完成时由渲染层控制不触发
    autoUpdater.quitAndInstall();
  });
}
