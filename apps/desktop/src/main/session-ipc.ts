import { dialog, ipcMain } from "electron";

import type { ChatMessage } from "@zen/shared";

import {
  appendMessage,
  createSession,
  createWorkspace,
  deleteSession,
  deleteWorkspace,
  getSession,
  listWorkspaceGroups,
  renameSession,
  setSessionArchived,
  setSessionDraft,
  setSessionPinned,
  setWorkspaceArchived,
  setWorkspacePinned,
} from "./workspace-db";

/** 渲染层可落库的消息角色（压缩摘要卡等 UI 自建消息）；工具流仍由 main 侧持久化 */
const APPENDABLE_ROLES = new Set(["user", "assistant", "tool", "system"]);

/** 校验渲染层提交的消息，缺字段或越权字段一律拒绝 */
function sanitizeAppendableMessage(input: unknown): ChatMessage | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    return null;
  }
  if (typeof raw.role !== "string" || !APPENDABLE_ROLES.has(raw.role)) {
    return null;
  }
  if (typeof raw.content !== "string" || typeof raw.createdAt !== "number") {
    return null;
  }
  return {
    id: raw.id,
    role: raw.role as ChatMessage["role"],
    content: raw.content,
    createdAt: raw.createdAt,
    ...(raw.toolCallId != null ? { toolCallId: raw.toolCallId as string } : {}),
    ...(raw.meta != null && typeof raw.meta === "object" ? { meta: raw.meta as Record<string, unknown> } : {}),
  };
}

export function registerSessionIpc(): void {
  ipcMain.handle("workspace:list", () => listWorkspaceGroups());

  ipcMain.handle("workspace:create", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择工作区目录",
      properties: ["openDirectory", "createDirectory"],
    });
    const dir = result.filePaths[0];
    if (!dir || result.canceled) {
      return null;
    }
    return createWorkspace(dir);
  });

  ipcMain.handle("workspace:pin", (_event, id: string, pinned: boolean) => {
    setWorkspacePinned(id, pinned === true);
    return listWorkspaceGroups();
  });

  ipcMain.handle("workspace:archive", (_event, id: string, archived: boolean) => {
    setWorkspaceArchived(id, archived === true);
    return listWorkspaceGroups();
  });

  ipcMain.handle("workspace:delete", (_event, id: string) => {
    deleteWorkspace(id);
    return listWorkspaceGroups();
  });

  ipcMain.handle("session:create", (_event, workspaceId: string | null) =>
    createSession(workspaceId),
  );

  ipcMain.handle("session:open", (_event, id: string) => getSession(id) ?? null);

  // 渲染层自建消息落库（当前用于上下文压缩摘要卡）；会话不存在直接拒绝
  ipcMain.handle("session:append-message", (_event, sessionId: string, input: unknown) => {
    const message = sanitizeAppendableMessage(input);
    if (!message || typeof sessionId !== "string" || !getSession(sessionId)) {
      return { ok: false, error: "invalid message append request" };
    }
    appendMessage(sessionId, message);
    return { ok: true };
  });

  ipcMain.handle("session:rename", (_event, id: string, title: string) => {
    if (typeof title === "string" && title.trim()) {
      renameSession(id, title.trim());
    }
  });

  ipcMain.handle("session:set-draft", (_event, id: string, draft: string) => {
    if (typeof draft === "string") {
      setSessionDraft(id, draft);
    }
  });

  ipcMain.handle("session:pin", (_event, id: string, pinned: boolean) => {
    setSessionPinned(id, pinned === true);
  });

  ipcMain.handle("session:archive", (_event, id: string, archived: boolean) => {
    setSessionArchived(id, archived === true);
  });

  ipcMain.handle("session:delete", (_event, id: string) => {
    deleteSession(id);
  });
}
