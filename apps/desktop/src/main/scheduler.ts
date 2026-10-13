import { randomUUID } from "node:crypto";

import { Notification } from "electron";

import { runAgentRequest } from "./agent-runner";
import { currentLocale, mainT } from "./i18n";
import { isTaskDue, isValidSchedule } from "./scheduler-core";
import { getDb } from "./model-db-connection";
import {
  createSession,
  createWorkspace,
  getSession as loadSessionRecord,
  listWorkspaceGroups,
} from "./workspace-db";

import type { AgentSession } from "@zen/agent-core";
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskRunEvent } from "@zen/shared";

/**
 * 定时/计划任务：scheduled_tasks 表（复用 zen.sqlite 连接）+ 每分钟 tick 的最小调度器。
 * 触发执行走 runAgentRequest（飞书入口同款 headless：不传 send，流事件只落库），
 * 跑完把结果摘要写回任务并 Notification 通知（失败静默降级）。
 * 到期判断等纯函数在 scheduler-core.ts（带单测）。
 */

interface TaskRow {
  id: string;
  name: string;
  prompt: string;
  schedule_json: string;
  enabled: number;
  workspace_path: string | null;
  last_run_at: number | null;
  last_result: string | null;
  last_run_ok: number | null;
  created_at: number;
  updated_at: number;
}

/** 摘要最长保留字符数（助手回复/错误信息截断入库） */
const RESULT_SUMMARY_LIMIT = 400;

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      workspace_path TEXT,
      last_run_at INTEGER,
      last_result TEXT,
      last_run_ok INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/**
 * 解析入库的 schedule JSON；读取时把旧版结构归一到当前形状：
 * - 旧 interval（intervalMinutes）→ { every, unit: "minute" }
 * - 旧 daily（dailyTime）→ { time }
 * 脏数据回落到不会到期的结构（every=0）。
 */
function parseSchedule(json: string): ScheduledTask["schedule"] {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown> & { kind?: string };
    if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") {
      throw new Error("invalid schedule");
    }
    if (parsed.kind === "interval") {
      if (Number.isInteger(parsed.intervalMinutes)) {
        return { kind: "interval", every: parsed.intervalMinutes as number, unit: "minute" };
      }
      return {
        kind: "interval",
        every: parsed.every as number | undefined,
        unit: parsed.unit as "second" | "minute" | "hour" | "day" | "month" | undefined,
      };
    }
    if (parsed.kind === "daily" && typeof parsed.dailyTime === "string") {
      return { kind: "daily", time: parsed.dailyTime };
    }
    if (["daily", "monthly", "once", "window"].includes(parsed.kind)) {
      return parsed as unknown as ScheduledTask["schedule"];
    }
  } catch {
    // 脏数据回落到不会到期的结构
  }
  return { kind: "interval", every: 0, unit: "minute" };
}

function toTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    schedule: parseSchedule(row.schedule_json),
    enabled: row.enabled === 1,
    workspacePath: row.workspace_path,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    lastRunOk: row.last_run_ok === null ? null : row.last_run_ok === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listScheduledTasks(): ScheduledTask[] {
  ensureTable();
  const rows = getDb()
    .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at ASC")
    .all() as TaskRow[];
  return rows.map(toTask);
}

function getTask(id: string): ScheduledTask | null {
  const row = getDb().prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row ? toTask(row) : null;
}

/** 边界校验 + 规整渲染层入参（IPC 传来的必须是纯对象，这里再做一层防御） */
function sanitizeInput(
  input: Partial<ScheduledTaskInput> | undefined,
): { value: ScheduledTaskInput } | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "invalid task input" };
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!name) {
    return { error: "task name is required" };
  }
  if (!prompt) {
    return { error: "task prompt is required" };
  }
  const schedule = input.schedule;
  if (!isValidSchedule(schedule)) {
    return { error: "invalid task schedule" };
  }
  const workspacePath =
    typeof input.workspacePath === "string" && input.workspacePath.trim()
      ? input.workspacePath.trim()
      : null;
  return {
    value: {
      name,
      prompt,
      schedule,
      enabled: input.enabled !== false,
      workspacePath,
    },
  };
}

