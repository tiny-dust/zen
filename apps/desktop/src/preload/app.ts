import { ipcRenderer } from "electron";

export interface AppInfo {
  workspaceRoot: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

export const appApi = {
  app: {
    info(): Promise<AppInfo> {
      return ipcRenderer.invoke("app:info");
    },
    openExternal(url: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("app:open-external", url);
    },
    openSystemExternal(url: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("app:open-system-external", url);
    },
  },
  shell: {
    listOpeners(): Promise<Array<{ id: string; label: string; icon: string }>> {
      return ipcRenderer.invoke("shell:list-openers");
    },
    openWith(
      openerId: string,
      path: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("shell:open-with", openerId, path);
    },
    showInFolder(path: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("shell:show-in-folder", path);
    },
    openPath(path: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("shell:open-path", path);
    },
    platformInfo(): Promise<{
      platform: "darwin" | "win32" | "linux";
      showInFolderLabel: string;
      openFolderLabel: string;
    }> {
      return ipcRenderer.invoke("shell:platform-info");
    },
  },
  // 窗口控制：新增域，不改动既有 app./shell. 签名。
  // macOS 由系统红绿灯处理；Win32 优先原生 caption 叠加，其余场景由渲染层自绘。
  window: {
    minimize(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("window:minimize");
    },
    maximize(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("window:maximize");
    },
    restore(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("window:restore");
    },
    toggleMaximize(): Promise<{ ok: boolean; maximized: boolean }> {
      return ipcRenderer.invoke("window:toggle-maximize");
    },
    close(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("window:close");
    },
    isMaximized(): Promise<boolean> {
      return ipcRenderer.invoke("window:is-maximized");
    },
    /** Windows 原生 caption 叠加配色同步（渲染层按 styles.css token 实际值下发） */
    setTitleBarOverlay(options: {
      color?: string;
      symbolColor?: string;
      height?: number;
    }): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("window:set-titlebar-overlay", options);
    },
    onMaximizedChange(handler: (maximized: boolean) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => {
        handler(maximized);
      };
      ipcRenderer.on("window:maximized-changed", listener);
      return () => {
        ipcRenderer.removeListener("window:maximized-changed", listener);
      };
    },
  },
};
