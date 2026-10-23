// workspace-db 模型历史函数（load/append/rewrite/clear）：内存 better-sqlite3 建最小 schema，
// mock ./model-db-connection 的 getDb。跨轮回放语义（缓存前缀）见 agent-core 的
// model-history-replay.test.ts。
import Database from "better-sqlite3";

import { beforeEach, describe, expect, it, vi } from "vitest";

const testDb = new Database(":memory:");
testDb.exec(`
  CREATE TABLE chat_sessions (id TEXT PRIMARY KEY);
  CREATE TABLE session_model_messages (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    message_json TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
  );
  CREATE TABLE session_model_instructions (
    session_id TEXT NOT NULL PRIMARY KEY,
    instructions TEXT
  );
`);

vi.mock("./model-db-connection", () => ({ getDb: vi.fn(() => testDb) }));

import { getDb } from "./model-db-connection";

import {
  appendSessionModelHistory,
  clearSessionModelHistory,
  loadSessionModelHistory,
  rewriteSessionModelHistory,
} from "./workspace-db";

const SESSION = "sess-model-history";

const userMessage = { role: "user", content: "第一问" } as const;
const assistantMessage = { role: "assistant", content: "第一答" } as const;

beforeEach(() => {
  clearSessionModelHistory(SESSION);
});

describe("模型历史持久化（workspace-db）", () => {
  it("无记录返回 null（回落 ChatTurn 兜底）", () => {
    expect(loadSessionModelHistory(SESSION)).toBeNull();
  });

  it("append 增量续排，按 seq 升序读回，instructions 一并读取", () => {
    appendSessionModelHistory(SESSION, [userMessage]);
    appendSessionModelHistory(SESSION, [assistantMessage]);
    rewriteSessionModelHistory(SESSION, {
      messages: [userMessage, assistantMessage],
      instructions: "压缩摘要",
    });
    appendSessionModelHistory(SESSION, [{ role: "user", content: "第二问" } as const]);

    const history = loadSessionModelHistory(SESSION);
    expect(history?.instructions).toBe("压缩摘要");
    expect(history?.messages.map((item) => item.content)).toEqual([
      "第一问",
      "第一答",
      "第二问",
    ]);
  });

  it("rewrite 重建基线：旧行清除、instructions 覆盖", () => {
    appendSessionModelHistory(SESSION, [
      userMessage,
      assistantMessage,
      { role: "user", content: "多余" } as const,
    ]);
    rewriteSessionModelHistory(SESSION, {
      messages: [userMessage],
      instructions: null,
    });
    const history = loadSessionModelHistory(SESSION);
    expect(history?.messages).toEqual([userMessage]);
    expect(history?.instructions).toBeNull();
  });

  it("clear 全清后回落 null", () => {
    rewriteSessionModelHistory(SESSION, { messages: [userMessage], instructions: null });
    clearSessionModelHistory(SESSION);
    expect(loadSessionModelHistory(SESSION)).toBeNull();
  });

  it("脏 JSON 行被丢弃，不炸后续读取", () => {
    getDb()
      .prepare("INSERT INTO session_model_messages (session_id, seq, message_json) VALUES (?, ?, ?)")
      .run(SESSION, 1, "{broken json");
    getDb()
      .prepare("INSERT INTO session_model_messages (session_id, seq, message_json) VALUES (?, ?, ?)")
      .run(SESSION, 2, JSON.stringify(userMessage));
    const history = loadSessionModelHistory(SESSION);
    expect(history?.messages).toEqual([userMessage]);
  });
});