export function createScheduledTask(
  input: Partial<ScheduledTaskInput>,
): ScheduledTask | { error: string } {
  const parsed = sanitizeInput(input);
  if ("error" in parsed) {
    return parsed;
  }
  ensureTable();
  const now = Date.now();
  const row: TaskRow = {
    id: randomUUID(),
    name: parsed.value.name,
    prompt: parsed.value.prompt,
    schedule_json: JSON.stringify(parsed.value.schedule),
    enabled: parsed.value.enabled ? 1 : 0,
    workspace_path: parsed.value.workspacePath,
    last_run_at: null,
    last_result: null,
    last_run_ok: null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO scheduled_tasks
       (id, name, prompt, schedule_json, enabled, workspace_path, last_run_at, last_result, last_run_ok, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.name,
      row.prompt,
      row.schedule_json,
      row.enabled,
      row.workspace_path,
      row.last_run_at,
      row.last_result,
      row.last_run_ok,
      row.created_at,
      row.updated_at,
    );
  return toTask(row);
}

/** 编辑：只接受白名单字段的 patch（名称/指令/调度/启用/目标工作区），结果摘要等运行态不可改 */
export function updateScheduledTask(
  id: string,
  patch: Partial<ScheduledTaskInput>,
): ScheduledTask | null | { error: string } {
  const existing = getTask(id);
  if (!existing) {
    return null;
  }
  const merged = sanitizeInput({ ...existing, ...patch });
  if ("error" in merged) {
    return merged;
  }
  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE scheduled_tasks
       SET name = ?, prompt = ?, schedule_json = ?, enabled = ?, workspace_path = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.value.name,
      merged.value.prompt,
      JSON.stringify(merged.value.schedule),
      merged.value.enabled ? 1 : 0,
      merged.value.workspacePath,
      now,
      id,
    );
  return getTask(id);
}

