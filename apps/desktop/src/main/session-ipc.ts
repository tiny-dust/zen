import { BrowserWindow, ipcMain, Notification } from "electron";
import { writeFile } from "node:fs/promises";

import type { ChatMessage, SessionMode } from "@zen/shared";
import { SESSION_MODES, normalizeSessionGoal } from "@zen/shared";

import { showOpenDialogSafe, showSaveDialogSafe } from "./dialog-safe";
import { completeOnce } from "./model-api";
import { getDb } from "./model-db-connection";
import { renderSessionHtml, renderSessionMarkdown } from "./session-export";
import { createSessionWorktree, getSessionWorktree, hasWorktreeInWorkspace, removeSessionWorktree } from "./session-worktree";
import {
  appendMessage,
  clearSessionModelHistory,
  createSession,
  createWorkspace,
  deleteSession,
  deleteWorkspace,
  getSession,
  getGoalRuntime,
  listWorkspaceGroups,
  renameSession,
  renameWorkspace,
  searchSessions,
  setSessionArchived,
  setSessionDraft,
  setSessionModel,
  setSessionPinned,
  setSessionWorkspace,
  setWorkspaceArchived,
  setWorkspacePinned,
  setSessionMode,
  setSessionGoal,
  trimMessagesFrom,
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

export function registerSessionIpc(
  isSessionRunning: (sessionId: string) => boolean = () => false,
): void {
  ipcMain.handle("session:worktree", (_event, sessionId: unknown) =>
    typeof sessionId === "string" ? getSessionWorktree(sessionId) : null,
  );

  ipcMain.handle("session:worktree:create", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return { ok: false, error: "会话 ID 无效" };
    }
    if (isSessionRunning(sessionId)) {
      return { ok: false, error: "请等待当前会话运行结束后再创建工作树" };
    }
    try {
      return { ok: true, worktree: await createSessionWorktree(sessionId) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "创建工作树失败" };
    }
  });

  ipcMain.handle("session:worktree:remove", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return { ok: false, error: "会话 ID 无效" };
    }
    if (isSessionRunning(sessionId)) {
      return { ok: false, error: "请等待当前会话运行结束后再移除工作树" };
    }
    try {
      await removeSessionWorktree(sessionId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "移除工作树失败" };
    }
  });

  ipcMain.handle("workspace:list", () => listWorkspaceGroups());

  ipcMain.handle("workspace:create", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = await showOpenDialogSafe(parent, {
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
    // 工作树可能有未提交改动；先要求逐会话移除，避免级联删除绑定后留下孤儿目录。
    if (hasWorktreeInWorkspace(id)) {
      throw new Error("工作区内仍有会话工作树，请先逐个移除");
    }
    deleteWorkspace(id);
    return listWorkspaceGroups();
  });

  ipcMain.handle("workspace:rename", (_event, id: string, name: string) => {
    if (typeof name === "string" && name.trim()) {
      renameWorkspace(id, name.trim());
    }
    return listWorkspaceGroups();
  });

  // id 可选：渲染层首发消息前补建当前会话时传入既有 id，避免换 id 丢状态
  ipcMain.handle("session:create", (_event, workspaceId: string | null, id?: string) =>
    createSession(workspaceId, typeof id === "string" ? id : undefined),
  );

  ipcMain.handle("session:set-workspace", (_event, id: string, workspaceId: string | null) => {
    if (typeof id === "string" && id.trim()) {
      const current = getSession(id)?.session.workspaceId ?? null;
      const target = workspaceId === "common" ? null : workspaceId;
      if (current !== target && getSessionWorktree(id)) {
        throw new Error("请先移除会话工作树，再切换工作区");
      }
      setSessionWorkspace(id, workspaceId);
    }
  });

  ipcMain.handle(
    "session:set-model",
    (_event, id: string, providerId: string | null, modelId: string | null) => {
      if (typeof id === "string" && id.trim()) {
        setSessionModel(id, providerId, modelId);
      }
    },
  );

  // 会话模式切换（interactive/plan/autopilot）；非法值忽略，保持原模式
  ipcMain.handle("session:set-mode", (_event, id: string, mode: string) => {
    if (
      typeof id === "string" &&
      id.trim() &&
      (SESSION_MODES as readonly string[]).includes(mode)
    ) {
      setSessionMode(id, mode as SessionMode);
    }
  });

  // 会话目标（Goals 目标模式）：载荷经 normalizeSessionGoal 归一化，
  // 非法/空载荷等价于清除目标（goal_json 置 NULL）
  ipcMain.handle("session:set-goal", (_event, id: string, goal: unknown) => {
    if (typeof id === "string" && id.trim()) {
      setSessionGoal(id, normalizeSessionGoal(goal));
    }
  });

  ipcMain.handle("session:get-goal-runtime", (_event, id: unknown) => {
    return typeof id === "string" && id.trim() ? getGoalRuntime(id) : null;
  });

  ipcMain.handle("session:open", (_event, id: string) => getSession(id) ?? null);

  // 仅后台会话由渲染层请求系统通知；计划任务本身已有独立通知，避免重复。
  ipcMain.handle("session:notify", (event, id: unknown, body: unknown): void => {
    if (typeof id !== "string" || !id || typeof body !== "string" || !body.trim()) return;
    try {
      if (!Notification.isSupported()) return;
      const scheduled = getDb()
        .prepare("SELECT 1 FROM scheduled_task_runs WHERE session_id = ? LIMIT 1")
        .get(id);
      if (scheduled) return;
      const record = getSession(id)?.session;
      if (!record) return;
      const notification = new Notification({
        title: record.title.slice(0, 80) || "Zen",
        body: body.trim().slice(0, 240),
      });
      notification.on("click", () => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.show();
        window?.focus();
        window?.webContents.send("session:open-request", id);
      });
      notification.show();
    } catch {
      // 三平台通知能力或数据库不可用时静默降级，不影响会话。
    }
  });

  // 全局会话搜索（侧栏）：标题 + 消息内容命中，标题命中优先；空词返回空列表
  ipcMain.handle("session:search", (_event, query: unknown, limit?: unknown) =>
    searchSessions(typeof query === "string" ? query : "", typeof limit === "number" ? limit : undefined),
  );

  // 渲染层自建消息落库（当前用于上下文压缩摘要卡）；会话不存在直接拒绝
  ipcMain.handle("session:append-message", (_event, sessionId: string, input: unknown) => {
    const message = sanitizeAppendableMessage(input);
    if (!message || typeof sessionId !== "string" || !getSession(sessionId)) {
      return { ok: false, error: "invalid message append request" };
    }
    appendMessage(sessionId, message);
    return { ok: true };
  });

  ipcMain.handle(
    "session:trim-messages",
    (_event, sessionId: string, fromCreatedAt: number) => {
      if (
        typeof sessionId !== "string" ||
        !getSession(sessionId) ||
        typeof fromCreatedAt !== "number" ||
        !Number.isFinite(fromCreatedAt)
      ) {
        return { ok: false, error: "invalid trim request" };
      }
      trimMessagesFrom(sessionId, fromCreatedAt);
      // 模型历史与展示历史就此分叉：模型历史无时间戳无法对齐裁剪，整体清除
      // 回落 ChatTurn 兜底，下一轮 run 用展示历史重建基线
      clearSessionModelHistory(sessionId);
      return { ok: true };
    },
  );

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

  ipcMain.handle("session:delete", async (_event, id: string) => {
    if (getSessionWorktree(id)) {
      if (isSessionRunning(id)) {
        throw new Error("请等待当前会话运行结束后再删除");
      }
      // git worktree remove 会拒绝有未提交改动的目录，防止删除用户代码。
      await removeSessionWorktree(id);
    }
    deleteSession(id);
  });

  /**
   * 从某条消息分叉出新会话：复制该消息及之前的可见对话，原会话保持不变。
   * 分叉点之后的消息（含同轮的后续轮次）不复制；新会话继承工作区、模型覆盖与模式，
   * 标题加「分叉」后缀。返回新会话 id，渲染层随后切过去继续对话。
   */
  ipcMain.handle("session:fork", (_event, sessionId: string, messageId: string) => {
    if (typeof sessionId !== "string" || typeof messageId !== "string") {
      return { ok: false, error: "invalid fork request" };
    }
    const record = getSession(sessionId);
    if (!record) {
      return { ok: false, error: "session not found" };
    }
    const index = record.messages.findIndex((message) => message.id === messageId);
    if (index < 0) {
      return { ok: false, error: "message not found" };
    }
    // 截到分叉点为止；去掉尾部工具消息，避免分叉尾巴挂着没有父消息的工具结果
    const slice = record.messages.slice(0, index + 1);
    while (slice.length && slice[slice.length - 1]?.role === "tool") {
      slice.pop();
    }
    if (!slice.some((message) => message.role === "user")) {
      return { ok: false, error: "fork point has no user message" };
    }
    const fork = createSession(record.session.workspaceId);
    const baseTitle = record.session.title?.trim() || "会话";
    renameSession(fork.id, `${baseTitle.slice(0, 60)}（分叉）`);
    if (record.session.modelProviderId && record.session.modelId) {
      setSessionModel(fork.id, record.session.modelProviderId, record.session.modelId);
    }
    setSessionMode(fork.id, record.session.mode ?? "interactive");
    for (const message of slice) {
      appendMessage(fork.id, message);
    }
    return { ok: true, sessionId: fork.id, messageCount: slice.length };
  });

  /**
   * 会话导出（HTML / Markdown 共用）：渲染文本 → 系统保存弹窗选路径 → 落盘。
   * 文件名取会话标题，剥掉路径非法字符；取消保存返回 { ok:true, canceled:true }。
   */
  async function exportSessionFile(
    event: Electron.IpcMainInvokeEvent,
    sessionId: string,
    format: "html" | "md",
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return { ok: false, error: "invalid session id" };
    }
    const record = getSession(sessionId);
    if (!record) {
      return { ok: false, error: "session not found" };
    }
    const payload = { session: record.session, messages: record.messages };
    const text = format === "html" ? renderSessionHtml(payload) : renderSessionMarkdown(payload);
    const defaultName = `${sanitizeTitle(record.session.title) || "session"}.${format}`.replace(
      /[\\/:*?"<>|]/g,
      "_",
    );
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = await showSaveDialogSafe(parent, {
      title: format === "html" ? "导出会话 HTML" : "导出会话 Markdown",
      defaultPath: defaultName,
      filters: [
        format === "html"
          ? { name: "HTML", extensions: ["html"] }
          : { name: "Markdown", extensions: ["md", "markdown"] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { ok: true, canceled: true };
    }
    try {
      await writeFile(result.filePath, text, "utf8");
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // 会话分享导出：自包含单文件 HTML（深色 MiMo 风格），保存位置由系统保存弹窗选择
  ipcMain.handle("session:export-html", (event, sessionId: string) =>
    exportSessionFile(event, sessionId, "html"),
  );

  // 会话导出 Markdown：纯文本，便于贴进笔记 / Issue / PR
  ipcMain.handle("session:export-md", (event, sessionId: string) =>
    exportSessionFile(event, sessionId, "md"),
  );
}
