// 会话目标（Goals 目标模式）主进程侧回归：
// - normalizeSessionGoal：非法/空载荷归 null，非法状态归 active、非法预算归 null；
// - setSessionGoal 落库 / getSession 恢复（含暂停状态与预算）、null 清除、脏数据兜底；
// - goalDirective / appendGoalDirective：仅 active 注入，预算不进提示词。
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendGoalDirective, goalDirective } from "./session-mode";
import { getSession, setSessionGoal } from "./workspace-db";

import type { SessionGoal } from "@zen/shared";

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
      goal_json TEXT,
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
    CREATE TABLE session_task_lists (
      session_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, version),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    INSERT INTO workspaces (id, name, path, kind, archived, created_at) VALUES ('common', '公共区', NULL, 'common', 0, 1);
  `);
  return db;
}

function insertSession(id: string): void {
  conn
    .prepare(
      `INSERT INTO chat_sessions (id, title, workspace_id, created_at, updated_at)
       VALUES (?, 'T', NULL, 1, 1)`,
    )
    .run(id);
}

beforeEach(() => {
  conn = createMemoryDb();
});

afterEach(() => {
  conn.close();
  vi.clearAllMocks();
});

describe("normalizeSessionGoal（经 setSessionGoal 间接验证）", () => {
  it("空文本 / null 清空目标", () => {
    insertSession("s1");
    setSessionGoal("s1", { text: "   ", status: "active", tokenBudget: 1000 });
    expect(getSession("s1")?.session.goal).toBeNull();

    setSessionGoal("s1", { text: "有效目标", status: "active", tokenBudget: 1000 });
    expect(getSession("s1")?.session.goal?.text).toBe("有效目标");
    setSessionGoal("s1", null);
    expect(getSession("s1")?.session.goal).toBeNull();
  });

  it("非法状态归一化为 active，非法预算归一化为 null", () => {
    insertSession("s2");
    setSessionGoal("s2", {
      text: "目标",
      status: "unknown-status" as SessionGoal["status"],
      tokenBudget: -5,
    });
    const goal = getSession("s2")?.session.goal;
    expect(goal?.status).toBe("active");
    expect(goal?.tokenBudget).toBeNull();
  });
});

describe("goal 持久化与恢复", () => {
  it("setSessionGoal 落库：getSession 随 session:open 口径返回完整目标", () => {
    insertSession("s3");
    setSessionGoal("s3", { text: "完成登录模块", status: "paused", tokenBudget: 50000 });
    const goal = getSession("s3")?.session.goal;
    expect(goal).toEqual({ text: "完成登录模块", status: "paused", tokenBudget: 50000 });
  });

  it("更新与清除：同会话覆盖写，null 置空", () => {
    insertSession("s4");
    setSessionGoal("s4", { text: "目标 A", status: "active", tokenBudget: 1000 });
    setSessionGoal("s4", { text: "目标 B", status: "blocked", tokenBudget: null });
    expect(getSession("s4")?.session.goal).toEqual({
      text: "目标 B",
      status: "blocked",
      tokenBudget: null,
    });
    setSessionGoal("s4", null);
    expect(getSession("s4")?.session.goal).toBeNull();
  });

  it("脏 goal_json（非法 JSON / 非法结构）按无目标处理，不阻塞读取", () => {
    insertSession("s5");
    setSessionGoal("s5", { text: "目标", status: "active", tokenBudget: null });
    conn
      .prepare("UPDATE chat_sessions SET goal_json = ? WHERE id = ?")
      .run("{not-json", "s5");
    expect(getSession("s5")?.session.goal).toBeNull();
    insertSession("s6");
    conn
      .prepare("UPDATE chat_sessions SET goal_json = ? WHERE id = ?")
      .run(JSON.stringify({ nope: 1 }), "s6");
    expect(getSession("s6")?.session.goal).toBeNull();
  });
});

describe("goalDirective / appendGoalDirective", () => {
  it("仅 active 目标注入，目标文本出现在指令里", () => {
    const active: SessionGoal = { text: "完成登录模块", status: "active", tokenBudget: 50000 };
    expect(goalDirective(active)).toContain("完成登录模块");
    for (const status of ["paused", "blocked", "complete"] as const) {
      expect(goalDirective({ text: "目标", status, tokenBudget: null })).toBe("");
    }
    expect(goalDirective(null)).toBe("");
  });

  it("预算不进提示词；追加保持双换行分隔，无目标时原样返回", () => {
    const goal: SessionGoal = { text: "目标 X", status: "active", tokenBudget: 50000 };
    expect(goalDirective(goal)).not.toContain("50000");
    const combined = appendGoalDirective("基础提示词", goal);
    expect(combined).toContain("基础提示词");
    expect(combined).toContain("目标 X");
    expect(appendGoalDirective("基础提示词", null)).toBe("基础提示词");
    expect(appendGoalDirective("", goal)).toContain("目标 X");
  });
});
