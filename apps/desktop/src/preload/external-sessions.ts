import { ipcRenderer } from "electron";

import type {
  ExternalClientCapability,
  ExternalRunEvent,
  ExternalRunRequest,
  ExternalRunStarted,
  ExternalSessionsResult,
  ExternalSessionTrace,
} from "@zen/shared";

/**
 * 外部 agent 会话：列表 + 轨迹读取 + 在原厂商会话里续聊。
 * 续聊一律由主进程按固定配方调用本机 CLI，渲染层只能传「会话 id + 文本」。
 */
export const externalSessionsApi = {
  externalSessions: {
    list(): Promise<ExternalSessionsResult> {
      return ipcRenderer.invoke("external-sessions:list");
    },
    trace(id: string): Promise<ExternalSessionTrace> {
      return ipcRenderer.invoke("external-sessions:trace", id);
    },
    capabilities(): Promise<ExternalClientCapability[]> {
      return ipcRenderer.invoke("external-sessions:capabilities");
    },
    /** 发一条续聊消息：成功返回 runId，失败返回原因（cli 缺失 / 不支持 / 会话不存在） */
    send(request: ExternalRunRequest): Promise<ExternalRunStarted | { error: string; blocked?: string }> {
      return ipcRenderer.invoke("external-sessions:send", request);
    },
    stop(runId: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("external-sessions:stop", runId);
    },
    onRun(handler: (event: ExternalRunEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: ExternalRunEvent) => {
        handler(payload);
      };
      ipcRenderer.on("external-sessions:run", listener);
      return () => {
        ipcRenderer.removeListener("external-sessions:run", listener);
      };
    },
  },
};
