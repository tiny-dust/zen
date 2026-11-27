import type Database from "better-sqlite3";

import type {
  Task,
  TaskAttempt,
  TaskCategory,
  TaskError,
  TaskExecutor,
  TaskGrant,
  TaskJournalEntry,
  TaskPriority,
  TaskStatus,
  TaskTrigger,
  TaskWait,
} from "@zen/shared";

/**
 * 持续任务持久化（tasks / task_attempts / task_journal 三张表，同一个 zen.sqlite）。
 * 只做 CREATE TABLE IF NOT EXISTS：旧计划任务（scheduled_tasks）与其运行历史保持原样，
 * 两边互不读写。表结构变更只做加法，读不懂的脏 JSON 回落到安全默认值而不是抛错。
 */

interface TaskRow {
  id: string;
  title: string;
  goal: string;
  origin_conversation_id: string | null;
  trigger_json: string;
  executor_json: string;
  grant_json: string;
  budget_json: string;
  acceptance: string;
  priority: string | null;
  category: string | null;
  status: string;
  enabled: number;
  gen: number;
  retry_count: number;
  consecutive_failures: number;
  wait_json: string | null;
  next_run_at: number | null;
  last_error_json: string | null;
  last_attempt_id: string | null;
  last_run_at: number | null;
  last_run_status: string | null;
  ended_at: number | null;
  archived_at: number | null;
  acked_at: number | null;
  created_at: number;
  updated_at: number;
}

interface AttemptRow {
  id: string;
  task_id: string;
  gen: number;
  cause: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  input_tokens: number;
  output_tokens: number;
  session_id: string | null;
  result_summary: string | null;
  error_json: string | null;
}

interface JournalRow {
  task_id: string;
  seq: number;
  at: number;
  type: string;
  from_status: string | null;
  to_status: string | null;
  summary: string | null;
  attempt_id: string | null;
}

