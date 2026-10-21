import { ipcRenderer } from "electron";

import type {
  ErrorReportAnalysis,
  ErrorReportPayload,
  ErrorReportRecord,
} from "@zen/shared";

/** 异常中心：渲染层异常上报、异常列表/清理/分析订阅 */
export const errorsApi = {
  errors: {
    /** 渲染层异常上报（window-error / Vue errorHandler / unhandledrejection） */
    report(payload: ErrorReportPayload): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("errors:report", payload);
    },
    list(): Promise<ErrorReportRecord[]> {
      return ipcRenderer.invoke("errors:list");
    },
    clear(ids?: string[]): Promise<{ ok: boolean; removed?: number; error?: string }> {
      return ipcRenderer.invoke("errors:clear", ids);
    },
    analyze(id: string): Promise<ErrorReportAnalysis | null> {
      return ipcRenderer.invoke("errors:analyze", id);
    },
    /** 异常记录变化（新增/累计/清理）通知；返回取消订阅函数 */
    onChanged(handler: () => void): () => void {
      const listener = () => handler();
      ipcRenderer.on("errors:changed", listener);
      return () => {
        ipcRenderer.removeListener("errors:changed", listener);
      };
    },
  },
};
