import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  sessions: [] as Array<{ id: string; workspaceId: string | null }>,
  messages: new Map<string, Array<{ role: string; content: string }>>(),
  runs: [] as Array<{ request: Record<string, unknown>; options: unknown }>,
  renamed: [] as Array<{ id: string; title: string }>,
  notifications: [] as Array<{ title?: string; body?: string }>,
}));

vi.mock("electron", () => ({
  Notification: class {
    static isSupported() {
      return true;
    }
    constructor(private readonly options: { title?: string; body?: string }) {}
    show() {
      state.notifications.push(this.options);
    }
  },
}));
vi.mock("../model-db-connection", () => ({ getDb: () => state.db }));
vi.mock("../agent-runner", () => ({
  runAgentRequest: async (request: Record<string, unknown>, options: unknown) => {
    state.runs.push({ request, options });
    // 后台 run 的用量事件：执行记录要能累计进去
    (options as { send?: (event: unknown) => void }).send?.({
      type: "usage",
      sessionId: request.sessionId,
      inputTokens: 3,
      outputTokens: 4,
    });
    return { ok: true };
  },
}));
vi.mock("../workspace-db", () => ({
  createSession: () => {
    const session = { id: `session-${state.sessions.length + 1}`, workspaceId: null };
    state.sessions.push(session);
    state.messages.set(session.id, [{ role: "assistant", content: "干完了" }]);
    return session;
  },
  getSession: (id: string) => {
    const session = state.sessions.find((item) => item.id === id);
    return session ? { session, messages: state.messages.get(id) ?? [] } : undefined;
  },
  getWorkspace: () => undefined,
  renameSession: (id: string, title: string) => {
    state.renamed.push({ id, title });
  },
}));

import {
  acceptTask,
  createTask,
  decideTask,
  getTaskDetail,
  listTasks,
  runTaskNow,
  shutdownTasks,
  startTasksService,
  validateTaskInput,
} from "./service";

import type { AgentSession } from "@zen/agent-core";

const sessions = new Map<string, AgentSession>();
const cwd = process.cwd();

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "看门",
    goal: "检查一下仓库",
    trigger: { kind: "manual" },
    executor: { kind: "agent", tools: ["read"], model: null },
    grant: { level: 1, paths: [] },
    ...overrides,
  };
}

beforeEach(() => {
  state.db = new Database(":memory:");
  state.sessions.length = 0;
  state.messages.clear();
  state.runs.length = 0;
  state.renamed.length = 0;
  state.notifications.length = 0;
  startTasksService(() => undefined, sessions);
});

afterEach(() => {
  shutdownTasks();
  state.db?.close();
  state.db = null;
});

describe("tasks service 入参校验", () => {
  it("授权等级必须与能力自洽", () => {
    expect(
      validateTaskInput(
        input({ executor: { kind: "agent", tools: ["shell"] }, grant: { level: 2, paths: [] } }),
      ),
    ).toEqual({ error: "grant level is too low for executor tools" });
    expect(
      validateTaskInput(
        input({ executor: { kind: "agent", tools: ["file_write"] }, grant: { level: 1, paths: [] } }),
      ),
    ).toEqual({ error: "grant level is too low for executor tools" });
    expect(
      validateTaskInput(
        input({ executor: { kind: "notify", text: "喝水" }, grant: { level: 0, paths: [] } }),
      ),
    ).toHaveProperty("value");
  });

  it("授权目录必须是存在的绝对路径", () => {
    expect(
      validateTaskInput(input({ grant: { level: 2, paths: ["relative/dir"] } })),
    ).toEqual({ error: "grant path must be an existing absolute path" });
    expect(
      validateTaskInput(input({ grant: { level: 2, paths: ["/definitely/not/here"] } })),
    ).toEqual({ error: "grant path must be an existing absolute path" });
    expect(validateTaskInput(input({ grant: { level: 2, paths: [cwd] } }))).toHaveProperty("value");
  });

  it("调度与重试预算不合法时报错", () => {
    expect(
      validateTaskInput(input({ trigger: { kind: "schedule", schedule: { kind: "interval" } } })),
    ).toEqual({ error: "invalid task schedule" });
    expect(validateTaskInput(input({ budget: { maxRetries: 99 } }))).toEqual({
      error: "invalid task budget",
    });
  });
});

describe("tasks service 执行", () => {
  it("agent 任务：建专属会话、改名、提示词带完成标准/目录/能力约束，结果落摘要", async () => {
    const created = createTask(
      input({
        executor: {
          kind: "agent",
          tools: ["read"],
          doneWhen: "构建通过",
        },
        grant: { level: 1, paths: [cwd] },
      }),
    );
    expect(created).toHaveProperty("id");
    const id = (created as { id: string }).id;

    expect(runTaskNow(id)).toEqual({ ok: true });
    await flush();

    expect(state.runs).toHaveLength(1);
    const message = state.runs[0]!.request.userMessage as string;
    expect(message).toContain("检查一下仓库");
    expect(message).toContain("完成标准：构建通过");
    expect(message).toContain(`可读写目录：${cwd}`);
    expect(message).toContain("不要执行 shell 命令");
    expect(message).toContain("不要写文件");
    expect(state.renamed[0]!.title).toBe("任务 · 看门");

    const detail = getTaskDetail(id)!;
    expect(detail.task.status).toBe("done");
    expect(detail.attempts[0]).toMatchObject({
      sessionId: "session-1",
      status: "succeeded",
      result: { summary: "干完了" },
      usage: { inputTokens: 3, outputTokens: 4 },
    });
    expect(listTasks().tasks).toHaveLength(1);
  });

  it("notify 任务不跑 agent，只发系统通知", async () => {
    const created = createTask(
      input({ executor: { kind: "notify", text: "站起来走走" }, grant: { level: 0, paths: [] } }),
    );
    const id = (created as { id: string }).id;
    runTaskNow(id);
    await flush();

    expect(state.runs).toHaveLength(0);
    expect(state.notifications[0]).toMatchObject({ title: "看门", body: "站起来走走" });
    expect(getTaskDetail(id)!.task.status).toBe("done");
  });

  it("授权过期不执行，转 expired", async () => {
    const created = createTask(
      input({ grant: { level: 1, paths: [], expiresAt: Date.now() - 1_000 } }),
    );
    const id = (created as { id: string }).id;
    runTaskNow(id);
    await flush();

    expect(state.runs).toHaveLength(0);
    expect(getTaskDetail(id)!.task.status).toBe("expired");
  });

  it("非法入参不落库", () => {
    const before = listTasks().tasks.length;
    expect(createTask({ ...input(), title: "  " })).toEqual({ error: "task title is required" });
    expect(createTask("nope")).toEqual({ error: "invalid task input" });
    expect(listTasks().tasks).toHaveLength(before);
  });
});

describe("tasks service 人工环节", () => {
  it("验收通过的入口拒绝非法状态；补充信息只对 input 等待生效", () => {
    const created = createTask(input());
    const id = (created as { id: string }).id;
    expect(acceptTask(id)).toBeNull();
    expect(decideTask(id, "随便")).toBeNull();
  });
});
