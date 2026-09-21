import { ipcRenderer } from "electron";

export const cacheApi = {
  cache: {
    savePaste(payload: {
      name: string;
      mime?: string;
      data: ArrayBuffer | Uint8Array;
    }): Promise<{ ok: boolean; path?: string; error?: string }> {
      return ipcRenderer.invoke("cache:save-paste", payload);
    },
    roots(): Promise<{ root: string; paste: string; screenshots: string }> {
      return ipcRenderer.invoke("cache:roots");
    },
  },
};
