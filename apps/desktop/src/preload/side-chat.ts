import { ipcRenderer } from "electron";

import type {
  SideChatListResult,
  SideChatModelRef,
  SideChatRecord,
  SideChatStreamEvent,
} from "@zen/shared";

/** 侧边对话：按主会话列出、创建、保存（草稿/消息/模型）、删除，以及续写与停止 */
export const sideChatApi = {
  sideChat: {
    list(sessionId: string): Promise<SideChatListResult> {
      return ipcRenderer.invoke("side-chat:list", sessionId);
    },
    create(sessionId: string): Promise<SideChatRecord> {
      return ipcRenderer.invoke("side-chat:create", sessionId);
    },
    /** 整体保存一条记录（消息数组与草稿都不大，直接覆盖写，避免细粒度补丁） */
    save(record: SideChatRecord): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("side-chat:save", record);
    },
    remove(id: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("side-chat:remove", id);
    },
    setModel(
      id: string,
      model: SideChatModelRef | null,
      effort: string | null,
    ): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("side-chat:set-model", id, model, effort);
    },
    send(id: string, text: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("side-chat:send", id, text);
    },
    stop(id: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("side-chat:stop", id);
    },
    onStream(handler: (event: SideChatStreamEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: SideChatStreamEvent) => {
        handler(payload);
      };
      ipcRenderer.on("side-chat:stream", listener);
      return () => {
        ipcRenderer.removeListener("side-chat:stream", listener);
      };
    },
  },
};