export function setScheduledTaskEnabled(id: string, enabled: boolean): ScheduledTask | null {
  ensureTable();
  getDb()
    .prepare("UPDATE scheduled_tasks SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, Date.now(), id);
  return getTask(id);
}

export function removeScheduledTask(id: string): boolean {
  ensureTable();
  const result = getDb().prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------- 调度循环与执行 ----------

export type SchedulerBroadcast = (channel: string, payload: unknown) => void;

let tickTimer: ReturnType<typeof setInterval> | null = null;
/** 进行中的任务（防同一任务并发重入） */
const runningIds = new Set<string>();
let broadcast: SchedulerBroadcast | null = null;
let sessions: Map<string, AgentSession> | null = null;

function pushTasks(): void {
  broadcast?.("scheduler:changed", listScheduledTasks());
}

function pushRunEvent(event: ScheduledTaskRunEvent): void {
  broadcast?.("scheduler:run-event", event);
}

/** 系统通知：三平台 Electron Notification，不支持/失败时静默降级 */
async function notify(taskName: string, ok: boolean, summary: string): Promise<void> {
  try {
    if (!Notification.isSupported()) {
      return;
    }
    const locale = await currentLocale();
    const title = mainT(
      locale,
      ok ? "scheduler.notify.doneTitle" : "scheduler.notify.errorTitle",
      { name: taskName },
    );
    new Notification({ title, body: summary }).show();
  } catch {
    // 通知失败不影响任务本身
  }
}

/** 读取会话里最后一条助手消息作为结果摘要 */
function sessionResultSummary(sessionId: string): string {
  const record = loadSessionRecord(sessionId);
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

/** 执行一次任务：在目标工作区（或公共区）新建会话并 headless 运行 agent */
async function executeTask(task: ScheduledTask): Promise<void> {
  if (runningIds.has(task.id)) {
    return;
  }
  runningIds.add(task.id);
  // 先记 lastRunAt：interval 任务据此计下次到期；daily 任务据此判定「今天已跑过」
  getDb()
    .prepare("UPDATE scheduled_tasks SET last_run_at = ?, updated_at = ? WHERE id = ?")
    .run(Date.now(), Date.now(), task.id);
  try {
    let workspaceId: string;
    if (task.workspacePath) {
      const existing = listWorkspaceGroups().find(
        (group) => group.kind === "workspace" && group.path === task.workspacePath,
      );
      workspaceId = (existing ?? createWorkspace(task.workspacePath)).id;
    } else {
      workspaceId = "common";
    }
    const session = createSession(workspaceId);
    pushRunEvent({ taskId: task.id, state: "started", sessionId: session.id });
    const result = await runAgentRequest(
      {
        sessionId: session.id,
        workspaceId,
        // main 侧按 workspaceId 解析实际目录，该字段仅对齐渲染层口径
        workspaceRoot: task.workspacePath ?? "",
        userMessage: task.prompt,
        history: [],
      },
      { sessions: sessions ?? new Map() },
    );
    const summary = result.ok
      ? sessionResultSummary(session.id) || mainT(await currentLocale(), "scheduler.noReply")
      : result.error ?? "agent run failed";
    getDb()
      .prepare(
        "UPDATE scheduled_tasks SET last_result = ?, last_run_ok = ?, updated_at = ? WHERE id = ?",
      )
      .run(summary, result.ok ? 1 : 0, Date.now(), task.id);
    pushRunEvent({
      taskId: task.id,
      state: result.ok ? "done" : "error",
      sessionId: session.id,
      summary,
    });
    void notify(task.name, result.ok, summary);
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    getDb()
      .prepare(
        "UPDATE scheduled_tasks SET last_result = ?, last_run_ok = ?, updated_at = ? WHERE id = ?",
      )
      .run(summary, 0, Date.now(), task.id);
    pushRunEvent({ taskId: task.id, state: "error", summary });
    void notify(task.name, false, summary);
  } finally {
    runningIds.delete(task.id);
    // 单次任务触发后自动停用（无论成败）；lastRunAt 已能防重放，这里让列表状态直观
    if (task.schedule.kind === "once") {
      getDb()
        .prepare("UPDATE scheduled_tasks SET enabled = 0, updated_at = ? WHERE id = ?")
        .run(Date.now(), task.id);
    }
    pushTasks();
  }
}

function tick(): void {
  const now = Date.now();
  for (const task of listScheduledTasks()) {
    if (task.enabled && isTaskDue(task, now)) {
      void executeTask(task);
    }
  }
}

/** 启动调度循环（幂等）：每秒 tick（支持秒级 interval；DB 查询为微秒级小表，开销可忽略）；启动后 3 秒先补跑一次 */
export function startScheduler(
  broadcastFn: SchedulerBroadcast,
  agentSessions: Map<string, AgentSession>,
): void {
  broadcast = broadcastFn;
  sessions = agentSessions;
  if (tickTimer != null) {
    return;
  }
  ensureTable();
  setTimeout(() => tick(), 3_000).unref?.();
  tickTimer = setInterval(() => tick(), 1_000);
  tickTimer.unref?.();
}

export function shutdownScheduler(): void {
  if (tickTimer != null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  broadcast = null;
  sessions = null;
}

/** 立即执行一次（手动触发；不看 enabled 与调度周期），返回是否成功启动 */
export function runScheduledTaskNow(id: string): { ok: boolean; error?: string } {
  const task = getTask(id);
  if (!task) {
    return { ok: false, error: "task not found" };
  }
  if (runningIds.has(id)) {
    return { ok: false, error: "task is already running" };
  }
  void executeTask(task);
  return { ok: true };
}

/** 供 IPC 层与测试查询运行中状态 */
export function isTaskRunning(id: string): boolean {
  return runningIds.has(id);
}
