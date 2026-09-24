import { ipcRenderer } from "electron";

import type { LarkLoginEvent, LarkStatus } from "@zen/shared";

/** 飞书桥接：网关状态查询与变化订阅、device flow 登录（启停由 main 侧设置联动托管） */
export const larkApi = {
  lark: {
    status(refresh = false): Promise<LarkStatus> {
      return ipcRenderer.invoke("lark:status", refresh);
    },
    installCli(): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("lark:install-cli");
    },
    onChanged(handler: (status: LarkStatus) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, status: LarkStatus) => {
        handler(status);
      };
      ipcRenderer.on("lark:changed", listener);
      return () => {
        ipcRenderer.removeListener("lark:changed", listener);
      };
    },
    /** 发起飞书登录（device flow）；各阶段经 onLoginEvent 推送 */
    login(): Promise<void> {
      return ipcRenderer.invoke("lark:login");
    },
    cancelLogin(): Promise<void> {
      return ipcRenderer.invoke("lark:login-cancel");
    },
    onLoginEvent(handler: (event: LarkLoginEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, login: LarkLoginEvent) => {
        handler(login);
      };
      ipcRenderer.on("lark:login-event", listener);
      return () => {
        ipcRenderer.removeListener("lark:login-event", listener);
      };
    },
  },
};
