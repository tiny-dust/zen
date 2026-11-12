import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zen", {
  pet: {
    setVisible: (visible: false): Promise<void> => ipcRenderer.invoke("pet:set-visible", visible),
  },
});
