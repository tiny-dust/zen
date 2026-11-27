import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASK_AUTO_ARCHIVE_MS } from "@zen/shared";

import { TaskRuntime } from "./runtime";
import { TaskStore } from "./store";

import type { TaskExecutionHandle, TaskExecutorAdapter, TaskExecutorResult } from "./runtime";
import type { Task } from "@zen/shared";

/** 让运行时里所有 await 链跑完（fake timers 下 setImmediate 也被替换，只能用微任务） */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

interface ExecutorCall {
  task: Task;
  handle: TaskExecutionHandle;
  resolve(result: TaskExecutorResult): void;
}

function makeExecutor(): { adapter: TaskExecutorAdapter; calls: ExecutorCall[] } {
  const calls: ExecutorCall[] = [];
  const adapter: TaskExecutorAdapter = {
    run: (task, handle) =>
      new Promise<TaskExecutorResult>((resolve) => {
        calls.push({ task, handle, resolve });
      }),
    stop: vi.fn(),
  };
  return { adapter, calls };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    title: "任务",
    goal: "做点事",
    trigger: { kind: "manual" },
    executor: { kind: "agent", tools: ["read"], model: null },
    grant: { level: 1, paths: [], grantedAt: 0 },
    budget: { maxRetries: 2 },
    acceptance: "auto",
    status: "idle",
    enabled: true,
    gen: 0,
    retryCount: 0,
    consecutiveFailures: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

let db: Database.Database;
let store: TaskStore;
let runtime: TaskRuntime;
let executor: ReturnType<typeof makeExecutor>;
let clock = 1_000_000;

function boot(): void {
  runtime = new TaskRuntime({
    store,
    executor: executor.adapter,
    now: () => clock,
    maxConcurrent: 2,
  });
  runtime.start();
}

function task(id: string): Task {
  const found = runtime.get(id);
  if (!found) {
    throw new Error(`task ${id} not found`);
  }
  return found.task;
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  db = new Database(":memory:");
  store = new TaskStore(db);
  executor = makeExecutor();
});

afterEach(() => {
  runtime?.shutdown();
  db.close();
  vi.useRealTimers();
});

describe("tasks runtime 队列与并发", () => {
  it("同刻最多 2 个执行，其余排队并给出顺位", async () => {
    boot();
    const ids = ["a", "b", "c"].map((id) => {
      const task = makeTask({ id, createdAt: clock });
      runtime.create(task);
      return id;
    });

    for (const id of ids) {
      expect(runtime.runNow(id)).toEqual({ ok: true });
    }

    expect(executor.calls).toHaveLength(2);
    const list = runtime.list();
    expect(list.queue.c).toMatchObject({ reason: "slot", position: 1, activeCount: 2, maxConcurrent: 2 });
    expect(task("a").status).toBe("running");
    expect(task("c").status).toBe("queued");

    // 一个执行结束后，排队的立刻补位
    executor.calls[0]!.resolve({ ok: true, summary: "先完成" });
    await flush();

    expect(task("a").status).toBe("done");
    expect(executor.calls).toHaveLength(3);
    expect(task("c").status).toBe("running");
    expect(runtime.list().queue.c).toBeUndefined();
  });

  it("执行记录：attempt 带会话、摘要与状态；每次转移写 journal", async () => {
    boot();
    runtime.create(makeTask({ id: "a" }));
    runtime.runNow("a");
    const call = executor.calls[0]!;
    call.handle.setSession("session-1");
    expect(store.getAttempt(call.handle.attemptId)?.sessionId).toBe("session-1");

    call.resolve({ ok: true, summary: "干完了", usage: { inputTokens: 5, outputTokens: 6 } });
    await flush();

    const attempts = runtime.get("a")!.attempts;
    expect(attempts[0]).toMatchObject({
      sessionId: "session-1",
      status: "succeeded",
      result: { summary: "干完了" },
      usage: { inputTokens: 5, outputTokens: 6 },
    });
    const transitions = runtime.journal("a").filter((entry) => entry.type === "transition");
    expect(transitions.map((entry) => [entry.from, entry.to])).toEqual([
      ["idle", "queued"],
      ["queued", "running"],
      ["running", "done"],
    ]);
    expect(transitions[0]!.seq).toBe(2); // seq 从 1 起：创建时先有一条 note
  });
});

describe("tasks runtime 重试", () => {
  it("可重试失败按退避重排，队列标 retry，到点后再次执行", async () => {
    boot();
    runtime.create(makeTask({ id: "a" }));
    runtime.runNow("a");

    executor.calls[0]!.resolve({
      ok: false,
      error: { code: "network", message: "断网" },
    });
    await flush();

    const queued = task("a");
    expect(queued.status).toBe("queued");
    expect(queued.retryCount).toBe(1);
    expect(queued.nextRunAt).toBe(clock + 2_000);
    expect(runtime.list().queue.a).toMatchObject({ reason: "retry", retryAt: clock + 2_000 });

    // 退避未到点不重新执行
    clock += 1_000;
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(executor.calls).toHaveLength(1);

    clock += 1_000;
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1]!.handle.cause).toBe("retry");
  });
});

describe("tasks runtime 重启恢复", () => {
  it("running 残留标 interrupted 并续跑", async () => {
    boot();
    runtime.create(makeTask({ id: "a" }));
    runtime.runNow("a");
    const attempt = store.getAttempt(executor.calls[0]!.handle.attemptId)!;
    expect(attempt.status).toBe("running");
    runtime.shutdown();

    // 模拟重启：新运行时读到同一个库
    boot();
    expect(store.getAttempt(attempt.id)?.status).toBe("interrupted");
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1]!.handle.cause).toBe("resume");
    expect(task("a").status).toBe("running");
    expect(task("a").gen).toBe(3);
  });
});

