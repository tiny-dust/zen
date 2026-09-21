import { dialog, ipcMain } from "electron";

import type { ChatMessage } from "@zen/shared";

import { completeOnce } from "./model-api";
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

const TITLE_SYSTEM_PROMPT = [
  "你是会话标题生成器，全部输出就是标题本身。",
  "根据对话内容给出一个具体、可区分的标题，使用对话的主要语言，不超过 20 个字，不加引号或句号。",
  "禁止输出思考过程、解释或 markdown 代码块。",
].join("\n");

/** 标题净化：取首行、去引号包装、限长 */
function sanitizeTitle(raw: string): string {
  const line = raw
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)[0] ?? "";
  const cleaned = line
    .replace(/^[("'“”「」【】\s]+|[)"'“”「」【】。\s]+$/g, "")
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
}

/** 用模型生成会话标题；模型不可用/超时抛错，由调用方兜底 */
async function generateSessionTitle(firstUserMessage: string, assistantReply?: string): Promise<string> {
  const user = firstUserMessage.trim().slice(0, 2000);
  if (!user) {
    return "";
  }
  const reply = (assistantReply ?? "").trim().slice(0, 1200);
  const prompt = [
    "根据下面的对话开头生成会话标题。",
    "只输出标题本身：一行、不超过 20 个字、不加引号/句号/前缀。",
    "",
    "用户消息：",
    user,
    ...(reply ? ["", "助手回复（节选）：", reply] : []),
  ].join("\n");
  return sanitizeTitle(
    await completeOnce(prompt, { maxTokens: 64, system: TITLE_SYSTEM_PROMPT, timeoutMs: 30_000 }),
  );
}

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

  // 自动会话标题：模型不可用/超时时返回 null，渲染层保留现有标题
  ipcMain.handle(
    "session:auto-title",
    async (_event, firstUserMessage: string, assistantReply?: string): Promise<string | null> => {
      if (typeof firstUserMessage !== "string" || !firstUserMessage.trim()) {
        return null;
      }
      try {
        const title = await generateSessionTitle(
          firstUserMessage,
          typeof assistantReply === "string" ? assistantReply : undefined,
        );
        return title || null;
      } catch {
        return null;
      }
    },
  );

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
