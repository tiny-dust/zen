import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  records: new Map<string, {
    session: { id: string; workspaceId: string | null; archived: boolean };
    messages: Array<{ role: "user" | "assistant"; content: string; meta?: { elementMarks?: unknown[] } }>;
  }>(),
  run: vi.fn(),
  create: vi.fn(),
}));

vi.mock("electron", () => ({ Notification: class { static isSupported() { return false; } } }));
vi.mock("./model-db-connection", () => ({ getDb: () => state.db }));
vi.mock("./agent-runner", () => ({ runAgentRequest: (...args: unknown[]) => state.run(...args) }));
vi.mock("./i18n", () => ({ currentLocale: async () => "zh-CN", mainT: () => "scheduled" }));
vi.mock("./workspace-db", () => ({
  getSession: (id: string) => state.records.get(id),
  getWorkspace: (id: string) => id === "workspace" ? { path: "/repo" } : undefined,
  createSession: (...args: unknown[]) => state.create(...args),
  createWorkspace: () => ({ id: "workspace" }),
  listWorkspaceGroups: () => [],
  renameSession: vi.fn(),
}));

import {
  createScheduledTask,
  isTaskRunning,
  listScheduledTaskRuns,
  listScheduledTasks,
  runScheduledTaskNow,
  shutdownScheduler,
  startScheduler,
  updateScheduledTask,
} from "./scheduler";

const schedule = { kind: "interval" as const, every: 1, unit: "hour" as const };
const input = { name: "test", prompt: "continue", schedule, workspacePath: null };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  shutdownScheduler();
  state.db?.close();
  state.db = new Database(":memory:");
  state.records.clear();
  state.run.mockReset().mockResolvedValue({ ok: true });
  state.create.mockReset().mockImplementation(() => {
    const session = { id: "new-session", workspaceId: null, archived: false };
    state.records.set(session.id, { session, messages: [{ role: "assistant", content: "new reply" }] });
    return session;
  });
  state.records.set("existing", {
    session: { id: "existing", workspaceId: null, archived: false },
    messages: [{ role: "user", content: "previous" }, { role: "assistant", content: "reply" }],
  });
});

