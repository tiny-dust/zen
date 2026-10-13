import { ipcRenderer } from "electron";

import type { AppSettings } from "@zen/shared";

export const settingsApi = {
  settings: {
    get(): Promise<AppSettings> {
      return ipcRenderer.invoke("settings:get");
    },
    set(partial: Partial<AppSettings>): Promise<AppSettings> {
      return ipcRenderer.invoke("settings:set", partial);
    },
    onChanged(handler: (settings: AppSettings) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => {
        handler(settings);
      };
      ipcRenderer.on("settings:changed", listener);
      return () => {
        ipcRenderer.removeListener("settings:changed", listener);
      };
    },
    /** 系统全局快捷键触发（主进程已拉起窗口，渲染层执行命令即可） */
    onGlobalCommand(handler: (command: string) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, command: string) => {
        handler(command);
      };
      ipcRenderer.on("shortcut:global", listener);
      return () => {
        ipcRenderer.removeListener("shortcut:global", listener);
      };
    },
  },
};
