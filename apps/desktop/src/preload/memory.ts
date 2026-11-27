import { ipcRenderer } from "electron";

import type {
  ConversationMemoryList,
  ConversationMemorySettings,
  ConversationMemoryState,
  MemoryCategory,
  MemoryConsolidationResult,
  MemoryNote,
  MemoryScope,
  MemoryIngestMessage,
  MemoryIngestResult,
  MemoryView,
} from "@zen/shared";

export const memoryApi = {
  memory: {
    /** 设备域只含分类索引（数量 + 摘要），正文走 notes() 按需读取 */
    get(): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:get");
    },
    /** 按分类读取备注正文（category 缺省 = 该域全部） */
    notes(scope: MemoryScope, category?: MemoryCategory): Promise<MemoryNote[]> {
      return ipcRenderer.invoke("memory:notes", scope, category);
    },
    addNote(scope: MemoryScope, text: string, category?: MemoryCategory): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:add-note", scope, text, category);
    },
    removeNote(scope: MemoryScope, id: string): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:remove-note", scope, id);
    },
    collect(): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:collect");
    },
    /** 整固预览：调模型算 diff，不落盘；失败返回 {ok:false, error} */
    consolidatePreview(scope: MemoryScope, providerId: string, modelId: string): Promise<MemoryConsolidationResult> {
      return ipcRenderer.invoke("memory:consolidate-preview", scope, providerId, modelId);
    },
    /** 应用整固：把预览确认过的 notes 原子写回 */
    applyConsolidation(
      scope: MemoryScope,
      notes: Array<{ id: string; text: string; createdAt: number }>,
    ): Promise<MemoryView> {
      return ipcRenderer.invoke("memory:apply", scope, notes);
    },

    /** 对话记忆（对照 nomi）：摘要 / 事实 / 档案 / 设置，与设备备注各自独立 */
    conversations: {
      state(): Promise<ConversationMemoryState> {
        return ipcRenderer.invoke("memory:conv-state");
      },
      list(query?: string): Promise<ConversationMemoryList> {
        return ipcRenderer.invoke("memory:conv-list", query);
      },
      /** 用一段会话生成摘要与事实；force = 忽略「太短 / 没新内容」的跳过条件 */
      ingest(
        sessionId: string,
        messages: MemoryIngestMessage[],
        options?: { force?: boolean },
      ): Promise<MemoryIngestResult> {
        return ipcRenderer.invoke("memory:conv-ingest", sessionId, messages, options);
      },
      updateEpisode(
        id: string,
        patch: { title?: string; summary?: string; pinned?: boolean },
      ): Promise<ConversationMemoryList> {
        return ipcRenderer.invoke("memory:conv-update-episode", id, patch);
      },
      upsertFact(input: {
        id?: string;
        text: string;
        kind: string;
        pinned?: boolean;
      }): Promise<ConversationMemoryList> {
        return ipcRenderer.invoke("memory:conv-upsert-fact", input);
      },
      remove(kind: "episode" | "fact", id: string): Promise<ConversationMemoryList> {
        return ipcRenderer.invoke("memory:conv-remove", kind, id);
      },
      persona(): Promise<string> {
        return ipcRenderer.invoke("memory:conv-persona");
      },
      setPersona(text: string): Promise<{ ok: boolean }> {
        return ipcRenderer.invoke("memory:conv-set-persona", text);
      },
      setSettings(patch: Partial<ConversationMemorySettings>): Promise<ConversationMemoryState> {
        return ipcRenderer.invoke("memory:conv-set-settings", patch);
      },
      /** 导出全部对话记忆（json / md），返回落盘路径 */
      exportAll(format: "json" | "md"): Promise<{ ok: boolean; path?: string; error?: string }> {
        return ipcRenderer.invoke("memory:conv-export", format);
      },
      /** 清空对话摘要与事实（保 persona 与设备备注） */
      clear(): Promise<ConversationMemoryList> {
        return ipcRenderer.invoke("memory:conv-clear");
      },
      /** 数据变化广播（自动摘要完成、设置变更后刷新） */
      onChanged(handler: () => void): () => void {
        const listener = () => handler();
        ipcRenderer.on("memory:conv-changed", listener);
        return () => {
          ipcRenderer.removeListener("memory:conv-changed", listener);
        };
      },
    },
  },
};
