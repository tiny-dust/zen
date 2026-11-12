import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zen", {
  pet: {
    hide: (): Promise<void> => ipcRenderer.invoke("pet:hide"),
  },
});
