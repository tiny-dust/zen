import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { decodeChatMessageMeta, encodeChatMessageMeta, uuidv7 } from "@zen/shared";

import { getDb } from "./model-db-connection";

import type { ChatMessage, SessionRecord, TaskItem, Workspace, WorkspaceGroup } from "@zen/shared";

interface WorkspaceRow {
  id: string;
  name: string;
  path: string | null;
  kind: "workspace" | "common";
  pinned: number;
  archived: number;
  created_at: number;
}

interface SessionRow {
  id: string;
  title: string;
  workspace_id: string | null;
  draft: string;
  pinned: number;
  archived: number;
  user_id: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  role: ChatMessage["role"];
  content: string;
  reasoning: string | null;
  reasoning_ms: number | null;
  meta_json: string | null;
  created_at: number;
}

const COMMON_ID = "common";

/**
 * 会话归属（用户数据隔离）：user_id = GitHub 登录账号 login。
 * 登录用户只看得到自己的会话；未登录只看得到无主会话（user_id=''），
 * 换账号登录后互相看不到历史。无主会话由首个登录的账号收养。
 */
let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId?.trim() || null;
}

function ownerSql(): string {
  return currentUserId ? "user_id = ?" : "user_id = ''";
}

function ownerParams(): string[] {
  return currentUserId ? [currentUserId] : [];
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    kind: row.kind,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: row.created_at,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    draft: row.draft ?? "",
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  const decoded = decodeChatMessageMeta(row.meta_json);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning ?? undefined,
    reasoningMs: row.reasoning_ms ?? undefined,
    ...(decoded.parts?.length ? { parts: decoded.parts } : {}),
    ...(decoded.meta ? { meta: decoded.meta } : {}),
    createdAt: row.created_at,
  };
}

/** 侧栏数据源：全部工作区（含归档与公共区）+ 当前用户可见的会话，置顶优先、按更新时间倒序 */
export function listWorkspaceGroups(): WorkspaceGroup[] {
  const db = getDb();
  // 登录后收养无主会话（升级前/未登录时创建的历史数据归首个登录账号）
  if (currentUserId) {
    db.prepare("UPDATE chat_sessions SET user_id = ? WHERE user_id = ''").run(currentUserId);
  }
  const workspaces = db
    .prepare("SELECT * FROM workspaces ORDER BY pinned DESC, created_at ASC")
    .all() as WorkspaceRow[];
  const sessions = db
    .prepare(`SELECT * FROM chat_sessions WHERE ${ownerSql()} ORDER BY pinned DESC, updated_at DESC`)
    .all(...ownerParams()) as SessionRow[];
  return workspaces.map((row) => ({
    ...toWorkspace(row),
    sessions: sessions.filter((item) => (item.workspace_id ?? COMMON_ID) === row.id).map(toSession),
  }));
}