describe("tasks runtime 验收与退回", () => {
  it("user 验收：成功转 awaiting_accept，accept 后 done", async () => {
    boot();
    runtime.create(makeTask({ id: "a", acceptance: "user" }));
    runtime.runNow("a");
    executor.calls[0]!.resolve({ ok: true, summary: "初稿" });
    await flush();

    expect(task("a").status).toBe("awaiting_accept");
    expect(task("a").lastAttemptId).toBeDefined();

    const accepted = runtime.accept("a");
    expect(accepted?.status).toBe("done");
    expect(runtime.get("a")!.attempts[0]!.status).toBe("succeeded");
  });

  it("退回：带反馈重跑，反馈进入下一次执行", async () => {
    boot();
    runtime.create(makeTask({ id: "a", acceptance: "user" }));
    runtime.runNow("a");
    executor.calls[0]!.resolve({ ok: true, summary: "初稿" });
    await flush();

    const rejected = runtime.reject("a", "补测试");
    expect(rejected?.status).toBe("queued");
    await flush();

    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1]!.handle.cause).toBe("followup");
    expect(executor.calls[1]!.handle.note).toBe("补测试");
    expect(runtime.get("a")!.attempts.map((item) => item.status)).toContain("rejected");
  });
});

describe("tasks runtime 授权", () => {
  it("授权过期/撤销的任务不执行，转 expired 并记日志", async () => {
    boot();
    runtime.create(
      makeTask({
        id: "expired",
        grant: { level: 1, paths: [], grantedAt: 0, expiresAt: clock - 1 },
      }),
    );
    runtime.create(
      makeTask({ id: "revoked", grant: { level: 1, paths: [], grantedAt: 0, revokedAt: clock - 1 } }),
    );

    expect(runtime.runNow("expired")).toEqual({ ok: true });
    runtime.runNow("revoked");
    await flush();

    expect(task("expired").status).toBe("expired");
    expect(task("revoked").status).toBe("expired");
    expect(executor.calls).toHaveLength(0);
    const notes = runtime.journal("expired").filter((entry) => entry.type === "note");
    expect(notes.some((entry) => entry.summary?.includes("授权"))).toBe(true);
  });
});

describe("tasks runtime 归档", () => {
  it("失败需先确认；确认后归档，只有已归档能删除，删除级联清执行记录", async () => {
    boot();
    runtime.create(makeTask({ id: "a", budget: { maxRetries: 0 } }));
    runtime.runNow("a");
    executor.calls[0]!.resolve({
      ok: false,
      error: { code: "grant_denied", message: "没授权" },
    });
    await flush();
    expect(task("a").status).toBe("failed");

    expect(runtime.archive("a")?.ackedAt).toBeDefined();
    expect(task("a").archivedAt).toBeDefined();
    expect(runtime.remove("a")).toBe(true);
    expect(runtime.get("a")).toBeNull();
    expect(store.attempts("a")).toEqual([]);
    expect(store.journal("a")).toEqual([]);
  });

  it("未归档不能删除", async () => {
    boot();
    runtime.create(makeTask({ id: "a" }));
    expect(runtime.remove("a")).toBe(false);
    expect(runtime.get("a")).not.toBeNull();
  });

  it("终态满 24h 自动归档（失败未确认则跳过）", async () => {
    boot();
    const old = clock - TASK_AUTO_ARCHIVE_MS - 1;
    runtime.create(makeTask({ id: "done", status: "done", endedAt: old, createdAt: old }));
    runtime.create(makeTask({ id: "failed", status: "failed", endedAt: old, createdAt: old }));
    runtime.create(
      makeTask({ id: "acked", status: "failed", endedAt: old, createdAt: old, ackedAt: old }),
    );

    vi.advanceTimersByTime(3_000);
    await flush();

    expect(task("done").archivedAt).toBeDefined();
    expect(task("failed").archivedAt).toBeUndefined();
    expect(task("acked").archivedAt).toBeDefined();
  });
});

describe("tasks runtime 事件触发", () => {
  it("app.run.finished 触发启用任务，冷却期内不重复", async () => {
    boot();
    runtime.create(
      makeTask({
        id: "a",
        trigger: { kind: "event", source: "app.run.finished", cooldownMs: 1_000 },
        createdAt: clock,
      }),
    );

    runtime.fireEvent("app.run.finished");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]!.handle.cause).toBe("event");

    executor.calls[0]!.resolve({ ok: true, summary: "ok" });
    await flush();
    // 事件任务成功后回 idle，但仍受冷却约束
    expect(task("a").status).toBe("idle");
    runtime.fireEvent("app.run.finished");
    expect(executor.calls).toHaveLength(1);

    clock += 1_000;
    runtime.fireEvent("app.run.finished");
    expect(executor.calls).toHaveLength(2);
  });
});

describe("tasks runtime 取消", () => {
  it("取消运行中的任务：停止执行、尝试记 cancelled、迟到回报作废", async () => {
    boot();
    runtime.create(makeTask({ id: "a" }));
    runtime.runNow("a");
    const call = executor.calls[0]!;

    const cancelled = runtime.cancel("a");
    expect(cancelled?.status).toBe("cancelled");
    expect(executor.adapter.stop).toHaveBeenCalled();
    expect(store.getAttempt(call.handle.attemptId)?.status).toBe("cancelled");

    // 执行器随后返回成功：任务已取消，不能被改写成 done
    call.resolve({ ok: true, summary: "迟到的结果" });
    await flush();
    expect(task("a").status).toBe("cancelled");
  });
});
