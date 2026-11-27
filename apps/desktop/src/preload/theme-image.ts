import { ipcRenderer } from "electron";

import type { ThemeImagePickResult } from "@zen/shared";

export const themeImageApi = {
  themeImage: {
    /** 系统选图弹窗 + 主进程复制校验；返回保存后的文件名 */
    pick(): Promise<ThemeImagePickResult> {
      return ipcRenderer.invoke("theme-image:pick");
    },
    /** 只接受设置里保存的文件名，返回 data URL 供预览/背景使用 */
    read(id: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
      return ipcRenderer.invoke("theme-image:read", id);
    },
    clear(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("theme-image:clear");
    },
    exists(id: string): Promise<boolean> {
      return ipcRenderer.invoke("theme-image:exists", id);
    },
  },
};
