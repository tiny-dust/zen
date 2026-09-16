import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { getDb } from "./model-db-connection";

import type { ChatMessage, SessionRecord, Workspace, WorkspaceGroup } from "@zen/shared";

interface WorkspaceRow {
  id: string;
  name: string;
  path: string | null;
  kind: "workspace" | "common";
  archived: number;
  created_at: number;
}

interface SessionRow {
  id: string;
  title: string;
  workspace_id: string | null;
  draft: string;
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

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    kind: row.kind,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning ?? undefined,
    reasoningMs: row.reasoning_ms ?? undefined,
    meta: row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
  };
}

/** 侧栏数据源：全部工作区（含归档与公共区）+ 各自未归档会话，按更新时间倒序 */
export function listWorkspaceGroups(): WorkspaceGroup[] {
  const db = getDb();
  const workspaces = db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC").all() as WorkspaceRow[];
  const sessions = db
    .prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC")
    .all() as SessionRow[];
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
    archived: 0,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO workspaces (id, name, path, kind, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(row.id, row.name, row.path, row.kind, row.created_at);
  return toWorkspace(row);
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

export function createSession(workspaceId: string | null): SessionRecord {
  const db = getDb();
  const effective = workspaceId && getWorkspace(workspaceId) ? workspaceId : null;
  const row: SessionRow = {
    id: randomUUID(),
    title: "新会话",
    workspace_id: effective === COMMON_ID ? null : effective,
    draft: "",
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO chat_sessions (id, title, workspace_id, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.title, row.workspace_id, row.draft, row.created_at, row.updated_at);
  return toSession(row);
}

export function getSession(id: string): { session: SessionRecord; messages: ChatMessage[] } | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  if (!row) {
    return undefined;
  }
  const messages = db
    .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(id) as MessageRow[];
  return { session: toSession(row), messages: messages.map(toMessage) };
}

export function renameSession(id: string, title: string): void {
  getDb().prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?").run(
    title,
    Date.now(),
    id,
  );
}

/** 输入草稿随输随存（渲染层防抖调用），切会话回来可恢复 */
export function setSessionDraft(id: string, draft: string): void {
  getDb().prepare("UPDATE chat_sessions SET draft = ?, updated_at = ? WHERE id = ?").run(
    draft,
    Date.now(),
    id,
  );
}

/** 首条消息后把「新会话」改成消息摘要，作为侧栏标题 */
export function ensureSessionTitle(id: string, title: string): void {
  getDb()
    .prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND title = '新会话'")
    .run(title, Date.now(), id);
}

export function appendMessage(sessionId: string, message: ChatMessage): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO chat_messages (id, session_id, role, content, reasoning, reasoning_ms, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.reasoning ?? null,
      message.reasoningMs ?? null,
      message.meta ? JSON.stringify(message.meta) : null,
      message.createdAt,
    );
  getDb().prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId);
}
