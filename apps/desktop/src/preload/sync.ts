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
    exportFile(password: string): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
      return ipcRenderer.invoke("sync:export-file", password);
    },
    previewImport(password: string): Promise<{ ok: boolean; canceled?: boolean; error?: string; preview?: { sections: Array<{ id: string; label: string; count: number; existing: number }> } }> {
      return ipcRenderer.invoke("sync:preview-import", password);
    },
    applyImport(sectionIds: string[]): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("sync:apply-import", sectionIds);
    },
  },
};