/** 新建工作区：以所选目录的 basename 命名；同一目录只建一次 */
export function createWorkspace(path: string): Workspace {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM workspaces WHERE path = ?").get(path) as
    | WorkspaceRow
    | undefined;
  if (existing) {
    return toWorkspace(existing);
  }
  const row: WorkspaceRow = {
    id: randomUUID(),
    name: basename(path),
    path,
    kind: "workspace",
    pinned: 0,
    archived: 0,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO workspaces (id, name, path, kind, pinned, archived, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
  ).run(row.id, row.name, row.path, row.kind, row.created_at);
  return toWorkspace(row);
}

export function setWorkspacePinned(id: string, pinned: boolean): void {
  if (id === COMMON_ID) {
    return;
  }
  getDb()
    .prepare("UPDATE workspaces SET pinned = ? WHERE id = ? AND kind = 'workspace'")
    .run(pinned ? 1 : 0, id);
}

export function setWorkspaceArchived(id: string, archived: boolean): void {
  if (id === COMMON_ID) {
    return;
  }
  getDb().prepare("UPDATE workspaces SET archived = ? WHERE id = ? AND kind = 'workspace'").run(
    archived ? 1 : 0,
    id,
  );
}

/** 工作区重命名：只改显示名，不改目录路径；公共区与不存在的工作区忽略 */
export function renameWorkspace(id: string, name: string): void {
  if (id === COMMON_ID || !name.trim()) {
    return;
  }
  getDb()
    .prepare("UPDATE workspaces SET name = ? WHERE id = ? AND kind = 'workspace'")
    .run(name.trim(), id);
}

/** 删除工作区；其下会话与消息经 FK ON DELETE CASCADE 一并清除 */
export function deleteWorkspace(id: string): void {
  getDb().prepare("DELETE FROM workspaces WHERE id = ? AND kind = 'workspace'").run(id);
}

export function getWorkspace(id: string | null | undefined): Workspace | undefined {
  if (!id) {
    return undefined;
  }
  const row = getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
    | WorkspaceRow
    | undefined;
  return row ? toWorkspace(row) : undefined;
}

export function createSession(workspaceId: string | null, id?: string): SessionRecord {
  const db = getDb();
  const effective = workspaceId && getWorkspace(workspaceId) ? workspaceId : null;
  const row: SessionRow = {
    id: id?.trim() || uuidv7(),
    title: "新会话",
    workspace_id: effective === COMMON_ID ? null : effective,
    draft: "",
    pinned: 0,
    archived: 0,
    user_id: currentUserId ?? "",
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  // 指定 id 重复创建（补建竞态）不报错，返回既有记录
  db.prepare(
    `INSERT OR IGNORE INTO chat_sessions (id, title, workspace_id, draft, pinned, archived, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.title, row.workspace_id, row.draft, row.pinned, row.archived, row.user_id, row.created_at, row.updated_at);
  const existing = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(row.id) as
    | SessionRow
    | undefined;
  return existing ? toSession(existing) : toSession(row);
}

/** 会话迁移到其它工作区/公共区（composer 底栏选择器）；common 映射为无归属 */
export function setSessionWorkspace(id: string, workspaceId: string | null): void {
  const effective = workspaceId && getWorkspace(workspaceId) ? workspaceId : null;
  getDb()
    .prepare(
      `UPDATE chat_sessions SET workspace_id = ?, updated_at = ? WHERE id = ? AND ${ownerSql()}`,
    )
    .run(effective === COMMON_ID ? null : effective, Date.now(), id, ...ownerParams());
}

export function getSession(id: string):
  | {
      session: SessionRecord;
      messages: ChatMessage[];
      taskLists: Array<{ version: number; items: TaskItem[]; createdAt: number }>;
    }
  | undefined {
  const db = getDb();
  // 归属校验：非本人（或未登录时的非无主）会话一律视为不存在
  const row = db
    .prepare(`SELECT * FROM chat_sessions WHERE id = ? AND ${ownerSql()}`)
    .get(id, ...ownerParams()) as SessionRow | undefined;
  if (!row) {
    return undefined;
  }
  const messages = db
    .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(id) as MessageRow[];
  return {
    session: toSession(row),
    messages: messages.map(toMessage),
    taskLists: loadTaskLists(id),
  };
}

/** 任务清单落库：同 version 覆盖（updateTasks 增量更新当前版） */
export function saveTaskList(sessionId: string, version: number, items: TaskItem[]): void {
  if (version <= 0) {
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO session_task_lists (session_id, version, items_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, version) DO UPDATE SET items_json = excluded.items_json`,
    )
    .run(sessionId, version, JSON.stringify(items), Date.now());
}

export function loadTaskLists(
  sessionId: string,
): Array<{ version: number; items: TaskItem[]; createdAt: number }> {
  const rows = getDb()
    .prepare(
      "SELECT version, items_json, created_at FROM session_task_lists WHERE session_id = ? ORDER BY version ASC",
    )
    .all(sessionId) as Array<{ version: number; items_json: string; created_at: number }>;
  const lists: Array<{ version: number; items: TaskItem[]; createdAt: number }> = [];
  for (const row of rows) {
    try {
      const items = JSON.parse(row.items_json) as TaskItem[];
      if (Array.isArray(items)) {
        lists.push({ version: row.version, items, createdAt: row.created_at });
      }
    } catch {
      // 忽略脏数据
    }
  }
  return lists;
}

export function renameSession(id: string, title: string): void {
  getDb()
    .prepare(`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND ${ownerSql()}`)
    .run(title, Date.now(), id, ...ownerParams());
}

/** 输入草稿随输随存（渲染层防抖调用），切会话回来可恢复 */
export function setSessionDraft(id: string, draft: string): void {
  getDb()
    .prepare(`UPDATE chat_sessions SET draft = ?, updated_at = ? WHERE id = ? AND ${ownerSql()}`)
    .run(draft, Date.now(), id, ...ownerParams());
}

export function setSessionPinned(id: string, pinned: boolean): void {
  getDb()
    .prepare(`UPDATE chat_sessions SET pinned = ? WHERE id = ? AND ${ownerSql()}`)
    .run(pinned ? 1 : 0, id, ...ownerParams());
}

export function setSessionArchived(id: string, archived: boolean): void {
  getDb()
    .prepare(`UPDATE chat_sessions SET archived = ? WHERE id = ? AND ${ownerSql()}`)
    .run(archived ? 1 : 0, id, ...ownerParams());
}

export function deleteSession(id: string): void {
  getDb()
    .prepare(`DELETE FROM chat_sessions WHERE id = ? AND ${ownerSql()}`)
    .run(id, ...ownerParams());
}

/** 首条消息后把「新会话」改成消息摘要，作为侧栏标题 */
export function ensureSessionTitle(id: string, title: string): void {
  getDb()
    .prepare(
      `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND title = '新会话' AND ${ownerSql()}`,
    )
    .run(title, Date.now(), id, ...ownerParams());
}

export function appendMessage(sessionId: string, message: ChatMessage): void {
  // 归属校验：非本人会话拒绝落库（防其他账号向其注入消息）
  const owned = getDb()
    .prepare(`SELECT 1 FROM chat_sessions WHERE id = ? AND ${ownerSql()}`)
    .get(sessionId, ...ownerParams());
  if (!owned) {
    return;
  }
  // parts 并入 meta_json 持久化，避免改表结构
  const meta = encodeChatMessageMeta(message);
  // 任务快照与压缩摘要卡同 id 反复写入（摘要滚动更新）：冲突时覆盖；
  // 其余消息 INSERT OR IGNORE 防重复
  const metaKind = message.meta as { kind?: string; toolName?: string } | undefined;
  const upsert =
    (message.role === "tool" && metaKind?.kind === "tasks") || metaKind?.toolName === "contextCompact";
  const sql = upsert
    ? `INSERT INTO chat_messages (id, session_id, role, content, reasoning, reasoning_ms, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET content = excluded.content, meta_json = excluded.meta_json, created_at = excluded.created_at`
    : `INSERT OR IGNORE INTO chat_messages (id, session_id, role, content, reasoning, reasoning_ms, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  getDb()
    .prepare(sql)
    .run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.reasoning ?? null,
      message.reasoningMs ?? null,
      meta ? JSON.stringify(meta) : null,
      message.createdAt,
    );
  getDb().prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId);
}

/** 编辑插入/重试分叉：删除该时刻起的消息（含边界），保留更早轮次 */
export function trimMessagesFrom(sessionId: string, fromCreatedAt: number): void {
  const owned = getDb()
    .prepare(`SELECT 1 FROM chat_sessions WHERE id = ? AND ${ownerSql()}`)
    .get(sessionId, ...ownerParams());
  if (!owned) {
    return;
  }
  getDb()
    .prepare("DELETE FROM chat_messages WHERE session_id = ? AND created_at >= ?")
    .run(sessionId, fromCreatedAt);
  getDb().prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId);
}