/** 每任务保留的执行记录条数（超出裁最旧，防秒级任务把表撑大） */
const KEEP_ATTEMPTS = 50;

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toTask(row: TaskRow): Task {
  const trigger = parseJson<TaskTrigger>(row.trigger_json) ?? { kind: "manual" };
  const executor = parseJson<TaskExecutor>(row.executor_json) ?? {
    kind: "notify",
    text: row.title,
  };
  const grant = parseJson<TaskGrant>(row.grant_json) ?? {
    level: 0,
    paths: [],
    grantedAt: row.created_at,
  };
  const budget = parseJson<{ maxRetries: number }>(row.budget_json);
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    originConversationId: row.origin_conversation_id ?? undefined,
    trigger,
    executor,
    grant,
    budget: { maxRetries: budget?.maxRetries ?? 0 },
    acceptance: row.acceptance === "user" ? "user" : "auto",
    priority: (row.priority as TaskPriority | null) ?? undefined,
    category: (row.category as TaskCategory | null) ?? undefined,
    status: row.status as TaskStatus,
    enabled: row.enabled === 1,
    gen: row.gen,
    retryCount: row.retry_count,
    consecutiveFailures: row.consecutive_failures,
    wait: parseJson<TaskWait>(row.wait_json) ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    lastError: parseJson<TaskError>(row.last_error_json) ?? undefined,
    lastAttemptId: row.last_attempt_id ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunStatus: (row.last_run_status as Task["lastRunStatus"]) ?? undefined,
    endedAt: row.ended_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    ackedAt: row.acked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttempt(row: AttemptRow): TaskAttempt {
  return {
    id: row.id,
    taskId: row.task_id,
    gen: row.gen,
    cause: row.cause as TaskAttempt["cause"],
    status: row.status as TaskAttempt["status"],
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    sessionId: row.session_id ?? undefined,
    result: row.result_summary === null ? undefined : { summary: row.result_summary },
    error: parseJson<TaskError>(row.error_json) ?? undefined,
  };
}

function toJournal(row: JournalRow): TaskJournalEntry {
  return {
    seq: row.seq,
    taskId: row.task_id,
    at: row.at,
    type: row.type as TaskJournalEntry["type"],
    from: (row.from_status as TaskStatus | null) ?? undefined,
    to: (row.to_status as TaskStatus | null) ?? undefined,
    summary: row.summary ?? undefined,
    attemptId: row.attempt_id ?? undefined,
  };
}

export class TaskStore {
  constructor(private readonly db: Database.Database) {
    this.ensure();
  }

  ensure(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        origin_conversation_id TEXT,
        trigger_json TEXT NOT NULL,
        executor_json TEXT NOT NULL,
        grant_json TEXT NOT NULL,
        budget_json TEXT NOT NULL,
        acceptance TEXT NOT NULL,
        priority TEXT,
        category TEXT,
        status TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        gen INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        consecutive_failures INTEGER NOT NULL,
        wait_json TEXT,
        next_run_at INTEGER,
        last_error_json TEXT,
        last_attempt_id TEXT,
        last_run_at INTEGER,
        last_run_status TEXT,
        ended_at INTEGER,
        archived_at INTEGER,
        acked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        gen INTEGER NOT NULL,
        cause TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        result_summary TEXT,
        error_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_task_attempts_task
        ON task_attempts (task_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS task_journal (
        task_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        summary TEXT,
        attempt_id TEXT,
        PRIMARY KEY (task_id, seq)
      );
    `);
  }

  list(): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at ASC, id ASC")
      .all() as TaskRow[];
    return rows.map(toTask);
  }

  get(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  insert(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks
         (id, title, goal, origin_conversation_id, trigger_json, executor_json, grant_json,
          budget_json, acceptance, priority, category, status, enabled, gen, retry_count,
          consecutive_failures, wait_json, next_run_at, last_error_json, last_attempt_id,
          last_run_at, last_run_status, ended_at, archived_at, acked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.goal,
        task.originConversationId ?? null,
        JSON.stringify(task.trigger),
        JSON.stringify(task.executor),
        JSON.stringify(task.grant),
        JSON.stringify(task.budget),
        task.acceptance,
        task.priority ?? null,
        task.category ?? null,
        task.status,
        task.enabled ? 1 : 0,
        task.gen,
        task.retryCount,
        task.consecutiveFailures,
        task.wait ? JSON.stringify(task.wait) : null,
        task.nextRunAt ?? null,
        task.lastError ? JSON.stringify(task.lastError) : null,
        task.lastAttemptId ?? null,
        task.lastRunAt ?? null,
        task.lastRunStatus ?? null,
        task.endedAt ?? null,
        task.archivedAt ?? null,
        task.ackedAt ?? null,
        task.createdAt,
        task.updatedAt,
      );
  }

  update(task: Task): void {
    this.db
      .prepare(
        `UPDATE tasks SET
           title = ?, goal = ?, origin_conversation_id = ?, trigger_json = ?, executor_json = ?,
           grant_json = ?, budget_json = ?, acceptance = ?, priority = ?, category = ?,
           status = ?, enabled = ?, gen = ?, retry_count = ?, consecutive_failures = ?,
           wait_json = ?, next_run_at = ?, last_error_json = ?, last_attempt_id = ?,
           last_run_at = ?, last_run_status = ?, ended_at = ?, archived_at = ?, acked_at = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        task.title,
        task.goal,
        task.originConversationId ?? null,
        JSON.stringify(task.trigger),
        JSON.stringify(task.executor),
        JSON.stringify(task.grant),
        JSON.stringify(task.budget),
        task.acceptance,
        task.priority ?? null,
        task.category ?? null,
        task.status,
        task.enabled ? 1 : 0,
        task.gen,
        task.retryCount,
        task.consecutiveFailures,
        task.wait ? JSON.stringify(task.wait) : null,
        task.nextRunAt ?? null,
        task.lastError ? JSON.stringify(task.lastError) : null,
        task.lastAttemptId ?? null,
        task.lastRunAt ?? null,
        task.lastRunStatus ?? null,
        task.endedAt ?? null,
        task.archivedAt ?? null,
        task.ackedAt ?? null,
        task.updatedAt,
        task.id,
      );
  }

  /** 只允许删已归档任务（调用方校验），级联删执行记录与日志；执行产生的会话保留 */
  remove(id: string): void {
    this.db.prepare("DELETE FROM task_attempts WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM task_journal WHERE task_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }

  attempts(taskId: string): TaskAttempt[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC",
      )
      .all(taskId) as AttemptRow[];
    return rows.map(toAttempt);
  }

  getAttempt(id: string): TaskAttempt | null {
    const row = this.db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(id) as
      | AttemptRow
      | undefined;
    return row ? toAttempt(row) : null;
  }

  insertAttempt(attempt: TaskAttempt): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_attempts
         (id, task_id, gen, cause, status, started_at, ended_at, input_tokens, output_tokens,
          session_id, result_summary, error_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.taskId,
        attempt.gen,
        attempt.cause,
        attempt.status,
        attempt.startedAt,
        attempt.endedAt ?? null,
        attempt.usage.inputTokens,
        attempt.usage.outputTokens,
        attempt.sessionId ?? null,
        attempt.result?.summary ?? null,
        attempt.error ? JSON.stringify(attempt.error) : null,
      );
    this.trimAttempts(attempt.taskId);
  }

  updateAttempt(attempt: TaskAttempt): void {
    this.insertAttempt(attempt);
  }

  /** 秒级任务防表无限增长：只留最近 KEEP_ATTEMPTS 条 */
  private trimAttempts(taskId: string): void {
    this.db
      .prepare(
        `DELETE FROM task_attempts WHERE task_id = ? AND id NOT IN (
           SELECT id FROM task_attempts WHERE task_id = ?
           ORDER BY started_at DESC, id DESC LIMIT ?
         )`,
      )
      .run(taskId, taskId, KEEP_ATTEMPTS);
  }

  appendJournal(entry: Omit<TaskJournalEntry, "seq">): void {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM task_journal WHERE task_id = ?")
      .get(entry.taskId) as { next: number };
    this.db
      .prepare(
        `INSERT INTO task_journal
         (task_id, seq, at, type, from_status, to_status, summary, attempt_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.taskId,
        row.next,
        entry.at,
        entry.type,
        entry.from ?? null,
        entry.to ?? null,
        entry.summary ?? null,
        entry.attemptId ?? null,
      );
  }

  journal(taskId: string): TaskJournalEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM task_journal WHERE task_id = ? ORDER BY seq ASC")
      .all(taskId) as JournalRow[];
    return rows.map(toJournal);
  }
}
