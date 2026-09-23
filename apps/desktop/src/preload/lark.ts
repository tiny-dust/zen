import { ipcRenderer } from "electron";

import type { LarkStatus } from "@zen/shared";

/** 飞书桥接：网关状态查询与变化订阅（启停由 main 侧设置联动托管） */
export const larkApi = {
  lark: {
    status(): Promise<LarkStatus> {
      return ipcRenderer.invoke("lark:status");
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
  },
};
