import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSideChatHandlers, shutdownSideChatRuns } from "./side-chat-ipc";
import { createSession, listWorkspaceGroups, renameSession, searchSessions } from "./workspace-db";

import type { AgentSession } from "@zen/agent-core";
import type { SideChatStreamEvent } from "@zen/shared";

type RunAgent = typeof import("./agent-runner").runAgentRequest;

// 主进程侧聊链路：真库（临时文件）+ mock 的 agent-runner（不真跑模型）/ electron
let dbPath: string;
let conn: Database.Database;

vi.mock("./model-db-connection", () => ({
  getDb: () => conn,
}));
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("./agent-runner", () => ({ runAgentRequest: vi.fn() }));

/** 只建侧聊链路需要的表；chat_sessions 故意不带 side_chat_of（覆盖旧库就地补列） */
function createSchema(db: Database.Database): void {
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
      plan_model_provider_id TEXT,
      plan_model_id TEXT,
      act_model_provider_id TEXT,
      act_model_id TEXT,
      pair_mode INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'interactive',
      goal_json TEXT,
      runtime_cli TEXT,
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
    INSERT INTO workspaces (id, name, path, kind, archived, created_at)
      VALUES ('common', '公共区', NULL, 'common', 0, 1);
  `);
}

/** 可手动放行的 run：用来模拟「回答中」并发与停止 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let sessions: Map<string, AgentSession>;
let events: SideChatStreamEvent[];
let runAgent: ReturnType<typeof vi.fn>;
let handlers: ReturnType<typeof createSideChatHandlers>;

function createMainSession(title = "主会话"): string {
  const session = createSession("common");
  renameSession(session.id, title);
  return session.id;
}

function hiddenSessionOf(sideChatId: string): { id: string; title: string } {
  return conn
    .prepare("SELECT id, title FROM chat_sessions WHERE side_chat_of = ?")
    .get(sideChatId) as { id: string; title: string };
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "zen-side-chat-ipc-"));
  dbPath = join(dir, "zen.sqlite");
  conn = new Database(dbPath);
  createSchema(conn);

  sessions = new Map();
  events = [];
  runAgent = vi.fn();
  handlers = createSideChatHandlers({
    sessions,
    broadcast: (event) => events.push(event),
    runAgent: runAgent as unknown as RunAgent,
  });
});

afterEach(() => {
  shutdownSideChatRuns();
  conn.close();
  rmSync(join(dbPath, ".."), { recursive: true, force: true });
});

describe("side-chat IPC 校验", () => {
  it("create 要求主会话存在；list 非法入参返回空列表而不是抛错", () => {
    expect(() => handlers.create("not-exist")).toThrow(/session not found/);
    expect(() => handlers.create(42)).toThrow(/invalid session id/);

    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    expect(chat).toMatchObject({ sessionId, workspaceId: "common", title: "侧边对话 1", seq: 1 });
    expect(handlers.list(sessionId)).toEqual({ chats: [chat] });
    expect(handlers.list(undefined)).toEqual({ chats: [] });
  });

  it("save 只允许更新已存在 id，非法字段与超限被拒", () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);

    expect(handlers.save(null)).toMatchObject({ ok: false });
    expect(handlers.save("nope")).toMatchObject({ ok: false });
    expect(
      handlers.save({ id: "ghost", messages: [], draft: "", model: null, effort: null }),
    ).toEqual({ ok: false, error: "侧边对话不存在" });

    expect(
      handlers.save({
        ...chat,
        messages: [{ id: "m1", role: "user", text: "你好", at: 1 }],
        draft: "草稿",
        model: { providerId: "openai", modelId: "gpt-5" },
        effort: "high",
      }),
    ).toEqual({ ok: true });
    expect(handlers.list(sessionId).chats[0]).toMatchObject({
      draft: "草稿",
      model: { providerId: "openai", modelId: "gpt-5" },
      effort: "high",
    });
    expect(handlers.list(sessionId).chats[0]?.messages.map((item) => item.text)).toEqual(["你好"]);

    expect(handlers.save({ ...chat, messages: "not-array" })).toMatchObject({ ok: false });
    expect(
      handlers.save({ ...chat, messages: new Array(2001).fill({ role: "user", text: "x" }) }),
    ).toMatchObject({ ok: false });
    expect(handlers.save({ ...chat, model: { providerId: "" } })).toMatchObject({ ok: false });
  });

  it("setModel / send / remove 的非法 id 与超长正文都被拒，不抛", () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);

    expect(handlers.setModel("", null, null)).toMatchObject({ ok: false });
    expect(handlers.setModel(chat.id, { providerId: "", modelId: "" }, null)).toMatchObject({
      ok: false,
    });
    expect(handlers.setModel(chat.id, { providerId: "p", modelId: "m" }, "high")).toEqual({
      ok: true,
    });
    expect(handlers.list(sessionId).chats[0]).toMatchObject({
      model: { providerId: "p", modelId: "m" },
      effort: "high",
    });

    expect(handlers.send("", "hi")).toMatchObject({ ok: false });
    expect(handlers.send("ghost", "hi")).toEqual({ ok: false, error: "侧边对话不存在" });
    expect(handlers.send(chat.id, "   ")).toMatchObject({ ok: false });
    expect(handlers.send(chat.id, "x".repeat(20001))).toMatchObject({ ok: false });
    expect(handlers.send(chat.id, 123)).toMatchObject({ ok: false });
    expect(runAgent).not.toHaveBeenCalled();
  });
});

describe("side-chat 续写编排", () => {
  it("send：delta 实时广播，结束后 user+assistant 落库并广播 done，主会话无污染", async () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    const gate = deferred<{ ok: boolean }>();
    runAgent.mockImplementationOnce(async (request: { sessionId: string }, options: {
      send?: (event: unknown) => void;
    }) => {
      options.send?.({ type: "delta", sessionId: request.sessionId, text: "你" });
      options.send?.({ type: "delta", sessionId: request.sessionId, text: "好" });
      // 工具/思考事件必须被忽略且不崩
      options.send?.({ type: "reasoning_delta", sessionId: request.sessionId, text: "想" });
      return gate.promise;
    });

    expect(handlers.send(chat.id, "  你好  ")).toEqual({ ok: true });
    // 同一侧聊同时只允许一个 run
    expect(handlers.send(chat.id, "再来一条")).toEqual({ ok: false, error: "正在回答中" });

    gate.resolve({ ok: true });
    await vi.waitFor(() => expect(events.some((event) => event.type === "done")).toBe(true));

    expect(events.filter((event) => event.type === "delta")).toEqual([
      { id: chat.id, type: "delta", text: "你" },
      { id: chat.id, type: "delta", text: "好" },
    ]);
    expect(events.find((event) => event.type === "done")).toMatchObject({
      id: chat.id,
      message: { role: "assistant", text: "你好" },
    });

    const saved = handlers.list(sessionId).chats[0];
    expect(saved?.messages.map((item) => [item.role, item.text])).toEqual([
      ["user", "你好"],
      ["assistant", "你好"],
    ]);
    expect(saved?.messages.every((item) => !item.error)).toBe(true);

    // run 入参：隐藏会话（不是主会话）+ 该侧聊历史
    const [request, options] = runAgent.mock.calls[0] as [
      { sessionId: string; workspaceId: string; userMessage: string; history: unknown[] },
      { sessions: Map<string, AgentSession> },
    ];
    expect(request.sessionId).not.toBe(sessionId);
    expect(request.workspaceId).toBe("common");
    expect(request.userMessage).toBe("你好");
    expect(request.history).toEqual([]);
    expect(options.sessions).toBe(sessions);

    // 主会话消息表没有任何写入
    const mainMessages = conn
      .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?")
      .get(sessionId) as { count: number };
    expect(mainMessages.count).toBe(0);

    // 隐藏会话：标题对齐侧聊，且不进侧栏分组与搜索
    const hidden = hiddenSessionOf(chat.id);
    expect(hidden.title).toBe("侧边对话 1");
    const visibleIds = listWorkspaceGroups().flatMap((group) => group.sessions.map((s) => s.id));
    expect(visibleIds).toContain(sessionId);
    expect(visibleIds).not.toContain(hidden.id);
    expect(searchSessions("侧边对话").map((item) => item.id)).not.toContain(hidden.id);
  });

  it("失败：assistant 消息带 error 落库，广播 error 且不广播 done", async () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    runAgent.mockResolvedValueOnce({ ok: false, error: "模型超时" });

    expect(handlers.send(chat.id, "你好")).toEqual({ ok: true });
    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));

    expect(events.find((event) => event.type === "error")).toEqual({
      id: chat.id,
      type: "error",
      error: "模型超时",
    });
    expect(events.some((event) => event.type === "done")).toBe(false);

    const assistant = handlers
      .list(sessionId)
      .chats[0]?.messages.find((item) => item.role === "assistant");
    expect(assistant?.error).toBe("模型超时");
    // 失败轮次不进下一轮上下文
    expect(handlers.list(sessionId).chats[0]?.messages).toHaveLength(2);
  });

  it("stop：走 AgentSession.cancel，广播 stopped，部分正文保留且不算错误", async () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    const gate = deferred<{ ok: boolean; error?: string }>();
    runAgent.mockImplementationOnce(async (request: { sessionId: string }, options: {
      send?: (event: unknown) => void;
    }) => {
      options.send?.({ type: "delta", sessionId: request.sessionId, text: "写到一半" });
      return gate.promise;
    });

    expect(handlers.send(chat.id, "解释一下")).toEqual({ ok: true });
    const hidden = hiddenSessionOf(chat.id);
    const cancel = vi.fn(async () => undefined);
    sessions.set(hidden.id, { cancel } as unknown as AgentSession);

    const stopping = handlers.stop(chat.id);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    gate.resolve({ ok: false, error: "cancelled" });
    await expect(stopping).resolves.toEqual({ ok: true });

    expect(events.some((event) => event.type === "stopped")).toBe(true);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(sessions.has(hidden.id)).toBe(false);

    const assistant = handlers
      .list(sessionId)
      .chats[0]?.messages.find((item) => item.role === "assistant");
    expect(assistant?.text).toBe("写到一半");
    expect(assistant?.error).toBeUndefined();

    // 没有在跑时再 stop 返回失败
    await expect(handlers.stop(chat.id)).resolves.toMatchObject({ ok: false });
  });

  it("一轮结束后登记清理，可继续下一轮且历史带上一轮", async () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    runAgent.mockImplementation(async (request: { sessionId: string }, options: {
      send?: (event: unknown) => void;
    }) => {
      options.send?.({ type: "delta", sessionId: request.sessionId, text: "回复" });
      return { ok: true };
    });

    expect(handlers.send(chat.id, "第一轮")).toEqual({ ok: true });
    await vi.waitFor(() => expect(events.filter((e) => e.type === "done")).toHaveLength(1));

    expect(handlers.send(chat.id, "第二轮")).toEqual({ ok: true });
    await vi.waitFor(() => expect(events.filter((e) => e.type === "done")).toHaveLength(2));

    const secondRequest = runAgent.mock.calls[1]?.[0] as { history: unknown[] };
    expect(secondRequest.history).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "回复" },
    ]);
    // 两轮复用同一个隐藏会话
    const hiddenCount = conn
      .prepare("SELECT COUNT(*) AS count FROM chat_sessions WHERE side_chat_of = ?")
      .get(chat.id) as { count: number };
    expect(hiddenCount.count).toBe(1);
  });

  it("remove 删除记录并清掉隐藏会话", async () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    runAgent.mockImplementationOnce(async () => ({ ok: true }));
    handlers.send(chat.id, "你好");
    await vi.waitFor(() => expect(events.some((event) => event.type === "done")).toBe(true));

    const hidden = hiddenSessionOf(chat.id);
    expect(handlers.remove(chat.id)).toEqual({ ok: true });
    expect(handlers.list(sessionId).chats).toEqual([]);
    expect(
      conn.prepare("SELECT COUNT(*) AS count FROM chat_sessions WHERE id = ?").get(hidden.id),
    ).toEqual({ count: 0 });
  });

  it("shutdownSideChatRuns 丢弃在跑登记（重启后可继续），记录本身保留", async () => {
    const sessionId = createMainSession();
    const chat = handlers.create(sessionId);
    const gate = deferred<{ ok: boolean }>();
    runAgent.mockResolvedValue({ ok: true });
    runAgent.mockImplementationOnce(async () => gate.promise);

    handlers.send(chat.id, "重启前");
    shutdownSideChatRuns();
    // 登记已丢弃 → 不再被判为「正在回答中」
    expect(handlers.send(chat.id, "重启后")).toEqual({ ok: true });
    await vi.waitFor(() => expect(events.filter((e) => e.type === "done")).toHaveLength(1));

    gate.resolve({ ok: true });
    // 被 shutdown 标记为 stopped 的那轮只收尾落库，不再广播 done
    await vi.waitFor(() =>
      expect(handlers.list(sessionId).chats[0]?.messages).toHaveLength(4),
    );
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });
});
