import { ipcRenderer } from "electron";

import type { PetGenerateInput, PetState, PetStatus } from "@zen/shared";

export const petApi = {
  pet: {
    get: (): Promise<PetState> => ipcRenderer.invoke("pet:get"),
    generate: (input: PetGenerateInput): Promise<PetState> => ipcRenderer.invoke("pet:generate", input),
    setVisible: (visible: boolean): Promise<PetState> => ipcRenderer.invoke("pet:set-visible", visible),
    setSize: (size: number): Promise<PetState> => ipcRenderer.invoke("pet:set-size", size),
    setStatus: (status: PetStatus): Promise<void> => ipcRenderer.invoke("pet:set-status", status),
    onChanged: (handler: (state: PetState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: PetState) => handler(state);
      ipcRenderer.on("pet:changed", listener);
      return () => ipcRenderer.removeListener("pet:changed", listener);
    },
  },
};
