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
  },
};
