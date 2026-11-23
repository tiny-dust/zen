import { ipcRenderer } from "electron";

export interface RemoteStatus {
  enabled: boolean;
  relayUrl: string;
  deviceId: string;
  status: "disabled" | "connecting" | "connected" | "disconnected" | "error";
  error?: string;
}

export const remoteApi = {
  remote: {
    getConfig(): Promise<RemoteStatus> {
      return ipcRenderer.invoke("remote:get-config");
    },
    setConfig(input: { enabled?: boolean; relayUrl?: string }): Promise<RemoteStatus> {
      return ipcRenderer.invoke("remote:set-config", input);
    },
    requestPairCode(): Promise<{ code: string; expiresAt: number }> {
      return ipcRenderer.invoke("remote:request-pair-code");
    },
    revoke(): Promise<RemoteStatus> {
      return ipcRenderer.invoke("remote:revoke");
    },
    onStatus(handler: (status: RemoteStatus) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, status: RemoteStatus) => handler(status);
      ipcRenderer.on("remote:status", listener);
      return () => ipcRenderer.removeListener("remote:status", listener);
    },
  },
};
