import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { Notification } from "electron";

import { isValidSchedule } from "@zen/shared";

import { runAgentRequest } from "../agent-runner";
import { getDb } from "../model-db-connection";
import { createSession, getSession, getWorkspace, renameSession } from "../workspace-db";

import { TaskStore } from "./store";
import { TaskRuntime, setActiveTaskRuntime } from "./runtime";

import type { TaskExecutorAdapter, TaskExecutorResult } from "./runtime";
import type { AgentSession } from "@zen/agent-core";
import type {
  Task,
  TaskAttempt,
  TaskCategory,
  TaskEventSource,
  TaskExecutor,
  TaskGrant,
  TaskInput,
  TaskJournalEntry,
  TaskListResult,
  TaskPriority,
  TaskQueueInfo,
  TaskToolClass,
  TaskTrigger,
} from "@zen/shared";

/**
 * 持续任务服务：对外编排（校验入参 → 建任务 → 运行时的命令）+ 执行适配器
 * （agent 走 runAgentRequest 与专属会话，notify 只弹系统通知）+ IPC 用的查询。
 * 状态与队列规则全在 tasks/runtime.ts / @zen/shared 的 task-machine.ts。
 */

/** 默认重试次数（对齐 nomi 的 DefaultMaxRetries） */
const DEFAULT_MAX_RETRIES = 5;
/** 摘要最长保留字符数 */
const RESULT_SUMMARY_LIMIT = 400;

const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];
const CATEGORIES: TaskCategory[] = ["coding", "review", "research", "writing", "monitor", "chore"];
const TOOL_CLASSES: TaskToolClass[] = ["read", "web", "file_write", "shell"];

let store: TaskStore | null = null;
let runtime: TaskRuntime | null = null;

// ---------- 入参校验（IPC 收 unknown，先校验再落库） ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function optionalNumber(value: unknown): number | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTrigger(value: unknown): { value: TaskTrigger } | { error: string } {
  if (!isRecord(value)) {
    return { error: "invalid task trigger" };
  }
  if (value.kind === "manual") {
    return { value: { kind: "manual" } };
  }
  if (value.kind === "schedule") {
    if (!isValidSchedule(value.schedule)) {
      return { error: "invalid task schedule" };
    }
    return { value: { kind: "schedule", schedule: value.schedule } };
  }
  if (value.kind === "event") {
    if (value.source !== "app.run.finished") {
      return { error: "unsupported task event source" };
    }
    const cooldown = optionalNumber(value.cooldownMs);
    if (cooldown === null || (cooldown !== undefined && cooldown < 0)) {
      return { error: "invalid event cooldown" };
    }
    const filter = value.filter === undefined ? undefined : trimText(value.filter) ?? undefined;
    return {
      value: { kind: "event", source: value.source, filter, cooldownMs: cooldown },
    };
  }
  return { error: "invalid task trigger" };
}

function normalizeExecutor(value: unknown): { value: TaskExecutor } | { error: string } {
  if (!isRecord(value)) {
    return { error: "invalid task executor" };
  }
  if (value.kind === "notify") {
    const text = trimText(value.text);
    if (!text) {
      return { error: "notify text is required" };
    }
    return { value: { kind: "notify", text } };
  }
  if (value.kind !== "agent") {
    return { error: "invalid task executor" };
  }
  if (!Array.isArray(value.tools)) {
    return { error: "invalid executor tools" };
  }
  const tools: TaskToolClass[] = [];
  for (const item of value.tools) {
    if (!TOOL_CLASSES.includes(item as TaskToolClass)) {
      return { error: "invalid executor tools" };
    }
    if (!tools.includes(item as TaskToolClass)) {
      tools.push(item as TaskToolClass);
    }
  }
  const model = value.model === undefined || value.model === null ? undefined : trimText(value.model);
  if (model === null) {
    return { error: "invalid executor model" };
  }
  const doneWhen = value.doneWhen === undefined ? undefined : trimText(value.doneWhen) ?? undefined;
  return { value: { kind: "agent", tools, model: model ?? null, doneWhen } };
}

