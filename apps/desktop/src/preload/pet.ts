import { ipcRenderer } from "electron";

import type { PetCollectionState, PetGenerateInput, PetStatus } from "@zen/shared";

export const petApi = {
  pet: {
    get: (): Promise<PetCollectionState> => ipcRenderer.invoke("pet:get"),
    generate: (input: PetGenerateInput): Promise<PetCollectionState> => ipcRenderer.invoke("pet:generate", input),
    importDirectory: (): Promise<PetCollectionState | null> => ipcRenderer.invoke("pet:import-directory"),
    setVisible: (id: string, visible: boolean): Promise<PetCollectionState> => ipcRenderer.invoke("pet:set-visible", id, visible),
    setSize: (id: string, size: number): Promise<PetCollectionState> => ipcRenderer.invoke("pet:set-size", id, size),
    setStatus: (status: PetStatus): Promise<void> => ipcRenderer.invoke("pet:set-status", status),
    onChanged: (handler: (state: PetCollectionState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: PetCollectionState) => handler(state);
      ipcRenderer.on("pet:changed", listener);
      return () => ipcRenderer.removeListener("pet:changed", listener);
    },
  },
};
