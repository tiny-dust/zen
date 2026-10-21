import { ipcRenderer } from "electron";

import type { ChatMessage, SessionGoal, SessionMode, SessionRecord } from "@zen/shared";

import { syncBrowserScope } from "./browser";

export const sessionApi = {
  session: {
    create(workspaceId: string | null, id?: string): Promise<SessionRecord> {
      // 新会话落在指定工作区：内嵌浏览器 scope 同步跟随（preload IPC 边界维护，见 browser.ts）
      return ipcRenderer.invoke("session:create", workspaceId, id).then((record) => {
        syncBrowserScope(workspaceId ?? record?.workspaceId);
        return record;
      });
    },
    setWorkspace(id: string, workspaceId: string | null): Promise<void> {
      return ipcRenderer
        .invoke("session:set-workspace", id, workspaceId)
        .then(() => syncBrowserScope(workspaceId));
    },
    /** 会话级模型覆盖；null 表示跟随全局默认模型 */
    setModel(id: string, providerId: string | null, modelId: string | null): Promise<void> {
      return ipcRenderer.invoke("session:set-model", id, providerId, modelId);
    },
    /** 会话模式（interactive/plan/autopilot）；plan 批准后 main 自动切回 interactive */
    setMode(id: string, mode: SessionMode): Promise<void> {
      return ipcRenderer.invoke("session:set-mode", id, mode);
    },
    /** 会话目标（Goals 目标模式）；null 表示清除目标 */
    setGoal(id: string, goal: SessionGoal | null): Promise<void> {
      return ipcRenderer.invoke("session:set-goal", id, goal);
    },
    open(
      id: string,
    ): Promise<{ session: SessionRecord; messages: ChatMessage[] } | null> {
      // 会话切换：按目标会话的工作区切换内嵌浏览器 scope（null = 公共区 → "common"）
      return ipcRenderer.invoke("session:open", id).then((found) => {
        if (found?.session) {
          syncBrowserScope(found.session.workspaceId);
        }
        return found;
      });
    },
    /** 全局会话搜索（侧栏）：标题 + 消息内容命中（标题命中优先），当前用户可见范围 */
    search(query: string, limit?: number): Promise<SessionRecord[]> {
      return ipcRenderer.invoke("session:search", query, limit);
    },
    /** 渲染层自建消息落库（上下文压缩摘要卡）；main 侧会校验并拒绝非法载荷 */
    appendMessage(
      sessionId: string,
      message: ChatMessage,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("session:append-message", sessionId, message);
    },
    /** 编辑插入/重试分叉：删除该时刻起的落库消息 */
    trimMessages(
      sessionId: string,
      fromCreatedAt: number,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("session:trim-messages", sessionId, fromCreatedAt);
    },
    rename(id: string, title: string): Promise<void> {
      return ipcRenderer.invoke("session:rename", id, title);
    },
    /** 自动会话标题：main 侧用模型生成，失败返回 null（渲染层保留现有标题） */
    autoTitle(firstUserMessage: string, assistantReply?: string): Promise<string | null> {
      return ipcRenderer.invoke("session:auto-title", firstUserMessage, assistantReply);
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
    /** 会话分享导出：主进程弹保存框并写自包含 HTML；取消返回 { ok, canceled } */
    exportHtml(
      id: string,
    ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> {
      return ipcRenderer.invoke("session:export-html", id);
    },
    /** CLI `zen-cli open <sessionId>`：主进程广播请求，渲染层切到目标会话 */
    onOpenRequest(handler: (sessionId: string) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) => {
        handler(sessionId);
      };
      ipcRenderer.on("session:open-request", listener);
      return () => {
        ipcRenderer.removeListener("session:open-request", listener);
      };
    },
  },
};
