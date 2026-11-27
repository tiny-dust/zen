import type {
  Task,
  TaskAttempt,
  TaskError,
  TaskStatus,
  TaskTrigger,
  TaskGrant,
  TaskUsage,
} from "../types";

/**
 * 持续任务状态机（对齐 nomi `tasks/machine.go` 的转移表，按本仓契约裁剪）。
 * 纯函数：不读时钟（时间一律由事件带 `at`）、不生成 id、无副作用；输入不被修改，
 * 所有变化都返回新的 Task / TaskAttempt。运行时的落库、广播、执行由 tasks/runtime.ts 负责。
 *
 * 本仓契约没有 nomi 的 `pending` 字段：排队中的「为什么跑」「什么时候才跑」由运行时
 * 内存记录（cause）与 `task.nextRunAt`（重试退避时刻）表达。
 * `needs_reconcile` 在本仓没有对外动作可核对，状态保留但不产生转移。
 */

/** 结束态：不再触发、不再接受执行回报 */
const TERMINAL: TaskStatus[] = ["done", "failed", "cancelled", "expired"];

/** 连续失败多少次自动暂停 */
export const TASK_AUTO_PAUSE_AFTER_FAILURES = 3;

/** 重试退避上限（2^n 秒封顶 60 秒） */
const MAX_BACKOFF_MS = 60_000;

export type TaskAttemptCause = TaskAttempt["cause"];

export type TaskMachineEvent =
  | { type: "trigger"; at: number; cause: TaskAttemptCause }
  | { type: "slot_acquired"; at: number; attemptId: string; cause: TaskAttemptCause }
  | { type: "completed"; at: number; gen: number; summary: string; usage?: TaskUsage }
  | { type: "failed"; at: number; gen: number; error: TaskError; usage?: TaskUsage }
  | { type: "cancel"; at: number; gen?: number }
  | { type: "pause"; at: number }
  | { type: "resume"; at: number }
  | { type: "accept"; at: number; gen?: number }
  | { type: "reject"; at: number; gen?: number; feedback: string }
  | { type: "decide"; at: number; input?: string }
  | { type: "ack"; at: number }
  | { type: "archive"; at: number }
  | { type: "unarchive"; at: number }
  | { type: "restarted"; at: number };

/** 运行时需要执行的副作用（状态机自身只改数据） */
export type TaskEffect =
  | { kind: "start_attempt"; attemptId: string; gen: number }
  | { kind: "release_slot"; gen: number }
  | { kind: "stop_attempt"; gen: number; reason: string }
  | { kind: "enqueue"; cause: TaskAttemptCause; note?: string }
  | { kind: "deliver"; what: "result" | "error" | "auto_paused" | "expired" };

