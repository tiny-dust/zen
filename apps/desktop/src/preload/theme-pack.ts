import { ipcRenderer } from "electron";

import type { CustomTheme, CustomThemePack } from "@zen/shared";

export const themePackApi = {
  themePack: {
    /** 选 .nomitheme.json / .nomitheme；主进程完成解析、校验与背景图落盘 */
    import(): Promise<{ ok: boolean; canceled?: boolean; pack?: CustomThemePack; error?: string }> {
      return ipcRenderer.invoke("theme-pack:import");
    },
    /** 有背景图写 ZIP，无图写 JSON；目标路径由系统保存弹窗决定 */
    export(theme: CustomTheme): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
      return ipcRenderer.invoke("theme-pack:export", theme);
    },
  },
};
