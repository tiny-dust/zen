import { randomUUID } from "node:crypto";

import {
  TASK_AUTO_ARCHIVE_MS,
  TASK_MAX_CONCURRENT,
  isTaskDue,
  isTerminalStatus,
  transition,
} from "@zen/shared";

import { TaskStore } from "./store";

import type {
  AgentStreamEvent,
  ScheduledTask,
  Task,
  TaskAttempt,
  TaskEffect,
  TaskError,
  TaskEventSource,
  TaskJournalEntry,
  TaskListResult,
  TaskQueueInfo,
  TaskStreamEvent,
  TaskUsage,
} from "@zen/shared";

export interface TaskExecutorResult {
  ok: boolean;
  summary?: string;
  error?: TaskError;
  /** 本次执行的 token 用量（执行器拿得到就回填，拿不到记 0） */
  usage?: TaskUsage;
}

export interface TaskExecutionHandle {
  attemptId: string;
  cause: TaskAttempt["cause"];
  /** 退回重做 / 补充信息时带给执行者的说明 */
  note?: string;
  /** 建好会话后回填到执行记录上，页面据此跳转查看完整过程 */
  setSession(sessionId: string): void;
}

/** 执行者适配器：agent / notify 由 tasks/service 实现，运行时只认这个接口（可单测替换） */
export interface TaskExecutorAdapter {
  run(task: Task, handle: TaskExecutionHandle): Promise<TaskExecutorResult>;
  /** 取消时尽力停止（可选） */
  stop?(task: Task, sessionId: string | null): void;
}

export interface TaskRuntimeOptions {
  store: TaskStore;
  executor: TaskExecutorAdapter;
  broadcast?: (channel: string, payload: unknown) => void;
  now?: () => number;
  maxConcurrent?: number;
  /** 执行结果通知（默认由 service 接系统通知） */
  notify?: (task: Task, outcome: TaskExecutorResult) => void;
}

/**
 * 持续任务运行时：队列 / 并发 / 执行 / 重试 / 启动恢复 / 自动归档。
 *
 * 并发模型：单进程单线程，状态机是纯函数，所有转移经 apply() 串行落库再广播；
 * 执行是异步的，回报时用 (taskId, gen) 判活——取消或重启后旧的回报一律作废，
 * 避免「已取消的任务又被写成完成」。
 *
 * 事件触发只有一种：app.run.finished（任意会话一轮 agent 跑完），由 agent-runner 的
 * emitTo 调 notifyTaskEvent 转进来。
 */

/** 事件触发的默认冷却：任务没写 cooldownMs 时用 1 分钟，防止事件任务自激成环 */
const DEFAULT_EVENT_COOLDOWN_MS = 60_000;

interface QueueEntry {
  taskId: string;
  notBefore: number;
  seq: number;
}

interface PendingRun {
  cause: TaskAttempt["cause"];
  note?: string;
}

