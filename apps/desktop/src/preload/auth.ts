import { ipcRenderer } from "electron";

import type { AuthState, DeviceCodeInfo } from "@zen/shared";

export const authApi = {
  auth: {
    state(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:state");
    },
    login(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:login");
    },
    logout(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:logout");
    },
    refreshProfile(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:refresh-profile");
    },
    onChanged(handler: (state: AuthState) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, state: AuthState) => {
        handler(state);
      };
      ipcRenderer.on("auth:changed", listener);
      return () => {
        ipcRenderer.removeListener("auth:changed", listener);
      };
    },
    onDeviceCode(handler: (info: DeviceCodeInfo) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, info: DeviceCodeInfo) => {
        handler(info);
      };
      ipcRenderer.on("auth:device-code", listener);
      return () => {
        ipcRenderer.removeListener("auth:device-code", listener);
      };
    },
  },
};
