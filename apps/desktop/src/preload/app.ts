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
  // 三平台窗口 chrome 均为系统原生（macOS 红绿灯 / Windows、Linux titleBarOverlay
  // 原生叠加键），点击不经过渲染层；此处仅保留 Linux 双击拖拽区最大化的兜底入口。
  window: {
    /**
     * 平台标识（sandbox preload 的 process.platform，同步可用）：
     * Linux 需要渲染层双击兜底（frameless drag region 不处理双击最大化）。
     */
    getPlatform(): "darwin" | "win32" | "linux" {
      // Node 的 Platform 联合比 Electron 三平台宽，此处收窄
      return process.platform as "darwin" | "win32" | "linux";
    },
    toggleMaximize(): Promise<{ ok: boolean; maximized: boolean }> {
      return ipcRenderer.invoke("window:toggle-maximize");
    },
  },
};
