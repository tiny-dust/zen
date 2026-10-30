import { Notification } from "electron";

import { getDb } from "./model-db-connection";
import { listWorkspaceGroups } from "./workspace-db";

interface GoalReminderOptions {
  isSessionRunning: (sessionId: string) => boolean;
  openSession: (sessionId: string) => void;
}

interface ReminderRow {
  goal_text: string;
  last_sent_at: number;
}

const CHECK_INTERVAL_MS = 60_000;
let reminderTimer: ReturnType<typeof setInterval> | null = null;

/** 记录每个会话上一次提醒，应用重启后也不重复发送。 */
function ensureReminderTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS session_goal_reminders (
      session_id TEXT PRIMARY KEY,
      goal_text TEXT NOT NULL,
      last_sent_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    )
  `);
}

/** Electron Notification 在 macOS、Windows、Linux 上提供同一入口；系统不支持时安静降级。 */
function showReminder(sessionId: string, title: string, goalText: string, openSession: (id: string) => void): boolean {
  if (!Notification.isSupported()) {
    return false;
  }
  try {
    const notification = new Notification({
      title: title.slice(0, 80) || "Zen",
      body: `目标提醒：${goalText}`.slice(0, 240),
    });
    notification.on("click", () => openSession(sessionId));
    notification.show();
    return true;
  } catch {
    return false;
  }
}

/** 只检查当前用户可见且未归档的会话，提醒时间按会话单独计算。 */
export function checkGoalReminders(now: number, options: GoalReminderOptions): void {
  try {
    ensureReminderTable();
    const db = getDb();
    const readLast = db.prepare(
      "SELECT goal_text, last_sent_at FROM session_goal_reminders WHERE session_id = ?",
    );
    const saveLast = db.prepare(`
      INSERT INTO session_goal_reminders (session_id, goal_text, last_sent_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET goal_text = excluded.goal_text, last_sent_at = excluded.last_sent_at
    `);

    for (const group of listWorkspaceGroups()) {
      if (group.archived) continue;
      for (const session of group.sessions) {
        const goal = session.goal;
        if (session.archived || goal?.status !== "active" || !goal.reminderIntervalHours) continue;
        if (options.isSessionRunning(session.id)) continue;

        const previous = readLast.get(session.id) as ReminderRow | undefined;
        const lastReminder = previous?.goal_text === goal.text ? previous.last_sent_at : 0;
        const lastActivity = Math.max(session.updatedAt, lastReminder);
        if (now - lastActivity < goal.reminderIntervalHours * 3_600_000) continue;

        if (showReminder(session.id, session.title, goal.text, options.openSession)) {
          saveLast.run(session.id, goal.text, now);
        }
      }
    }
  } catch (error) {
    // 提醒失败不能阻断聊天或应用启动；下次轮询会重试。
    console.warn("[zen] 目标提醒检查失败:", error);
  }
}

/** 提醒在本机运行，关闭应用后停止；重启时从数据库恢复发送时间。 */
export function startGoalReminders(options: GoalReminderOptions): void {
  if (reminderTimer) return;
  checkGoalReminders(Date.now(), options);
  reminderTimer = setInterval(() => checkGoalReminders(Date.now(), options), CHECK_INTERVAL_MS);
}

export function shutdownGoalReminders(): void {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
}
