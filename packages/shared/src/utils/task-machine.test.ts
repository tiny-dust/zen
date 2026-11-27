import { describe, expect, it } from "vitest";

import { TASK_AUTO_PAUSE_AFTER_FAILURES, transition } from "./task-machine";

import type { Task, TaskAttempt, TaskStatus } from "../types";

const AT = 1_000_000;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
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

function runningTask(): { task: Task; attempt: TaskAttempt } {
  const task = makeTask({ status: "running", gen: 1, lastAttemptId: "a1" });
  const attempt: TaskAttempt = {
    id: "a1",
    taskId: "t1",
    gen: 1,
    cause: "manual",
    status: "running",
    startedAt: AT,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  return { task, attempt };
}

describe("task-machine 触发与排队", () => {
  it("手动触发从 idle 进入 queued 并请求入队，输入不被修改", () => {
    const task = makeTask();
    const result = transition(task, null, { type: "trigger", at: AT, cause: "manual" });

    expect(result.ok).toBe(true);
    expect(result.task.status).toBe("queued");
    expect(result.effects).toEqual([{ kind: "enqueue", cause: "manual" }]);
    // 纯函数：原对象不变
    expect(task.status).toBe("idle");
  });

  it("结束态只接受手动重开；运行中非手动触发按 busy 拒绝", () => {
    const done = makeTask({ status: "done" });
    expect(transition(done, null, { type: "trigger", at: AT, cause: "schedule" }).ok).toBe(false);
    expect(transition(done, null, { type: "trigger", at: AT, cause: "manual" }).task.status).toBe(
      "queued",
    );

    const running = makeTask({ status: "running" });
    const repeat = transition(running, null, { type: "trigger", at: AT, cause: "event" });
    expect(repeat.ok).toBe(false);
    expect(repeat.reason).toBe("busy");
  });

  it("暂停中的任务不触发；归档任务不触发", () => {
    expect(
      transition(makeTask({ enabled: false }), null, {
        type: "trigger",
        at: AT,
        cause: "manual",
      }).reason,
    ).toBe("paused");
    expect(
      transition(makeTask({ status: "done", archivedAt: AT }), null, {
        type: "trigger",
        at: AT,
        cause: "manual",
      }).reason,
    ).toBe("archived");
  });

  it("授权过期或已撤销 → expired 且不执行", () => {
    const expiredGrant = makeTask({
      grant: { level: 1, paths: [], grantedAt: 0, expiresAt: AT },
    });
    const expired = transition(expiredGrant, null, { type: "trigger", at: AT, cause: "manual" });
    expect(expired.task.status).toBe("expired");
    expect(expired.effects).toEqual([{ kind: "deliver", what: "expired" }]);

    const revoked = makeTask({
      grant: { level: 1, paths: [], grantedAt: 0, revokedAt: AT - 1 },
    });
    expect(
      transition(revoked, null, { type: "trigger", at: AT, cause: "manual" }).task.status,
    ).toBe("expired");
  });

  it("拿到并发名额：gen+1 并生成执行记录", () => {
    const queued = makeTask({ status: "queued" });
    const result = transition(queued, null, {
      type: "slot_acquired",
      at: AT,
      attemptId: "a1",
      cause: "manual",
    });

    expect(result.ok).toBe(true);
    expect(result.task.status).toBe("running");
    expect(result.task.gen).toBe(1);
    expect(result.attempt?.id).toBe("a1");
    expect(result.attempt?.gen).toBe(1);
    expect(result.attempt?.status).toBe("running");
  });

  it("重试退避未到点不执行", () => {
    const queued = makeTask({ status: "queued", nextRunAt: AT + 1 });
    const result = transition(queued, null, {
      type: "slot_acquired",
      at: AT,
      attemptId: "a1",
      cause: "retry",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_ready");
  });
});

describe("task-machine 执行结果", () => {
  it("一次性任务成功落 done；循环任务回 idle", () => {
    const { task, attempt } = runningTask();
    const done = transition(task, attempt, {
      type: "completed",
      at: AT + 10,
      gen: 1,
      summary: "ok",
    });
    expect(done.task.status).toBe("done");
    expect(done.task.endedAt).toBe(AT + 10);
    expect(done.attempt?.status).toBe("succeeded");
    expect(done.attempt?.result).toEqual({ summary: "ok" });
    expect(done.effects).toContainEqual({ kind: "release_slot", gen: 1 });

    const recurring = runningTask();
    const scheduleTask = {
      ...recurring.task,
      trigger: { kind: "schedule" as const, schedule: { kind: "interval" as const, every: 1, unit: "hour" as const } },
    };
    const again = transition(scheduleTask, recurring.attempt, {
      type: "completed",
      at: AT + 10,
      gen: 1,
      summary: "ok",
    });
    expect(again.task.status).toBe("idle");
  });

  it("旧代次的完成回报按 stale 丢弃", () => {
    const { task, attempt } = runningTask();
    const stale = transition(task, attempt, { type: "completed", at: AT, gen: 0, summary: "x" });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("stale");
    expect(stale.task.status).toBe("running");
  });

  it("验收：user 模式成功转 awaiting_accept，accept 后 done", () => {
    const { task, attempt } = runningTask();
    const waiting = transition({ ...task, acceptance: "user" }, attempt, {
      type: "completed",
      at: AT + 5,
      gen: 1,
      summary: "草稿",
    });
    expect(waiting.task.status).toBe("awaiting_accept");
    expect(waiting.attempt?.status).toBe("awaiting_accept");

    const accepted = transition(waiting.task, waiting.attempt, { type: "accept", at: AT + 9 });
    expect(accepted.task.status).toBe("done");
    expect(accepted.attempt?.status).toBe("succeeded");
  });

  it("退回：带反馈重排为 followup", () => {
    const { task, attempt } = runningTask();
    const waiting = transition({ ...task, acceptance: "user" }, attempt, {
      type: "completed",
      at: AT + 5,
      gen: 1,
      summary: "草稿",
    });
    const rejected = transition(waiting.task, waiting.attempt, {
      type: "reject",
      at: AT + 6,
      feedback: "  再补测试  ",
    });

    expect(rejected.task.status).toBe("queued");
    expect(rejected.attempt?.status).toBe("rejected");
    expect(rejected.effects).toEqual([
      { kind: "enqueue", cause: "followup", note: "再补测试" },
    ]);
  });

  it("可重试失败：退避 2^retry 秒后重排", () => {
    const { task, attempt } = runningTask();
    const failed = transition(task, attempt, {
      type: "failed",
      at: AT,
      gen: 1,
      error: { code: "network", message: "网络断开" },
    });

    expect(failed.task.status).toBe("queued");
    expect(failed.task.retryCount).toBe(1);
    expect(failed.task.nextRunAt).toBe(AT + 2_000);
    expect(failed.attempt?.status).toBe("failed");

    const second = transition(
      { ...failed.task, status: "running", gen: 2, lastAttemptId: "a2" },
      { ...failed.attempt!, id: "a2", gen: 2, status: "running" },
      { type: "failed", at: AT + 10, gen: 2, error: { code: "timed_out", message: "超时" } },
    );
    expect(second.task.retryCount).toBe(2);
    expect(second.task.nextRunAt).toBe(AT + 10 + 4_000);
  });

  it("重试次数用完落 failed；不可重试错误直接落 failed", () => {
    const { task, attempt } = runningTask();
    const exhausted = transition(
      { ...task, retryCount: 2 },
      attempt,
      { type: "failed", at: AT, gen: 1, error: { code: "network", message: "断网" } },
    );
    expect(exhausted.task.status).toBe("failed");
    expect(exhausted.task.retryCount).toBe(0);

    const denied = transition(makeTask({ ...runningTask().task, status: "running" }), attempt, {
      type: "failed",
      at: AT,
      gen: 1,
      error: { code: "grant_denied", message: "拒绝" },
    });
    expect(denied.task.status).toBe("failed");
  });

  it(`循环任务连续失败 ${TASK_AUTO_PAUSE_AFTER_FAILURES} 次后自动暂停并记 deliver`, () => {
    const trigger: Task["trigger"] = { kind: "event", source: "app.run.finished" };
    const { task, attempt } = runningTask();
    const recurring = {
      ...task,
      trigger,
      consecutiveFailures: TASK_AUTO_PAUSE_AFTER_FAILURES - 1,
      budget: { maxRetries: 0 },
    };
    const failed = transition(recurring, attempt, {
      type: "failed",
      at: AT,
      gen: 1,
      error: { code: "agent_failed", message: "炸了" },
    });

    expect(failed.task.status).toBe("idle");
    expect(failed.task.enabled).toBe(false);
    expect(failed.effects).toContainEqual({ kind: "deliver", what: "auto_paused" });
  });
});

describe("task-machine 人工操作与恢复", () => {
  it("取消运行中的任务：停止执行、释放名额、落 cancelled", () => {
    const { task, attempt } = runningTask();
    const cancelled = transition(task, attempt, { type: "cancel", at: AT });

    expect(cancelled.task.status).toBe("cancelled");
    expect(cancelled.attempt?.status).toBe("cancelled");
    expect(cancelled.effects).toContainEqual({ kind: "stop_attempt", gen: 1, reason: "cancel" });
    expect(cancelled.effects).toContainEqual({ kind: "release_slot", gen: 1 });
    // 代次前移，迟到的执行回报会被判 stale
    expect(cancelled.task.gen).toBe(2);
  });

  it("排队中暂停回到 idle，恢复后可再触发", () => {
    const paused = transition(makeTask({ status: "queued" }), null, { type: "pause", at: AT });
    expect(paused.task.status).toBe("idle");
    expect(paused.task.enabled).toBe(false);

    const resumed = transition(paused.task, null, { type: "resume", at: AT + 1 });
    expect(resumed.task.enabled).toBe(true);
  });

  it("重启恢复：running 的残留执行标 interrupted 并重排", () => {
    const { task, attempt } = runningTask();
    const restarted = transition(task, attempt, { type: "restarted", at: AT + 100 });

    expect(restarted.task.status).toBe("queued");
    expect(restarted.attempt?.status).toBe("interrupted");
    expect(restarted.effects).toEqual([{ kind: "enqueue", cause: "resume" }]);
  });

  it("确认 / 归档 / 还原 / 再次归档", () => {
    const failed = makeTask({ status: "failed", endedAt: AT });
    const acked = transition(failed, null, { type: "ack", at: AT + 1 });
    expect(acked.task.ackedAt).toBe(AT + 1);

    const archived = transition(acked.task, null, { type: "archive", at: AT + 2 });
    expect(archived.task.archivedAt).toBe(AT + 2);

    const restored = transition(archived.task, null, { type: "unarchive", at: AT + 3 });
    expect(restored.task.archivedAt).toBeUndefined();
    // 还原时重置终态计时，避免下一个 tick 立刻重新自动归档
    expect(restored.task.endedAt).toBe(AT + 3);

    // 归档失败任务会自动补 ack
    const autoAck = transition(failed, null, { type: "archive", at: AT + 4 });
    expect(autoAck.task.ackedAt).toBe(AT + 4);
  });

  it("等补充信息时 decide 才会重排；approval 等待不伪造", () => {
    const waiting = makeTask({
      status: "waiting_user" as TaskStatus,
      wait: { kind: "approval", resumeTo: "queued" },
    });
    expect(transition(waiting, null, { type: "decide", at: AT, input: "好了" }).ok).toBe(false);

    const asking = makeTask({
      status: "waiting_user",
      wait: { kind: "input", resumeTo: "queued" },
    });
    const decided = transition(asking, null, { type: "decide", at: AT, input: "用 A 方案" });
    expect(decided.task.status).toBe("queued");
    expect(decided.effects).toEqual([{ kind: "enqueue", cause: "resume", note: "用 A 方案" }]);
  });
});
