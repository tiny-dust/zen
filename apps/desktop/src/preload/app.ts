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
    openExternal(url: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("app:open-external", url);
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
};
