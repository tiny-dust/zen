import { BrowserWindow, ipcMain, nativeTheme } from "electron";

/**
 * 窗口控制（Windows/Linux）：原生 titleBarOverlay 三键 + Linux 双击最大化兜底。
 *
 * 三平台窗口 chrome 全部交给系统：macOS 红绿灯（titleBarStyle: hidden），
 * Windows/Linux 用 titleBarOverlay 原生叠加键（createWindow 注入）。
 * 原生按钮的点击在系统层处理，不经过渲染层，天然不受
 * -webkit-app-region 拖拽区登记时序影响（自绘三键在 Linux/Windows
 * 会被后登记的 drag 矩形盖住，点击被吞）。
 *
 * Linux frameless 的 drag region 双击最大化系统不处理（Electron 已知行为，
 * GNOME/KDE 均如此），渲染层用 window:toggle-maximize 兜底。
 */

/** 叠加键高度：与渲染层 --titlebar-h 一致 */
const OVERLAY_HEIGHT = 38;

/** 按当前主题取叠加键配色（与 styles.css 的 --color-bg / --color-topbar-icon 对齐） */
export function titleBarOverlayOptions(): Electron.TitleBarOverlay {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? "#181818" : "#fffefd",
    symbolColor: dark ? "#f4f4f5" : "#151c13",
    height: OVERLAY_HEIGHT,
  };
}

/** 把当前主题的叠加键配色同步到窗口（主题切换时重放） */
export function syncTitleBarOverlay(window: BrowserWindow): void {
  if (window.isDestroyed() || process.platform === "darwin") {
    return;
  }
  try {
    window.setTitleBarOverlay(titleBarOverlayOptions());
  } catch {
    // 窗口构造早期个别平台可能暂不接受 setTitleBarOverlay，忽略（构造参数已带首帧近似）
  }
}

/** 主题变化（含设置里的 theme 档切换联动 nativeTheme）时刷新全部窗口的叠加键配色 */
export function registerTitleBarOverlayThemeSync(): void {
  nativeTheme.on("updated", () => {
    for (const window of BrowserWindow.getAllWindows()) {
      syncTitleBarOverlay(window);
    }
  });
}

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    return null;
  }
  return window;
}

export function registerWindowControlsIpc(): void {
  // Linux 双击拖拽区最大化-还原兜底（渲染层 WindowControls 调用）
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
}