function compareQueue(a: QueueEntry, b: QueueEntry): number {
  if (a.notBefore !== b.notBefore) {
    return a.notBefore - b.notBefore;
  }
  return a.seq - b.seq;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 状态转移的日志摘要（journal.summary 给人看） */
function describeEvent(event: { type: string }): string {
  const { type } = event;
  switch (type) {
    case "trigger":
      return "触发";
    case "slot_acquired":
      return "开始执行";
    case "completed":
      return "执行完成";
    case "failed":
      return "执行失败";
    case "cancel":
      return "已取消";
    case "pause":
      return "已暂停";
    case "resume":
      return "已恢复";
    case "accept":
      return "验收通过";
    case "reject":
      return "退回重做";
    case "decide":
      return "已答复";
    case "ack":
      return "已确认";
    case "archive":
      return "已归档";
    case "unarchive":
      return "已还原";
    case "restarted":
      return "应用重启，重新排队";
    default:
      return type ?? "状态变化";
  }
}

export class TaskRuntime {
  private readonly store: TaskStore;
  private readonly executor: TaskExecutorAdapter;
  private readonly broadcastFn?: (channel: string, payload: unknown) => void;
  private readonly nowFn: () => number;
  private readonly maxConcurrent: number;
  private readonly notifyFn?: TaskRuntimeOptions["notify"];

  /** 待执行队列（含重试退避未到点的条目）；顺序 = notBefore 升序 + 入队先后 */
  private queue: QueueEntry[] = [];
  private queueSeq = 0;
  /** 已占并发名额的任务：taskId → 执行代次 */
  private running = new Map<string, number>();
  /** 排队原因（内存态；重启后统一按 resume 处理） */
  private pending = new Map<string, PendingRun>();
  /** 事件触发的冷却起点 */
  private eventFiredAt = new Map<string, number>();

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private catchUpTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(options: TaskRuntimeOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.broadcastFn = options.broadcast;
    this.nowFn = options.now ?? (() => Date.now());
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? TASK_MAX_CONCURRENT);
    this.notifyFn = options.notify;
  }

  // ---------- 生命周期 ----------

  /** 启动：恢复残留执行 → 排队 → 每秒 tick（启动 3 秒后再补跑一次到期的定时） */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.recover();
    this.pump();
    this.catchUpTimer = setTimeout(() => this.tick(), 3_000);
    this.catchUpTimer.unref?.();
    this.tickTimer = setInterval(() => this.tick(), 1_000);
    this.tickTimer.unref?.();
  }

  shutdown(): void {
    this.started = false;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.catchUpTimer !== null) {
      clearTimeout(this.catchUpTimer);
      this.catchUpTimer = null;
    }
    this.queue = [];
    this.running.clear();
    this.pending.clear();
    this.eventFiredAt.clear();
  }

  // ---------- 查询 ----------

  list(): TaskListResult {
    return { tasks: this.store.list(), queue: this.queueSnapshot() };
  }

  get(id: string): { task: Task; attempts: TaskAttempt[]; queue?: TaskQueueInfo } | null {
    const task = this.store.get(id);
    if (!task) {
      return null;
    }
    return { task, attempts: this.store.attempts(id), queue: this.queueSnapshot()[id] };
  }

  journal(id: string): TaskJournalEntry[] {
    return this.store.journal(id);
  }

  // ---------- 创建 / 编辑 ----------

  create(task: Task): Task {
    this.store.insert(task);
    this.store.appendJournal({
      taskId: task.id,
      at: task.createdAt,
      type: "note",
      summary: "任务已创建",
    });
    this.broadcast({ type: "changed", taskId: task.id });
    return task;
  }

  update(task: Task): Task {
    this.store.update(task);
    this.store.appendJournal({
      taskId: task.id,
      at: task.updatedAt,
      type: "note",
      summary: "任务已编辑",
    });
    this.broadcast({ type: "changed", taskId: task.id });
    return task;
  }

  // ---------- 用户命令 ----------

  runNow(id: string): { ok: boolean; error?: string } {
    const task = this.store.get(id);
    if (!task) {
      return { ok: false, error: "task not found" };
    }
    if (task.archivedAt !== undefined) {
      return { ok: false, error: "task is archived" };
    }
    const result = this.apply(task, { type: "trigger", at: this.nowFn(), cause: "manual" });
    if (!result.ok) {
      return { ok: false, error: result.reason ?? "cannot run task now" };
    }
    this.pump();
    return { ok: true };
  }

  pause(id: string): Task | null {
    return this.command(id, { type: "pause", at: this.nowFn() });
  }

  resume(id: string): Task | null {
    const task = this.command(id, { type: "resume", at: this.nowFn() });
    this.pump();
    return task;
  }

  cancel(id: string): Task | null {
    const task = this.command(id, { type: "cancel", at: this.nowFn() });
    this.pump();
    return task;
  }

  accept(id: string): Task | null {
    return this.command(id, { type: "accept", at: this.nowFn() });
  }

  reject(id: string, feedback: string): Task | null {
    const task = this.command(id, { type: "reject", at: this.nowFn(), feedback });
    this.pump();
    return task;
  }

  decide(id: string, input?: string): Task | null {
    const task = this.command(id, { type: "decide", at: this.nowFn(), input });
    this.pump();
    return task;
  }

  ack(id: string): Task | null {
    return this.command(id, { type: "ack", at: this.nowFn() });
  }

  archive(id: string): Task | null {
    return this.command(id, { type: "archive", at: this.nowFn() });
  }

  unarchive(id: string): Task | null {
    return this.command(id, { type: "unarchive", at: this.nowFn() });
  }

  /** 删除：只允许已归档；执行产生的会话保留（可从侧栏回看） */
  remove(id: string): boolean {
    const task = this.store.get(id);
    if (!task || task.archivedAt === undefined) {
      return false;
    }
    this.store.remove(id);
    this.queue = this.queue.filter((entry) => entry.taskId !== id);
    this.pending.delete(id);
    this.running.delete(id);
    this.eventFiredAt.delete(id);
    this.broadcast({ type: "changed", taskId: id });
    return true;
  }

  // ---------- 事件触发 ----------

  /** 应用内事件：触发所有启用且订阅该事件源的任务（带冷却） */
  fireEvent(source: TaskEventSource): void {
    const at = this.nowFn();
    for (const task of this.store.list()) {
      if (!task.enabled || task.archivedAt !== undefined) {
        continue;
      }
      if (task.trigger.kind !== "event" || task.trigger.source !== source) {
        continue;
      }
      // 忙或已结束的任务不重复触发；事件任务成功后回 idle，即可再被触发
      if (task.status !== "idle") {
        continue;
      }
      const cooldown = task.trigger.cooldownMs ?? DEFAULT_EVENT_COOLDOWN_MS;
      const last = this.eventFiredAt.get(task.id) ?? 0;
      if (at - last < cooldown) {
        continue;
      }
      this.eventFiredAt.set(task.id, at);
      this.apply(task, { type: "trigger", at, cause: "event" });
    }
    this.pump();
  }

  // ---------- 内部：状态机 / 落库 / 副作用 ----------

  private command(id: string, event: Parameters<typeof transition>[2]): Task | null {
    const task = this.store.get(id);
    if (!task) {
      return null;
    }
    const result = this.apply(task, event);
    return result.ok ? result.task : null;
  }

  private apply(
    task: Task,
    event: Parameters<typeof transition>[2],
  ): { ok: boolean; reason?: string; task: Task } {
    const current = this.store.get(task.id) ?? task;
    const attempt = current.lastAttemptId
      ? this.store.getAttempt(current.lastAttemptId)
      : null;
    const result = transition(current, attempt, event);
    if (!result.ok) {
      return { ok: false, reason: result.reason, task: current };
    }
    this.store.update(result.task);
    if (result.attempt && (!attempt || JSON.stringify(attempt) !== JSON.stringify(result.attempt))) {
      this.store.insertAttempt(result.attempt);
    }
    if (result.task.status !== current.status) {
      this.store.appendJournal({
        taskId: result.task.id,
        at: event.at,
        type: "transition",
        from: current.status,
        to: result.task.status,
        summary: describeEvent(event),
        attemptId: result.attempt?.id,
      });
    }
    this.runEffects(result.effects, result.task, result.attempt);
    this.broadcast({ type: "changed", taskId: result.task.id });
    return { ok: true, task: result.task };
  }

  private runEffects(effects: TaskEffect[], task: Task, attempt: TaskAttempt | null): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case "enqueue":
          this.queueTask(task.id, task.nextRunAt ?? 0, effect.cause, effect.note);
          break;
        case "release_slot":
          if (this.running.get(task.id) === effect.gen) {
            this.running.delete(task.id);
          }
          break;
        case "stop_attempt":
          this.executor.stop?.(task, attempt?.sessionId ?? null);
          break;
        case "start_attempt":
          break;
        case "deliver":
          if (effect.what === "auto_paused") {
            this.store.appendJournal({
              taskId: task.id,
              at: task.updatedAt,
              type: "note",
              summary: "连续失败达到上限，已自动暂停",
            });
          } else if (effect.what === "expired") {
            this.store.appendJournal({
              taskId: task.id,
              at: task.updatedAt,
              type: "note",
              summary: "授权已过期或已撤销，任务未执行",
            });
          }
          break;
      }
    }
  }

  private queueTask(taskId: string, notBefore: number, cause: TaskAttempt["cause"], note?: string): void {
    this.queue = this.queue.filter((entry) => entry.taskId !== taskId);
    this.queue.push({ taskId, notBefore, seq: ++this.queueSeq });
    this.pending.set(taskId, { cause, note });
  }

  // ---------- 内部：恢复 / 定时 / 队列 ----------

  /** 启动恢复：running / waiting_user(resumeTo=running) 的残留标 interrupted 并重排；queued 重新入队 */
  private recover(): void {
    const at = this.nowFn();
    for (const task of this.store.list()) {
      if (
        task.status !== "running" &&
        task.status !== "waiting_user" &&
        task.status !== "queued"
      ) {
        continue;
      }
      const result = this.apply(task, { type: "restarted", at });
      if (result.ok && result.task.status === "queued" && result.task.enabled) {
        this.queueTask(result.task.id, result.task.nextRunAt ?? 0, "resume");
      }
    }
  }

  private tick(): void {
    if (!this.started) {
      return;
    }
    this.runDueSchedules();
    this.pump();
    this.autoArchive();
  }

  /** 定时触发：把任务包成旧计划任务的形状，复用 isTaskDue 的到期算法 */
  private runDueSchedules(): void {
    const at = this.nowFn();
    for (const task of this.store.list()) {
      if (!task.enabled || task.archivedAt !== undefined) {
        continue;
      }
      if (task.status !== "idle" || task.trigger.kind !== "schedule") {
        continue;
      }
      const probe = {
        id: task.id,
        name: task.title,
        prompt: task.goal,
        schedule: task.trigger.schedule,
        enabled: true,
        workspacePath: null,
        targetSessionId: null,
        lastRunAt: task.lastRunAt ?? null,
        lastResult: null,
        lastRunOk: null,
        lastSessionId: null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      } satisfies ScheduledTask;
      if (!isTaskDue(probe, at)) {
        continue;
      }
      this.apply(task, { type: "trigger", at, cause: "schedule" });
    }
  }

  /** 终态满 24h 自动归档（失败/过期要已确认，避免用户还没看到就消失） */
  private autoArchive(): void {
    const at = this.nowFn();
    for (const task of this.store.list()) {
      if (task.archivedAt !== undefined || !isTerminalStatus(task.status)) {
        continue;
      }
      if ((task.status === "failed" || task.status === "expired") && task.ackedAt === undefined) {
        continue;
      }
      const ended = task.endedAt ?? task.updatedAt;
      if (at - ended < TASK_AUTO_ARCHIVE_MS) {
        continue;
      }
      this.apply(task, { type: "archive", at });
    }
  }

  private queueSnapshot(): Record<string, TaskQueueInfo> {
    const at = this.nowFn();
    const entries = [...this.queue].sort(compareQueue);
    const out: Record<string, TaskQueueInfo> = {};
    let position = 0;
    for (const entry of entries) {
      const task = this.store.get(entry.taskId);
      if (!task || task.status !== "queued") {
        continue;
      }
      position += 1;
      const waitingForRetry = entry.notBefore > at;
      out[entry.taskId] = {
        reason: waitingForRetry ? "retry" : "slot",
        position,
        retryAt: waitingForRetry ? entry.notBefore : undefined,
        activeCount: this.running.size,
        maxConcurrent: this.maxConcurrent,
      };
    }
    return out;
  }

  /** 出队：按 (notBefore, 入队先后) 取，占满并发名额为止 */
  private pump(): void {
    if (!this.started) {
      return;
    }
    const at = this.nowFn();
    this.queue.sort(compareQueue);
    while (this.running.size < this.maxConcurrent) {
      const index = this.queue.findIndex((entry) => entry.notBefore <= at);
      if (index < 0) {
        return;
      }
      const [entry] = this.queue.splice(index, 1);
      if (!entry) {
        return;
      }
      const task = this.store.get(entry.taskId);
      if (!task || task.status !== "queued" || !task.enabled) {
        continue;
      }
      const pendingRun = this.pending.get(task.id) ?? { cause: "manual" as const };
      this.pending.delete(task.id);
      const attemptId = randomUUID();
      const result = this.apply(task, {
        type: "slot_acquired",
        at,
        attemptId,
        cause: pendingRun.cause,
      });
      if (!result.ok || result.task.status !== "running") {
        continue;
      }
      this.running.set(result.task.id, result.task.gen);
      void this.execute(result.task, attemptId, pendingRun);
    }
  }

  private async execute(task: Task, attemptId: string, pendingRun: PendingRun): Promise<void> {
    this.broadcast({ type: "run", taskId: task.id, attemptId, phase: "started" });
    let outcome: TaskExecutorResult;
    try {
      outcome = await this.executor.run(task, {
        attemptId,
        cause: pendingRun.cause,
        note: pendingRun.note,
        setSession: (sessionId) => {
          const attempt = this.store.getAttempt(attemptId);
          if (attempt && attempt.sessionId !== sessionId) {
            this.store.insertAttempt({ ...attempt, sessionId });
          }
        },
      });
    } catch (error) {
      outcome = {
        ok: false,
        error: { code: "executor_crashed", message: errorMessage(error) },
      };
    }

    // 判活：执行期间可能被取消 / 重启，旧回报一律作废
    const latest = this.store.get(task.id);
    if (!latest || latest.gen !== task.gen || latest.status !== "running") {
      if (this.running.get(task.id) === task.gen) {
        this.running.delete(task.id);
      }
      this.broadcast({ type: "run", taskId: task.id, attemptId, phase: "finished" });
      this.pump();
      return;
    }

    const at = this.nowFn();
    if (outcome.ok) {
      this.apply(latest, {
        type: "completed",
        at,
        gen: task.gen,
        summary: outcome.summary ?? "",
        usage: outcome.usage,
      });
    } else {
      this.apply(latest, {
        type: "failed",
        at,
        gen: task.gen,
        error: outcome.error ?? { code: "agent_failed", message: "agent run failed" },
        usage: outcome.usage,
      });
    }
    this.broadcast({
      type: "run",
      taskId: task.id,
      attemptId,
      phase: outcome.ok ? "finished" : "error",
      summary: outcome.ok ? outcome.summary : outcome.error?.message,
    });
    this.notifyFn?.(task, outcome);
    this.pump();
  }

  private broadcast(event: TaskStreamEvent): void {
    this.broadcastFn?.("tasks:event", event);
  }
}

// ---------- 事件钩子（agent-runner 调用） ----------

/** 全局运行时：由 tasks/service 在启动时挂上，shutdown 时摘掉 */
let activeRuntime: TaskRuntime | null = null;

export function setActiveTaskRuntime(runtime: TaskRuntime | null): void {
  activeRuntime = runtime;
}

/**
 * 应用内事件钩子：agent 每轮跑完（done）就通知流水线任务。
 * 放在 agent-runner 的 emitTo 里，和飞书桥接同一位置。
 */
export function notifyTaskEvent(event: AgentStreamEvent): void {
  if (event.type !== "done") {
    return;
  }
  activeRuntime?.fireEvent("app.run.finished");
}