/** 授权等级必须与能力自洽由调用方用 requiredGrantLevel 校验 */
function requiredGrantLevel(executor: TaskExecutor): 0 | 1 | 2 | 3 {
  if (executor.kind === "notify") {
    return 0;
  }
  if (executor.tools.includes("shell")) {
    return 3;
  }
  if (executor.tools.includes("file_write")) {
    return 2;
  }
  return 1;
}

function normalizeGrant(value: unknown): { value: Omit<TaskGrant, "grantedAt"> } | { error: string } {
  if (!isRecord(value)) {
    return { error: "invalid task grant" };
  }
  const level = value.level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 3) {
    return { error: "invalid grant level" };
  }
  if (!Array.isArray(value.paths)) {
    return { error: "invalid grant paths" };
  }
  const paths: string[] = [];
  for (const item of value.paths) {
    const path = trimText(item);
    if (!path || !isAbsolute(path) || !existsSync(path)) {
      return { error: "grant path must be an existing absolute path" };
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  const expiresAt = optionalNumber(value.expiresAt);
  const revokedAt = optionalNumber(value.revokedAt);
  if (expiresAt === null || revokedAt === null) {
    return { error: "invalid grant expiry" };
  }
  return {
    value: {
      level: level as 0 | 1 | 2 | 3,
      paths,
      expiresAt,
      revokedAt,
    },
  };
}

/** 校验并规整创建/编辑入参（编辑时调用方先把当前值合并进来） */
export function validateTaskInput(input: unknown): { value: TaskInput } | { error: string } {
  if (!isRecord(input)) {
    return { error: "invalid task input" };
  }
  const title = trimText(input.title);
  if (!title) {
    return { error: "task title is required" };
  }
  const goal = trimText(input.goal);
  if (!goal) {
    return { error: "task goal is required" };
  }
  const trigger = normalizeTrigger(input.trigger);
  if ("error" in trigger) {
    return trigger;
  }
  const executor = normalizeExecutor(input.executor);
  if ("error" in executor) {
    return executor;
  }
  const grant = normalizeGrant(input.grant);
  if ("error" in grant) {
    return grant;
  }
  if (grant.value.level < requiredGrantLevel(executor.value)) {
    return { error: "grant level is too low for executor tools" };
  }
  if (input.acceptance !== undefined && input.acceptance !== "auto" && input.acceptance !== "user") {
    return { error: "invalid acceptance mode" };
  }
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority as TaskPriority)) {
    return { error: "invalid task priority" };
  }
  if (input.category !== undefined && !CATEGORIES.includes(input.category as TaskCategory)) {
    return { error: "invalid task category" };
  }
  let maxRetries = DEFAULT_MAX_RETRIES;
  if (input.budget !== undefined) {
    const budget = input.budget;
    if (!isRecord(budget) || budget.maxRetries === undefined) {
      return { error: "invalid task budget" };
    }
    if (
      typeof budget.maxRetries !== "number" ||
      !Number.isInteger(budget.maxRetries) ||
      budget.maxRetries < 0 ||
      budget.maxRetries > 10
    ) {
      return { error: "invalid task budget" };
    }
    maxRetries = budget.maxRetries;
  }
  return {
    value: {
      title,
      goal,
      trigger: trigger.value,
      executor: executor.value,
      acceptance: (input.acceptance as "auto" | "user" | undefined) ?? "auto",
      priority: input.priority as TaskPriority | undefined,
      category: input.category as TaskCategory | undefined,
      budget: { maxRetries },
      grant: grant.value,
    },
  };
}

// ---------- 执行适配器 ----------

/** 系统通知：不支持/失败静默降级（同旧计划任务） */
function showNotification(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) {
      return;
    }
    new Notification({ title, body }).show();
  } catch {
    // 通知失败不影响任务本身
  }
}

/**
 * 能力约束只写在提示词里（不假装是内核沙箱）：真正拦得住的是执行器本身的能力，
 * 本仓没有给 agent 单独裁剪工具的入口，所以这里只做明确告知。
 */
