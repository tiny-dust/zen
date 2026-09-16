import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { app } from "electron";

let db: Database.Database | null = null;

function dbPath(): string {
  const dir = join(app.getPath("userData"), "db");
  mkdirSync(dir, { recursive: true });
  return join(dir, "zen.sqlite");
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

  const sessionCols = conn.prepare(`PRAGMA table_info(chat_sessions)`).all() as Array<{
    name: string;
  }>;
  if (sessionCols.length && !sessionCols.some((col) => col.name === "draft")) {
    conn.exec(`ALTER TABLE chat_sessions ADD COLUMN draft TEXT NOT NULL DEFAULT ''`);
  }
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
