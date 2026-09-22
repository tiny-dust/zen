import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { app } from "electron";

import { zenRoot } from "./zen-dir";

let db: Database.Database | null = null;

/** better-sqlite3 报库文件损坏的错误码（SqliteError.code） */
const CORRUPT_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB"]);

function isCorruptError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (typeof code === "string" && CORRUPT_CODES.has(code)) ||
    error.message.includes("malformed") ||
    error.message.includes("not a database")
  );
}

/**
 * SQLite 全部落在 ~/.zen/db（ADR-004 用户域）；应用更新/重装不丢数据。
 * 旧版本曾存在 userData/db/zen.sqlite（含 -wal/-shm），首次打开时整体搬迁过来。
 */
function dbPath(): string {
  const dir = join(zenRoot(), "db");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "zen.sqlite");
  const legacyDir = join(app.getPath("userData"), "db");
  const legacy = join(legacyDir, "zen.sqlite");
  if (existsSync(legacy) && !existsSync(target)) {
    try {
      // WAL 未合并时数据在 -wal 里，三件套一起搬才不丢
      renameSync(legacy, target);
      for (const suffix of ["-wal", "-shm"]) {
        const part = join(legacyDir, `zen.sqlite${suffix}`);
        if (existsSync(part)) {
          renameSync(part, join(dir, `zen.sqlite${suffix}`));
        }
      }
    } catch {
      // 搬迁失败（跨盘/占用）时保留旧库继续用旧文件，不阻塞启动
      return legacy;
    }
  }
  return target;
}

function migrate(conn: Database.Database) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      api_key_mask TEXT NOT NULL DEFAULT '',
      user_agent TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_models (
      provider_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      custom INTEGER NOT NULL DEFAULT 0,
      capabilities_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider_id, id),
      FOREIGN KEY (provider_id) REFERENCES model_providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_selection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider_id TEXT,
      model_id TEXT
    );

    CREATE TABLE IF NOT EXISTS catalog_models (
      model_key TEXT PRIMARY KEY,
      vendor TEXT NOT NULL,
      vendor_label TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      kind TEXT NOT NULL DEFAULT 'workspace',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      reasoning_ms INTEGER,
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, id),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_task_lists (
      session_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, version),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  // 公共区：内置工作区，不绑定目录，不可删除
  conn
    .prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, path, kind, archived, created_at)
       VALUES ('common', '公共区', NULL, 'common', 0, ?)`,
    )
    .run(Date.now());

  const providerCols = conn.prepare(`PRAGMA table_info(model_providers)`).all() as Array<{
    name: string;
  }>;
  if (!providerCols.some((col) => col.name === "api_key_mask")) {
    conn.exec(`ALTER TABLE model_providers ADD COLUMN api_key_mask TEXT NOT NULL DEFAULT ''`);
  }
  if (!providerCols.some((col) => col.name === "user_agent")) {
    conn.exec(`ALTER TABLE model_providers ADD COLUMN user_agent TEXT`);
  }
  if (!providerCols.some((col) => col.name === "enabled")) {
    conn.exec(`ALTER TABLE model_providers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`);
  }

  const modelCols = conn.prepare(`PRAGMA table_info(provider_models)`).all() as Array<{
    name: string;
  }>;
  if (!modelCols.some((col) => col.name === "enabled")) {
    conn.exec(`ALTER TABLE provider_models ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`);
  }
  if (!modelCols.some((col) => col.name === "custom")) {
    conn.exec(`ALTER TABLE provider_models ADD COLUMN custom INTEGER NOT NULL DEFAULT 0`);
  }

  const workspaceCols = conn.prepare(`PRAGMA table_info(workspaces)`).all() as Array<{
    name: string;
  }>;
  if (!workspaceCols.some((col) => col.name === "pinned")) {
    conn.exec(`ALTER TABLE workspaces ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
  }

  const sessionCols = conn.prepare(`PRAGMA table_info(chat_sessions)`).all() as Array<{
    name: string;
  }>;
  if (sessionCols.length) {
    if (!sessionCols.some((col) => col.name === "draft")) {
      conn.exec(`ALTER TABLE chat_sessions ADD COLUMN draft TEXT NOT NULL DEFAULT ''`);
    }
    if (!sessionCols.some((col) => col.name === "pinned")) {
      conn.exec(`ALTER TABLE chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    }
    if (!sessionCols.some((col) => col.name === "archived")) {
      conn.exec(`ALTER TABLE chat_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    }
    // 会话归属：GitHub 登录账号（login）；'' = 无主（未登录创建/历史数据）
    if (!sessionCols.some((col) => col.name === "user_id")) {
      conn.exec(`ALTER TABLE chat_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    }
  }
}

/** 损坏库改名留档（zen.sqlite.corrupt-<时间戳>），供事后 sqlite3 .recover 手工抢救 */
function quarantineCorruptDb(target: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(target, `${target}.corrupt-${stamp}`);
  for (const suffix of ["-wal", "-shm"]) {
    const part = `${target}${suffix}`;
    if (existsSync(part)) {
      renameSync(part, `${part}.corrupt-${stamp}`);
    }
  }
}

/** 打开并完成建表/迁移；打开成功但中途失败时先关连接再抛出 */
function openAndMigrate(path: string): Database.Database {
  const conn = new Database(path);
  try {
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    migrate(conn);
  } catch (error) {
    conn.close();
    throw error;
  }
  return conn;
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }
  const target = dbPath();
  try {
    db = openAndMigrate(target);
  } catch (error) {
    // 库文件损坏（进程强杀/磁盘满等）时不能让启动静默中断：
    // 隔离损坏文件留档，重建空库继续；非损坏错误原样抛出。
    if (!isCorruptError(error)) {
      throw error;
    }
    quarantineCorruptDb(target);
    console.warn(`[zen] SQLite 库损坏，已隔离并重建空库: ${target}`, error);
    db = openAndMigrate(target);
  }
  return db;
}
