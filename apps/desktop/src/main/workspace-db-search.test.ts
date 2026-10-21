import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendMessage, searchSessions, setCurrentUserId } from "./workspace-db";

// 内存库替换真实连接：workspace-db 全部数据访问都经 getDb（见 model-db-connection.ts）
let conn: Database.Database;
vi.mock("./model-db-connection", () => ({
  getDb: () => conn,
}));

function createMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      kind TEXT NOT NULL DEFAULT 'workspace',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_id TEXT,
      draft TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      user_id TEXT NOT NULL DEFAULT '',
      model_provider_id TEXT,
      model_id TEXT,
      mode TEXT NOT NULL DEFAULT 'interactive',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE chat_messages (
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
    INSERT INTO workspaces (id, name, kind, created_at) VALUES ('common', '公共区', 'common', 1);
  `);
  return db;
}

function insertSession(id: string, title: string, updatedAt: number, userId = "alice") {
  conn
    .prepare(
      `INSERT INTO chat_sessions (id, title, workspace_id, user_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?)`,
    )
    .run(id, title, userId, updatedAt, updatedAt);
}

beforeEach(() => {
  conn = createMemoryDb();
  setCurrentUserId("alice");
});

afterEach(() => {
  setCurrentUserId(null);
  conn.close();
});

describe("searchSessions", () => {
  it("标题命中", () => {
    insertSession("s1", "Vue 调试记录", 100);
    insertSession("s2", "无关会话", 200);
    expect(searchSessions("Vue").map((item) => item.id)).toEqual(["s1"]);
  });

  it("消息内容命中：标题不含关键词也能搜到", () => {
    insertSession("s1", "普通会话", 100);
    appendMessage("s1", {
      id: "m1",
      role: "user",
      content: "讨论一下 TypeScript 泛型的写法",
      createdAt: 101,
    });
    expect(searchSessions("泛型").map((item) => item.id)).toEqual(["s1"]);
  });

  it("ASCII 大小写不敏感；中文原样匹配", () => {
    insertSession("s1", "React Debug Notes", 100);
    expect(searchSessions("react").map((item) => item.id)).toEqual(["s1"]);
    expect(searchSessions("REACT").map((item) => item.id)).toEqual(["s1"]);
  });

  it("用户隔离：只返回当前账号的会话；未登录只看无主会话", () => {
    insertSession("mine", "我的会话", 100, "alice");
    insertSession("other", "别人的会话", 100, "bob");
    insertSession("legacy", "历史无主会话", 100, "");

    // 登录 alice：bob 与无主会话都不可见
    expect(searchSessions("会话").map((item) => item.id)).toEqual(["mine"]);

    // 未登录：只看得到无主会话（user_id=''）
    setCurrentUserId(null);
    expect(searchSessions("会话").map((item) => item.id)).toEqual(["legacy"]);
  });

  it("limit 截断结果条数", () => {
    for (let i = 0; i < 8; i += 1) {
      insertSession(`s${i}`, `调试会话 ${i}`, 100 + i);
    }
    expect(searchSessions("调试", 3)).toHaveLength(3);
  });

  it("标题命中优先于内容命中，其余按更新时间倒序", () => {
    insertSession("content-hit", "普通标题", 500);
    appendMessage("content-hit", {
      id: "m1",
      role: "user",
      content: "这里提到了关键词",
      createdAt: 501,
    });
    insertSession("title-hit-old", "关键词在标题里", 100);
    expect(searchSessions("关键词").map((item) => item.id)).toEqual(["title-hit-old", "content-hit"]);
  });

  it("空串与纯空格不触发查询，返回空列表", () => {
    insertSession("s1", "Vue 调试", 100);
    expect(searchSessions("")).toEqual([]);
    expect(searchSessions("   ")).toEqual([]);
  });

  it("LIKE 通配符按字面匹配：百分号不当作任意串", () => {
    insertSession("s1", "进度 100%", 100);
    insertSession("s2", "进度 1001", 200);
    expect(searchSessions("100%").map((item) => item.id)).toEqual(["s1"]);
  });
});
