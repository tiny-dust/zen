import { ipcRenderer } from "electron";

import type { SyncResult } from "@zen/shared";

export const syncApi = {
  sync: {
    upload(): Promise<SyncResult> {
      return ipcRenderer.invoke("sync:upload");
    },
    download(): Promise<SyncResult> {
      return ipcRenderer.invoke("sync:download");
    },
  },
};
