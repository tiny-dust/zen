import { BrowserWindow, ipcMain } from "electron";

/**
 * 窗口控制：最小化 / 最大化 / 还原 / 关闭 + 最大化状态同步。
 *
 * macOS 由系统红绿灯处理；Windows/Linux 由渲染层自绘三键走这些 IPC。
 * 渲染层的三键必须首帧渲染（preload 的 window.getPlatform 同步给平台），
 * 否则拖拽区的 no-drag 子区域不会被 Chromium 登记，点击全被吞掉。
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
}
