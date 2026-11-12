import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zen", {
  pet: {
    hide: (): Promise<void> => ipcRenderer.invoke("pet:hide"),
    showTray: (): Promise<void> => ipcRenderer.invoke("pet:tray-show"),
    toggleTray: (): Promise<void> => ipcRenderer.invoke("pet:tray-toggle"),
  },
});