function buildTaskPrompt(task: Task, note?: string): string {
  const lines = [task.goal.trim()];
  if (task.executor.kind === "agent") {
    const doneWhen = task.executor.doneWhen?.trim();
    if (doneWhen) {
      lines.push(`完成标准：${doneWhen}`);
    }
    if (task.grant.paths.length > 0) {
      lines.push(`可读写目录：${task.grant.paths.join("、")}`);
    }
    if (!task.executor.tools.includes("shell")) {
      lines.push("不要执行 shell 命令。");
    }
    if (!task.executor.tools.includes("file_write")) {
      lines.push("不要写文件。");
    }
  }
  const extra = note?.trim();
  if (extra) {
    lines.push(`补充要求：${extra}`);
  }
  return lines.join("\n\n");
}

/** 会话里最后一条助手消息作为结果摘要 */
function sessionSummary(sessionId: string): string {
  const record = getSession(sessionId);
  if (!record) {
    return "";
  }
  const last = [...record.messages].reverse().find((item) => item.role === "assistant");
  const content = last?.content?.trim();
  if (!content) {
    return "";
  }
  return content.length > RESULT_SUMMARY_LIMIT
    ? `${content.slice(0, RESULT_SUMMARY_LIMIT)}…`
    : content;
}

/** 任务落在哪个工作区：从来源会话继承，否则用公共工作区 */
function resolveWorkspaceId(task: Task): string {
  if (!task.originConversationId) {
    return "common";
  }
  return getSession(task.originConversationId)?.session.workspaceId ?? "common";
}

function createTaskExecutor(sessions: Map<string, AgentSession>): TaskExecutorAdapter {
  return {
    async run(task, handle) {
      if (task.executor.kind === "notify") {
        showNotification(task.title, task.executor.text);
        return { ok: true, summary: task.executor.text };
      }
      const workspaceId = resolveWorkspaceId(task);
      const session = createSession(workspaceId);
      handle.setSession(session.id);
      renameSession(session.id, `任务 · ${task.title}`);
      // 流里的 usage 事件累计到执行记录（后台运行不推 UI，只算用量）
      const usage = { inputTokens: 0, outputTokens: 0 };
      const result = await runAgentRequest(
        {
          sessionId: session.id,
          workspaceId,
          // main 侧按 workspaceId 解析实际目录，该字段仅对齐渲染层口径
          workspaceRoot: getWorkspace(workspaceId)?.path ?? "",
          userMessage: buildTaskPrompt(task, handle.note),
          history: [],
        },
        {
          sessions,
          send: (event) => {
            if (event.type === "usage") {
              usage.inputTokens += event.inputTokens;
              usage.outputTokens += event.outputTokens;
            }
          },
        },
      );
      if (!result.ok) {
        return {
          ok: false,
          error: { code: "agent_failed", message: result.error ?? "agent run failed" },
          usage,
        };
      }
      return { ok: true, summary: sessionSummary(session.id), usage };
    },
    stop(task, sessionId) {
      if (!sessionId) {
        return;
      }
      void sessions.get(sessionId)?.cancel().catch(() => undefined);
    },
  };
}

function notifyOutcome(task: Task, outcome: TaskExecutorResult): void {
  if (task.executor.kind === "notify") {
    return; // notify 任务执行即通知，不再重复
  }
  showNotification(
    outcome.ok ? `任务完成 · ${task.title}` : `任务失败 · ${task.title}`,
    outcome.ok ? outcome.summary ?? "" : outcome.error?.message ?? "agent run failed",
  );
}

// ---------- 生命周期 ----------

export function startTasksService(
  broadcast: (channel: string, payload: unknown) => void,
  sessions: Map<string, AgentSession>,
): void {
  if (runtime) {
    return;
  }
  store = new TaskStore(getDb());
  runtime = new TaskRuntime({
    store,
    executor: createTaskExecutor(sessions),
    broadcast,
    notify: notifyOutcome,
  });
  setActiveTaskRuntime(runtime);
  runtime.start();
}

export function shutdownTasks(): void {
  runtime?.shutdown();
  setActiveTaskRuntime(null);
  runtime = null;
  store = null;
}

function requireRuntime(): TaskRuntime {
  if (!runtime) {
    throw new Error("tasks service is not running");
  }
  return runtime;
}

