import { BrowserWindow, ipcMain } from "electron";

import type { TitleBarOverlayOptions } from "electron";

/**
 * 窗口控制：最小化 / 最大化 / 还原 / 关闭 + 最大化状态同步。
 *
 * macOS 由系统红绿灯处理；这些 IPC 供 Windows/Linux 自绘三键、
 * Windows 原生 caption 叠加不可用时的自绘兜底、以及三平台
 * 「双击标题栏最大化-还原」共用。
 */

const hookedWindows = new WeakSet<BrowserWindow>();

/** 窗口 maximize/unmaximize 时向渲染层推送最新状态 */
function hookWindow(window: BrowserWindow): void {
  if (hookedWindows.has(window)) {
    return;
  }
  hookedWindows.add(window);
  const emit = () => {
    if (!window.isDestroyed()) {
      window.webContents.send("window:maximized-changed", window.isMaximized());
    }
  };
  window.on("maximize", emit);
  window.on("unmaximize", emit);
}

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    return null;
  }
  hookWindow(window);
  return window;
}

export function registerWindowControlsIpc(): void {
  ipcMain.handle("window:minimize", (event) => {
    windowFromEvent(event)?.minimize();
    return { ok: true };
  });

  ipcMain.handle("window:maximize", (event) => {
    windowFromEvent(event)?.maximize();
    return { ok: true };
  });

  ipcMain.handle("window:restore", (event) => {
    windowFromEvent(event)?.unmaximize();
    return { ok: true };
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = windowFromEvent(event);
    if (!window) {
      return { ok: false, maximized: false };
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return { ok: true, maximized: window.isMaximized() };
  });

  ipcMain.handle("window:close", (event) => {
    windowFromEvent(event)?.close();
    return { ok: true };
  });

  ipcMain.handle("window:is-maximized", (event) => {
    return windowFromEvent(event)?.isMaximized() ?? false;
  });

  /**
   * Windows 原生 caption 叠加配色同步：渲染层按 styles.css token
   * 实际值下发，主题切换后仍与界面一致。其它平台忽略（安全降级）。
   */
  ipcMain.handle(
    "window:set-titlebar-overlay",
    (event, options: TitleBarOverlayOptions) => {
      const window = windowFromEvent(event);
      if (!window || process.platform !== "win32" || !options) {
        return { ok: false };
      }
      try {
        const overlay: TitleBarOverlayOptions = {};
        if (typeof options.color === "string" && options.color) {
          overlay.color = options.color;
        }
        if (typeof options.symbolColor === "string" && options.symbolColor) {
          overlay.symbolColor = options.symbolColor;
        }
        if (typeof options.height === "number" && options.height > 0) {
          overlay.height = options.height;
        }
        window.setTitleBarOverlay(overlay);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
  );
}
