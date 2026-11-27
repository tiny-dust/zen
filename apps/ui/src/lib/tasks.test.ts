import { describe, expect, it } from "vitest";

import {
  attemptStatusLabel,
  canArchive,
  executorLabel,
  fmtDuration,
  fmtTime,
  grantLevelLabel,
  grantLevelOf,
  groupOf,
  needsYou,
  resultSummary,
  stageOf,
  statusLabel,
  toolLabel,
  triggerLabel,
} from "@/lib/tasks";

import type { Task } from "@zen/shared";

function taskFixture(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "过一遍本周 PR",
    goal: "给出风险清单",
    trigger: { kind: "manual" },
    executor: { kind: "agent", tools: ["read"] },
    grant: { level: 1, paths: [], grantedAt: 1, expiresAt: 2 },
    budget: { maxRetries: 1 },
    acceptance: "user",
    status: "idle",
    enabled: true,
    gen: 1,
    retryCount: 0,
    consecutiveFailures: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("lib/tasks 阶段归属", () => {
  it("status → 看板四阶段", () => {
    expect(stageOf("idle")).toBe("todo");
    expect(stageOf("queued")).toBe("todo");
    expect(stageOf("running")).toBe("in_progress");
    expect(stageOf("needs_reconcile")).toBe("in_progress");
    expect(stageOf("waiting_user")).toBe("needs_you");
    expect(stageOf("awaiting_accept")).toBe("needs_you");
    expect(stageOf("done")).toBe("done");
    expect(stageOf("failed")).toBe("done");
    expect(stageOf("cancelled")).toBe("done");
    expect(stageOf("expired")).toBe("done");
  });

  it("groupOf 沿用任务状态，needsYou 只认两个待处理状态", () => {
    expect(groupOf(taskFixture({ status: "awaiting_accept" }))).toBe("needs_you");
    expect(needsYou(taskFixture({ status: "awaiting_accept" }))).toBe(true);
    expect(needsYou(taskFixture({ status: "waiting_user" }))).toBe(true);
    expect(needsYou(taskFixture({ status: "idle" }))).toBe(false);
    expect(needsYou(taskFixture({ status: "done" }))).toBe(false);
  });
});

describe("lib/tasks 可归档判断", () => {
  it("只有结束态可归档，进行中/待处理不可", () => {
    expect(canArchive(taskFixture({ status: "done" }))).toBe(true);
    expect(canArchive(taskFixture({ status: "cancelled" }))).toBe(true);
    expect(canArchive(taskFixture({ status: "running" }))).toBe(false);
    expect(canArchive(taskFixture({ status: "waiting_user" }))).toBe(false);
  });

  it("已归档的不再重复归档；失败任务要先「知道了」", () => {
    expect(canArchive(taskFixture({ status: "done", archivedAt: 10 }))).toBe(false);
    expect(canArchive(taskFixture({ status: "failed" }))).toBe(false);
    expect(canArchive(taskFixture({ status: "failed", ackedAt: 20 }))).toBe(true);
  });
});

describe("lib/tasks 文案键", () => {
  it("状态与执行记录状态都落在 tasks.* 命名空间", () => {
    expect(statusLabel("running")).toEqual({ key: "tasks.status.running" });
    expect(statusLabel("waiting_user").key).toBe("tasks.status.waiting_user");
    expect(attemptStatusLabel("interrupted").key).toBe("tasks.attemptStatus.interrupted");
  });

  it("触发文案：手动/事件/一次/每天/工作日/间隔", () => {
    expect(triggerLabel({ kind: "manual" })).toEqual({ key: "tasks.trigger.manual" });
    expect(triggerLabel({ kind: "event", source: "app.run.finished" }).key).toBe("tasks.trigger.event");

    const once = triggerLabel({ kind: "schedule", schedule: { kind: "once", at: new Date(2026, 0, 2, 3, 4).getTime() } });
    expect(once.key).toBe("tasks.trigger.once");
    expect(once.params).toEqual({ time: "01-02 03:04" });

    const daily = triggerLabel({
      kind: "schedule",
      schedule: { kind: "recurrence", every: 1, unit: "day", times: ["09:30"] },
    });
    expect(daily).toEqual({ key: "tasks.trigger.daily", params: { times: "09:30" } });

    const workdays = triggerLabel({
      kind: "schedule",
      schedule: { kind: "recurrence", every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5], times: ["08:00"] },
    });
    expect(workdays.key).toBe("tasks.trigger.workdays");

    const weekly = triggerLabel({
      kind: "schedule",
      schedule: { kind: "recurrence", every: 1, unit: "week", weekdays: [1, 4], times: ["08:00"] },
    });
    expect(weekly).toEqual({ key: "tasks.trigger.weekly", params: { days: "1,4", times: "08:00" } });

    const interval = triggerLabel({ kind: "schedule", schedule: { kind: "interval", every: 30, unit: "minute" } });
    expect(interval).toEqual({ key: "tasks.trigger.everyMinute", params: { n: 30 } });
  });

  it("执行者、能力、授权等级", () => {
    expect(executorLabel({ kind: "notify", text: "提醒" }).key).toBe("tasks.executor.notify");
    expect(executorLabel({ kind: "agent", tools: ["read"] }).key).toBe("tasks.executor.agent");
    expect(toolLabel("shell").key).toBe("tasks.tool.shell");

    expect(grantLevelOf([])).toBe(0);
    expect(grantLevelOf(["read"])).toBe(1);
    expect(grantLevelOf(["read", "web", "file_write"])).toBe(2);
    expect(grantLevelOf(["read", "shell"])).toBe(3);
    expect(grantLevelLabel(3).key).toBe("tasks.grant.level3");
  });
});

describe("lib/tasks 时间与摘要", () => {
  it("fmtTime 输出 MM-DD HH:mm，空值给空串", () => {
    expect(fmtTime(null)).toBe("");
    expect(fmtTime(new Date(2026, 10, 27, 8, 5).getTime())).toBe("11-27 08:05");
  });

  it("fmtDuration 按秒/分/时分分档", () => {
    expect(fmtDuration(5_000)).toBe("5s");
    expect(fmtDuration(90_000)).toBe("2m");
    expect(fmtDuration(3_720_000)).toBe("1h02m");
  });

  it("resultSummary 回落到最近错误信息", () => {
    expect(resultSummary(taskFixture(), "  做完了 ")).toBe("做完了");
    expect(resultSummary(taskFixture({ lastError: { code: "x", message: "崩了" } }))).toBe("崩了");
  });
});
