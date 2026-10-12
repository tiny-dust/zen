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
  // macOS 由系统红绿灯处理；Windows/Linux 由渲染层自绘三键。
  window: {
    /**
     * 平台标识（sandbox preload 的 process.platform，同步可用）。
     * 三键必须在首帧渲染：Chromium 对首帧之后动态添加的拖拽区
     * 只登记 drag 矩形、不登记 no-drag 子区域（Linux/Windows 均如此），
     * 若等异步 platformInfo 再 v-if 渲染，三键会被拖拽区吞掉所有点击。
     */
    getPlatform(): "darwin" | "win32" | "linux" {
      // Node 的 Platform 联合比 Electron 三平台宽，此处收窄
      return process.platform as "darwin" | "win32" | "linux";
    },
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