export interface TaskTransitionResult {
  ok: boolean;
  reason?: string;
  task: Task;
  attempt: TaskAttempt | null;
  effects: TaskEffect[];
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

/** 会反复触发的任务（事件触发、或非一次性的定时）成功后回到 idle；否则落到 done */
export function isRecurringTrigger(trigger: TaskTrigger): boolean {
  if (trigger.kind === "event") {
    return true;
  }
  return trigger.kind === "schedule" && trigger.schedule.kind !== "once";
}

export function isGrantExpired(grant: TaskGrant, at: number): boolean {
  return grant.expiresAt !== undefined && grant.expiresAt <= at;
}

/** 授权不可用：已撤销或已过期 */
export function isGrantBlocked(grant: TaskGrant, at: number): boolean {
  return grant.revokedAt !== undefined || isGrantExpired(grant, at);
}

/**
 * 可重试的错误：网络/超时/上游抖动/执行器崩溃，以及不认识的错误码。
 * 明确不可重试的（授权、配置、输入非法）重试也不会变好。
 */
const NON_RETRYABLE = new Set([
  "grant_denied",
  "grant_expired",
  "config_changed",
  "invalid_input",
  "cancelled",
]);

export function isRetryableError(error: TaskError): boolean {
  return !NON_RETRYABLE.has(error.code);
}

/** 第 retry 次重试（从 1 起）前等多久：2^retry 秒，封顶 60 秒 */
export function retryBackoffMs(retry: number): number {
  const n = Math.max(1, Math.floor(retry));
  return Math.min(2 ** n * 1_000, MAX_BACKOFF_MS);
}

function reject(
  task: Task,
  attempt: TaskAttempt | null,
  reason: string,
): TaskTransitionResult {
  return { ok: false, reason, task, attempt, effects: [] };
}

function ok(
  task: Task,
  attempt: TaskAttempt | null,
  effects: TaskEffect[],
): TaskTransitionResult {
  return { ok: true, task, attempt, effects };
}

function copyAttempt(attempt: TaskAttempt): TaskAttempt {
  return { ...attempt };
}

/** 成功后落定：循环任务回 idle，一次性任务落 done */
function settle(task: Task, at: number, effects: TaskEffect[]): Task {
  const next: Task = {
    ...task,
    wait: undefined,
    consecutiveFailures: 0,
    retryCount: 0,
    lastRunStatus: "succeeded",
    lastRunAt: at,
    nextRunAt: undefined,
    ackedAt: undefined,
    updatedAt: at,
  };
  if (isRecurringTrigger(task.trigger)) {
    next.status = "idle";
    return next;
  }
  next.status = "done";
  next.endedAt = at;
  return next;
}

/** 放弃重试：循环任务回 idle（连续失败过多则自动暂停），一次性任务落 failed */
function giveUp(task: Task, at: number, error: TaskError, effects: TaskEffect[]): Task {
  const next: Task = {
    ...task,
    lastError: error,
    wait: undefined,
    retryCount: 0,
    nextRunAt: undefined,
    lastRunStatus: "failed",
    lastRunAt: at,
    ackedAt: undefined,
    updatedAt: at,
  };
  if (!isRecurringTrigger(task.trigger)) {
    next.status = "failed";
    next.endedAt = at;
    return next;
  }
  const failures = task.consecutiveFailures + 1;
  next.status = "idle";
  next.consecutiveFailures = failures;
  if (failures >= TASK_AUTO_PAUSE_AFTER_FAILURES) {
    next.enabled = false;
    effects.push({ kind: "deliver", what: "auto_paused" });
  }
  return next;
}

/** 排队（清掉等待态；重试时 nextRunAt 已在调用处写好） */
function enqueue(
  task: Task,
  at: number,
  effects: TaskEffect[],
  cause: TaskAttemptCause,
  note?: string,
): Task {
  effects.push({ kind: "enqueue", cause, note });
  return {
    ...task,
    status: "queued",
    wait: undefined,
    updatedAt: at,
  };
}

export function transition(
  task: Task,
  attempt: TaskAttempt | null,
  event: TaskMachineEvent,
): TaskTransitionResult {
  switch (event.type) {
    case "trigger": {
      if (task.archivedAt !== undefined) {
        return reject(task, attempt, "archived");
      }
      if (isTerminalStatus(task.status)) {
        // 只有手动「立即运行」允许从结束态重开
        if (event.cause !== "manual") {
          return reject(task, attempt, "terminal");
        }
      } else if (task.status !== "idle") {
        return reject(task, attempt, "busy");
      }
      if (!task.enabled) {
        return reject(task, attempt, "paused");
      }
      if (isGrantBlocked(task.grant, event.at)) {
        const next: Task = {
          ...task,
          status: "expired",
          wait: undefined,
          nextRunAt: undefined,
          endedAt: event.at,
          updatedAt: event.at,
        };
        return ok(next, attempt, [{ kind: "deliver", what: "expired" }]);
      }
      const next: Task = {
        ...task,
        status: "queued",
        retryCount: 0,
        wait: undefined,
        nextRunAt: undefined,
        endedAt: undefined,
        archivedAt: undefined,
        ackedAt: undefined,
        updatedAt: event.at,
      };
      return ok(next, attempt, [{ kind: "enqueue", cause: event.cause }]);
    }

    case "slot_acquired": {
      if (task.status !== "queued") {
        return reject(task, attempt, "illegal");
      }
      if (!task.enabled) {
        return reject(task, attempt, "paused");
      }
      if (task.nextRunAt !== undefined && task.nextRunAt > event.at) {
        return reject(task, attempt, "not_ready");
      }
      if (isGrantBlocked(task.grant, event.at)) {
        const next: Task = {
          ...task,
          status: "expired",
          wait: undefined,
          nextRunAt: undefined,
          endedAt: event.at,
          updatedAt: event.at,
        };
        return ok(next, attempt, [{ kind: "deliver", what: "expired" }]);
      }
      const gen = task.gen + 1;
      const next: Task = {
        ...task,
        status: "running",
        gen,
        lastAttemptId: event.attemptId,
        wait: undefined,
        nextRunAt: undefined,
        updatedAt: event.at,
      };
      const started: TaskAttempt = {
        id: event.attemptId,
        taskId: task.id,
        gen,
        cause: event.cause,
        status: "running",
        startedAt: event.at,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      return ok(next, started, [{ kind: "start_attempt", attemptId: event.attemptId, gen }]);
    }

    case "completed": {
      if (isTerminalStatus(task.status)) {
        return reject(task, attempt, "stale");
      }
      if (task.status !== "running" || !attempt || attempt.gen !== event.gen) {
        return reject(task, attempt, "stale");
      }
      const done = copyAttempt(attempt);
      done.endedAt = event.at;
      done.result = { summary: event.summary };
      if (event.usage) {
        done.usage = event.usage;
      }
      const effects: TaskEffect[] = [{ kind: "release_slot", gen: event.gen }];
      if (task.acceptance === "user") {
        const next: Task = {
          ...task,
          status: "awaiting_accept",
          retryCount: 0,
          consecutiveFailures: 0,
          lastError: undefined,
          lastRunAt: event.at,
          lastRunStatus: "succeeded",
          updatedAt: event.at,
        };
        done.status = "awaiting_accept";
        return ok(next, done, effects);
      }
      done.status = "succeeded";
      effects.push({ kind: "deliver", what: "result" });
      return ok(settle(task, event.at, effects), done, effects);
    }

    case "failed": {
      if (task.status !== "running" || !attempt || attempt.gen !== event.gen) {
        return reject(task, attempt, "stale");
      }
      const failed = copyAttempt(attempt);
      failed.status = "failed";
      failed.endedAt = event.at;
      failed.error = event.error;
      if (event.usage) {
        failed.usage = event.usage;
      }
      const effects: TaskEffect[] = [{ kind: "release_slot", gen: event.gen }];
      if (isRetryableError(event.error) && task.retryCount < task.budget.maxRetries) {
        const retry = task.retryCount + 1;
        const next: Task = {
          ...task,
          retryCount: retry,
          lastError: event.error,
          nextRunAt: event.at + retryBackoffMs(retry),
          updatedAt: event.at,
        };
        return ok(enqueue(next, event.at, effects, "retry"), failed, effects);
      }
      effects.push({ kind: "deliver", what: "error" });
      return ok(giveUp(task, event.at, event.error, effects), failed, effects);
    }

    case "cancel": {
      if (isTerminalStatus(task.status)) {
        return reject(task, attempt, "terminal");
      }
      if (event.gen !== undefined && event.gen !== task.gen) {
        return reject(task, attempt, "stale");
      }
      const effects: TaskEffect[] = [];
      let nextAttempt = attempt;
      if (attempt && (attempt.status === "running" || attempt.status === "waiting_user")) {
        effects.push({ kind: "stop_attempt", gen: attempt.gen, reason: "cancel" });
        effects.push({ kind: "release_slot", gen: attempt.gen });
        nextAttempt = copyAttempt(attempt);
        nextAttempt.status = "cancelled";
        nextAttempt.endedAt = event.at;
      } else if (attempt && attempt.status === "awaiting_accept") {
        nextAttempt = copyAttempt(attempt);
        nextAttempt.status = "cancelled";
      }
      const next: Task = {
        ...task,
        status: "cancelled",
        gen: task.gen + 1,
        wait: undefined,
        nextRunAt: undefined,
        endedAt: event.at,
        lastRunAt: event.at,
        lastRunStatus: "cancelled",
        ackedAt: undefined,
        updatedAt: event.at,
      };
      return ok(next, nextAttempt, effects);
    }

    case "pause": {
      if (!task.enabled || isTerminalStatus(task.status)) {
        return reject(task, attempt, "illegal");
      }
      const next: Task = { ...task, enabled: false, updatedAt: event.at };
      if (task.status === "queued") {
        next.status = "idle";
        next.nextRunAt = undefined;
      }
      return ok(next, attempt, []);
    }

    case "resume": {
      if (task.enabled || isTerminalStatus(task.status)) {
        return reject(task, attempt, "illegal");
      }
      const next: Task = {
        ...task,
        enabled: true,
        consecutiveFailures: 0,
        updatedAt: event.at,
      };
      return ok(next, attempt, []);
    }

    case "accept": {
      if (task.status !== "awaiting_accept" || !attempt) {
        return reject(task, attempt, "illegal");
      }
      if (event.gen !== undefined && event.gen !== task.gen) {
        return reject(task, attempt, "stale");
      }
      const effects: TaskEffect[] = [];
      const accepted = copyAttempt(attempt);
      accepted.status = "succeeded";
      effects.push({ kind: "deliver", what: "result" });
      return ok(settle(task, event.at, effects), accepted, effects);
    }

    case "reject": {
      if (task.status !== "awaiting_accept" || !attempt) {
        return reject(task, attempt, "illegal");
      }
      if (event.gen !== undefined && event.gen !== task.gen) {
        return reject(task, attempt, "stale");
      }
      const effects: TaskEffect[] = [];
      const rejected = copyAttempt(attempt);
      rejected.status = "rejected";
      rejected.endedAt = event.at;
      const note = event.feedback.trim();
      return ok(
        enqueue(task, event.at, effects, "followup", note || undefined),
        rejected,
        effects,
      );
    }

    case "decide": {
      // 只处理等「补充信息」；approval 需要执行链路里能挂起 agent，本仓没有，故不伪造
      if (task.status !== "waiting_user" || task.wait?.kind !== "input") {
        return reject(task, attempt, "illegal");
      }
      const effects: TaskEffect[] = [];
      const note = event.input?.trim() || undefined;
      return ok(enqueue(task, event.at, effects, "resume", note), attempt, effects);
    }

    case "ack": {
      if ((task.status !== "failed" && task.status !== "expired") || task.ackedAt !== undefined) {
        return reject(task, attempt, "illegal");
      }
      return ok({ ...task, ackedAt: event.at, updatedAt: event.at }, attempt, []);
    }

    case "archive": {
      const archivable =
        isTerminalStatus(task.status) || (task.status === "idle" && !task.enabled);
      if (!archivable) {
        return reject(task, attempt, "illegal");
      }
      if (task.archivedAt !== undefined) {
        return ok(task, attempt, []);
      }
      const next: Task = { ...task, archivedAt: event.at, updatedAt: event.at };
      if ((task.status === "failed" || task.status === "expired") && task.ackedAt === undefined) {
        next.ackedAt = event.at;
      }
      return ok(next, attempt, []);
    }

    case "unarchive": {
      if (task.archivedAt === undefined) {
        return reject(task, attempt, "illegal");
      }
      const next: Task = { ...task, archivedAt: undefined, updatedAt: event.at };
      // 还原回看板时重置终态计时，防止下一个 tick 立刻又自动归档
      if (isTerminalStatus(task.status)) {
        next.endedAt = event.at;
      }
      return ok(next, attempt, []);
    }

    case "restarted": {
      const active =
        attempt !== null &&
        (attempt.status === "running" || attempt.status === "waiting_user");
      const wasRunning = task.status === "running" && active;
      const wasWaiting =
        task.status === "waiting_user" && task.wait?.resumeTo === "running" && active;
      if (!wasRunning && !wasWaiting) {
        if (task.status === "queued") {
          const effects: TaskEffect[] = [];
          return ok(enqueue(task, event.at, effects, "resume"), attempt, effects);
        }
        return ok(task, attempt, []);
      }
      const interrupted = copyAttempt(attempt);
      interrupted.status = "interrupted";
      interrupted.endedAt = event.at;
      const effects: TaskEffect[] = [];
      const next: Task = {
        ...task,
        status: "queued",
        gen: task.gen + 1,
        wait: undefined,
        nextRunAt: undefined,
        updatedAt: event.at,
      };
      effects.push({ kind: "enqueue", cause: "resume" });
      return ok(next, interrupted, effects);
    }

    default:
      return reject(task, attempt, "illegal");
  }
}