describe("scheduled task target session", () => {
  it("persists target across create, edit and list; permits clearing it", () => {
    const task = createScheduledTask({ ...input, targetSessionId: " existing " });
    expect(task).toMatchObject({ targetSessionId: "existing" });
    if (!("id" in task)) throw new Error("create failed");
    expect(listScheduledTasks()[0]?.targetSessionId).toBe("existing");
    expect(updateScheduledTask(task.id, { prompt: "updated" })).toMatchObject({ targetSessionId: "existing" });
    expect(updateScheduledTask(task.id, { targetSessionId: null })).toMatchObject({ targetSessionId: null });
  });

  it("rejects nonexistent, archived or mismatched target on create and edit", () => {
    expect(createScheduledTask({ ...input, targetSessionId: "missing" })).toHaveProperty("error");
    state.records.get("existing")!.session.archived = true;
    expect(createScheduledTask({ ...input, targetSessionId: "existing" })).toHaveProperty("error");
    state.records.get("existing")!.session.archived = false;
    expect(createScheduledTask({ ...input, targetSessionId: "existing", workspacePath: "/repo" })).toHaveProperty("error");
    const task = createScheduledTask(input);
    if (!("id" in task)) throw new Error("create failed");
    expect(updateScheduledTask(task.id, { targetSessionId: "missing" })).toHaveProperty("error");
  });

  it("reuses target and history; records each run with same session ID", async () => {
    const task = createScheduledTask({ ...input, targetSessionId: "existing" });
    if (!("id" in task)) throw new Error("create failed");
    runScheduledTaskNow(task.id);
    await flush();
    runScheduledTaskNow(task.id);
    await flush();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.run).toHaveBeenCalledTimes(2);
    expect(state.run.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "existing", workspaceId: "common", history: [
        { role: "user", content: "previous" }, { role: "assistant", content: "reply" },
      ],
    });
    expect(listScheduledTaskRuns(task.id).map((run) => run.sessionId)).toEqual(["existing", "existing"]);
    expect(listScheduledTasks()[0]?.lastSessionId).toBe("existing");
  });

  it("continues a session in its matching project workspace with recent history", async () => {
    state.records.set("project-session", {
      session: { id: "project-session", workspaceId: "workspace", archived: false },
      messages: [{ role: "user", content: "project context" }, { role: "assistant", content: "ready" }],
    });
    const task = createScheduledTask({ ...input, workspacePath: "/repo", targetSessionId: "project-session" });
    if (!("id" in task)) throw new Error("create failed");
    runScheduledTaskNow(task.id);
    await flush();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.run.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "project-session", workspaceId: "workspace", workspaceRoot: "/repo",
      history: [{ role: "user", content: "project context" }, { role: "assistant", content: "ready" }],
    });
  });

  it("does not run two tasks in the same session concurrently, releases lock after completion", async () => {
    let finish!: (value: { ok: boolean }) => void;
    state.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = createScheduledTask({ ...input, targetSessionId: "existing" });
    const second = createScheduledTask({ ...input, targetSessionId: "existing" });
    if (!("id" in first) || !("id" in second)) throw new Error("create failed");
    runScheduledTaskNow(first.id);
    runScheduledTaskNow(second.id);
    await flush();
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(listScheduledTaskRuns(second.id)[0]).toMatchObject({ ok: false, sessionId: null });
    finish({ ok: true });
    await flush();
    expect(isTaskRunning(first.id)).toBe(false);
    runScheduledTaskNow(second.id);
    await flush();
    expect(state.run).toHaveBeenCalledTimes(2);
  });

  it("binds the first dedicated session before running and reuses it after a failed run", async () => {
    const task = createScheduledTask(input);
    if (!("id" in task)) throw new Error("create failed");
    state.run.mockImplementationOnce(() => {
      expect(listScheduledTasks()[0]?.targetSessionId).toBe("new-session");
      return Promise.resolve({ ok: false, error: "run failed" });
    });
    runScheduledTaskNow(task.id);
    await flush();
    expect(listScheduledTasks()[0]).toMatchObject({ targetSessionId: "new-session", lastSessionId: "new-session" });
    runScheduledTaskNow(task.id);
    await flush();
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.run).toHaveBeenCalledTimes(2);
    expect(state.run.mock.calls[1]?.[0]).toMatchObject({
      sessionId: "new-session", workspaceId: "common", history: [{ role: "assistant", content: "new reply" }],
    });
    expect(listScheduledTaskRuns(task.id).map((run) => run.sessionId)).toEqual(["new-session", "new-session"]);
  });

  it("rejects destination edits during a run and checks workspace again before reuse", async () => {
    let finish!: (value: { ok: boolean }) => void;
    state.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const task = createScheduledTask(input);
    if (!("id" in task)) throw new Error("create failed");
    runScheduledTaskNow(task.id);
    await flush();
    expect(updateScheduledTask(task.id, { targetSessionId: null })).toHaveProperty("error");
    expect(updateScheduledTask(task.id, { workspacePath: "/repo" })).toHaveProperty("error");
    expect(listScheduledTasks()[0]?.targetSessionId).toBe("new-session");
    finish({ ok: true });
    await flush();
    state.records.get("new-session")!.session.workspaceId = "workspace";
    runScheduledTaskNow(task.id);
    await flush();
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(listScheduledTaskRuns(task.id)).toContainEqual(expect.objectContaining({
      ok: false, sessionId: null, summary: "target session workspace mismatch",
    }));
  });

  it("does not interrupt an active interactive session", async () => {
    const task = createScheduledTask({ ...input, targetSessionId: "existing" });
    if (!("id" in task)) throw new Error("create failed");
    const active = { getRunState: () => ({ runActive: true, waitingApproval: false, waitingAskCount: 0, inserting: false }) };
    startScheduler(() => {}, new Map([["existing", active]]) as never);
    runScheduledTaskNow(task.id);
    await flush();
    expect(state.run).not.toHaveBeenCalled();
    expect(listScheduledTaskRuns(task.id)[0]).toMatchObject({ ok: false, sessionId: null, summary: "target session is already running" });
  });

  it("fails safely when target is archived after task creation", async () => {
    const task = createScheduledTask({ ...input, targetSessionId: "existing" });
    if (!("id" in task)) throw new Error("create failed");
    state.records.get("existing")!.session.archived = true;
    runScheduledTaskNow(task.id);
    await flush();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(listScheduledTaskRuns(task.id)[0]).toMatchObject({ ok: false, sessionId: null });
  });
});
