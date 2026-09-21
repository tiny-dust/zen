import { ipcRenderer } from "electron";

import type { ChatMessage, SessionRecord } from "@zen/shared";

export const sessionApi = {
  session: {
    create(workspaceId: string | null): Promise<SessionRecord> {
      return ipcRenderer.invoke("session:create", workspaceId);
    },
    open(
      id: string,
    ): Promise<{ session: SessionRecord; messages: ChatMessage[] } | null> {
      return ipcRenderer.invoke("session:open", id);
    },
    /** 渲染层自建消息落库（上下文压缩摘要卡）；main 侧会校验并拒绝非法载荷 */
    appendMessage(
      sessionId: string,
      message: ChatMessage,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("session:append-message", sessionId, message);
    },
    rename(id: string, title: string): Promise<void> {
      return ipcRenderer.invoke("session:rename", id, title);
    },
    setDraft(id: string, draft: string): Promise<void> {
      return ipcRenderer.invoke("session:set-draft", id, draft);
    },
    pin(id: string, pinned: boolean): Promise<void> {
      return ipcRenderer.invoke("session:pin", id, pinned);
    },
    archive(id: string, archived: boolean): Promise<void> {
      return ipcRenderer.invoke("session:archive", id, archived);
    },
    remove(id: string): Promise<void> {
      return ipcRenderer.invoke("session:delete", id);
    },
  },
};