// ---------- 对外命令 ----------

export function listTasks(): TaskListResult {
  return requireRuntime().list();
}

export function getTaskDetail(
  id: string,
): { task: Task; attempts: TaskAttempt[]; queue?: TaskQueueInfo } | null {
  return requireRuntime().get(id);
}

export function taskJournal(id: string): TaskJournalEntry[] {
  return requireRuntime().journal(id);
}

export function createTask(input: unknown): Task | { error: string } {
  const parsed = validateTaskInput(input);
  if ("error" in parsed) {
    return parsed;
  }
  const now = Date.now();
  const task: Task = {
    id: randomUUID(),
    title: parsed.value.title,
    goal: parsed.value.goal,
    trigger: parsed.value.trigger,
    executor: parsed.value.executor,
    acceptance: parsed.value.acceptance ?? "auto",
    priority: parsed.value.priority,
    category: parsed.value.category,
    grant: { ...parsed.value.grant, grantedAt: now },
    budget: { maxRetries: parsed.value.budget?.maxRetries ?? DEFAULT_MAX_RETRIES },
    status: "idle",
    enabled: true,
    gen: 0,
    retryCount: 0,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
  return requireRuntime().create(task);
}

export function updateTask(patch: unknown): Task | { error: string } | null {
  if (!isRecord(patch) || typeof patch.id !== "string" || !patch.id) {
    return { error: "invalid task patch" };
  }
  const current = requireRuntime().get(patch.id)?.task;
  if (!current) {
    return null;
  }
  const merged = {
    title: patch.title ?? current.title,
    goal: patch.goal ?? current.goal,
    trigger: patch.trigger ?? current.trigger,
    executor: patch.executor ?? current.executor,
    acceptance: patch.acceptance ?? current.acceptance,
    priority: "priority" in patch ? patch.priority : current.priority,
    category: "category" in patch ? patch.category : current.category,
    budget: patch.budget ?? current.budget,
    grant: patch.grant ?? current.grant,
  };
  const parsed = validateTaskInput(merged);
  if ("error" in parsed) {
    return parsed;
  }
  const next: Task = {
    ...current,
    title: parsed.value.title,
    goal: parsed.value.goal,
    trigger: parsed.value.trigger,
    executor: parsed.value.executor,
    acceptance: parsed.value.acceptance ?? current.acceptance,
    priority: parsed.value.priority,
    category: parsed.value.category,
    budget: { maxRetries: parsed.value.budget?.maxRetries ?? current.budget.maxRetries },
    // 授权被替换时重新计时；否则保留原授权（含撤销/到期时刻）
    grant: patch.grant ? { ...parsed.value.grant, grantedAt: Date.now() } : current.grant,
    updatedAt: Date.now(),
  };
  return requireRuntime().update(next);
}

export function runTaskNow(id: string): { ok: boolean; error?: string } {
  return requireRuntime().runNow(id);
}

export function pauseTask(id: string): Task | null {
  return requireRuntime().pause(id);
}

export function resumeTask(id: string): Task | null {
  return requireRuntime().resume(id);
}

export function cancelTask(id: string): Task | null {
  return requireRuntime().cancel(id);
}

export function acceptTask(id: string): Task | null {
  return requireRuntime().accept(id);
}

export function rejectTask(id: string, feedback: string): Task | null {
  return requireRuntime().reject(id, typeof feedback === "string" ? feedback : "");
}

export function archiveTask(id: string): Task | null {
  return requireRuntime().archive(id);
}

export function unarchiveTask(id: string): Task | null {
  return requireRuntime().unarchive(id);
}

export function ackTask(id: string): Task | null {
  return requireRuntime().ack(id);
}

/** 等补充信息时回答：approve 只在 wait.kind === "input" 时有意义（值被忽略） */
export function decideTask(id: string, input?: string): Task | null {
  return requireRuntime().decide(id, typeof input === "string" ? input : undefined);
}

export function removeTask(id: string): boolean {
  return requireRuntime().remove(id);
}

/** 事件源只用于测试与将来的扩展入口 */
export function fireTaskEvent(source: TaskEventSource): void {
  requireRuntime().fireEvent(source);
}
