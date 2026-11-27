import { randomUUID } from "node:crypto";

import type { SideChatMessage, SideChatModelRef, SideChatRecord } from "@zen/shared";

import { getDb } from "./model-db-connection";

/**
 * 侧边对话落库：与主会话同库（zen.sqlite），独立表 side_chats。
 * 关闭标签只关视图——记录留在库里，重启后按 session_id 取回继续；
 * 主会话的消息表/状态完全不受影响（记录只在自己这张表里）。
 */

/** 单条侧聊最多保留的消息条数（超出的从最早开始丢弃） */
export const MAX_SIDE_CHAT_MESSAGES = 2000;
/** 单条正文 / 草稿的长度上限（characters） */
export const MAX_SIDE_CHAT_TEXT = 20000;

interface SideChatRow {
  id: string;
  session_id: string;
  workspace_id: string;
  title: string;
  seq: number;
  messages: string;
  draft: string;
  model: string | null;
  effort: string | null;
  created_at: number;
  updated_at: number;
}

/** 建表只跑一次（按连接缓存：单测换库时会重新建） */
const schemaReady = new WeakSet<object>();

function db(): ReturnType<typeof getDb> {
  const conn = getDb();
  if (!schemaReady.has(conn)) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS side_chats (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        seq INTEGER NOT NULL,
        messages TEXT NOT NULL,
        draft TEXT NOT NULL,
        model TEXT,
        effort TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS side_chats_session ON side_chats (session_id, seq);
    `);
    schemaReady.add(conn);
  }
  return conn;
}

/** messages JSON 容错：坏 JSON / 非数组 → 空数组；单条结构不合法 → 丢弃该条 */
function parseMessages(json: string | null): SideChatMessage[] {
  if (!json) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const messages: SideChatMessage[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
    if (!role || typeof raw.text !== "string") {
      continue;
    }
    messages.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
      role,
      text: raw.text,
      at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : 0,
      ...(typeof raw.error === "string" && raw.error ? { error: raw.error } : {}),
    });
  }
  return messages;
}

/** model JSON 容错：坏 JSON / 缺字段 → null（按「跟随默认模型」处理） */
function parseModel(json: string | null): SideChatModelRef | null {
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const ref = parsed as Record<string, unknown>;
  if (typeof ref.providerId !== "string" || typeof ref.modelId !== "string") {
    return null;
  }
  if (!ref.providerId || !ref.modelId) {
    return null;
  }
  return { providerId: ref.providerId, modelId: ref.modelId };
}

function toRecord(row: SideChatRow): SideChatRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    title: row.title,
    seq: row.seq,
    messages: parseMessages(row.messages),
    draft: row.draft ?? "",
    model: parseModel(row.model),
    effort: row.effort ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 某个主会话下的全部侧聊（seq 升序 = 创建顺序） */
export function listSideChats(sessionId: string): SideChatRecord[] {
  const rows = db()
    .prepare("SELECT * FROM side_chats WHERE session_id = ? ORDER BY seq ASC")
    .all(sessionId) as SideChatRow[];
  return rows.map(toRecord);
}

export function getSideChat(id: string): SideChatRecord | undefined {
  const row = db().prepare("SELECT * FROM side_chats WHERE id = ?").get(id) as
    | SideChatRow
    | undefined;
  return row ? toRecord(row) : undefined;
}

/** 新建：seq 按该主会话已有最大值 +1，标题跟着 seq 走 */
export function createSideChat(
  sessionId: string,
  workspaceId: string,
  now = Date.now(),
): SideChatRecord {
  const conn = db();
  const { maxSeq } = conn
    .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM side_chats WHERE session_id = ?")
    .get(sessionId) as { maxSeq: number };
  const seq = maxSeq + 1;
  const record: SideChatRecord = {
    id: randomUUID(),
    sessionId,
    workspaceId,
    title: `侧边对话 ${seq}`,
    seq,
    messages: [],
    draft: "",
    model: null,
    effort: null,
    createdAt: now,
    updatedAt: now,
  };
  conn
    .prepare(
      `INSERT INTO side_chats
         (id, session_id, workspace_id, title, seq, messages, draft, model, effort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      sessionId,
      workspaceId,
      record.title,
      seq,
      "[]",
      "",
      null,
      null,
      now,
      now,
    );
  return record;
}

/**
 * 整体覆盖写（消息 / 草稿 / 模型 / 更新时间）：只更新已存在的 id，
 * 渲染层凭空造 id 时不会写进任何行（返回 false）。
 */
export function writeSideChat(record: SideChatRecord): boolean {
  const info = db()
    .prepare(
      `UPDATE side_chats SET messages = ?, draft = ?, model = ?, effort = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(record.messages),
      record.draft,
      record.model ? JSON.stringify(record.model) : null,
      record.effort,
      record.updatedAt,
      record.id,
    );
  return info.changes > 0;
}

export function setSideChatModel(
  id: string,
  model: SideChatModelRef | null,
  effort: string | null,
  now = Date.now(),
): boolean {
  const info = db()
    .prepare("UPDATE side_chats SET model = ?, effort = ?, updated_at = ? WHERE id = ?")
    .run(model ? JSON.stringify(model) : null, effort, now, id);
  return info.changes > 0;
}

/** 删除侧聊记录（隐藏会话由调用方一并清理） */
export function removeSideChat(id: string): boolean {
  return db().prepare("DELETE FROM side_chats WHERE id = ?").run(id).changes > 0;
}
