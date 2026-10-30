import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeSessionGoal } from "@zen/shared";
import type { WorkspaceGroup } from "@zen/shared";

import { checkGoalReminders } from "./goal-reminders";

const notificationState = vi.hoisted(() => ({
  notifications: [] as Array<{ title: string; body: string; click?: () => void }>,
  supported: true,
}));

vi.mock("electron", () => ({
  Notification: class {
    static isSupported() { return notificationState.supported; }
    private readonly item: { title: string; body: string; click?: () => void };
    constructor(content: { title: string; body: string }) {
      this.item = { ...content };
    }
    on(event: string, handler: () => void) {
      if (event === "click") this.item.click = handler;
    }
    show() { notificationState.notifications.push(this.item); }
  },
}));

let conn: Database.Database;
let groups: WorkspaceGroup[];

vi.mock("./model-db-connection", () => ({ getDb: () => conn }));
vi.mock("./workspace-db", () => ({ listWorkspaceGroups: () => groups }));

function session(id: string, goal: WorkspaceGroup["sessions"][number]["goal"], updatedAt = 0) {
  return {
    id,
    title: `会话 ${id}`,
    workspaceId: null,
    draft: "",
    pinned: false,
    archived: false,
    createdAt: 0,
    updatedAt,
    goal,
  };
}

function group(sessions: WorkspaceGroup["sessions"]): WorkspaceGroup {
  return {
    id: "common",
    name: "公共区",
    path: null,
    kind: "common",
    pinned: false,
    archived: false,
    createdAt: 0,
    sessions,
  };
}

beforeEach(() => {
  conn = new Database(":memory:");
  conn.pragma("foreign_keys = ON");
  conn.exec("CREATE TABLE chat_sessions (id TEXT PRIMARY KEY)");
  notificationState.notifications = [];
  notificationState.supported = true;
  groups = [];
});

afterEach(() => {
  conn.close();
  vi.clearAllMocks();
});

describe("goal reminders", () => {
  it("仅在设置的间隔后提醒，且每个会话独立记录时间", () => {
    const oneHour = { text: "目标 A", status: "active" as const, tokenBudget: null, reminderIntervalHours: 1 };
    groups = [group([session("a", oneHour), session("b", oneHour)])];
    conn.prepare("INSERT INTO chat_sessions (id) VALUES (?), (?)").run("a", "b");
    const openSession = vi.fn();
    const options = { isSessionRunning: (id: string) => id === "b", openSession };

    checkGoalReminders(3_600_000, options);
    expect(notificationState.notifications).toHaveLength(1);
    expect(notificationState.notifications[0]?.title).toBe("会话 a");
    notificationState.notifications[0]?.click?.();
    expect(openSession).toHaveBeenCalledWith("a");

    checkGoalReminders(3_600_001, { ...options, isSessionRunning: () => false });
    expect(notificationState.notifications.map((item) => item.title)).toEqual(["会话 a", "会话 b"]);

    // 模拟应用重启：同一个 SQLite 状态再次检查也不会重复提醒。
    checkGoalReminders(3_600_002, { ...options, isSessionRunning: () => false });
    expect(notificationState.notifications).toHaveLength(2);
    checkGoalReminders(7_200_002, { ...options, isSessionRunning: () => false });
    expect(notificationState.notifications).toHaveLength(4);
  });

  it("暂停、归档、未设置提醒和最近活动的会话均不提醒", () => {
    const due = { text: "目标", status: "active" as const, tokenBudget: null, reminderIntervalHours: 1 };
    groups = [group([
      session("paused", { ...due, status: "paused" }),
      { ...session("archived", due), archived: true },
      session("off", { ...due, reminderIntervalHours: undefined }),
      session("recent", due, 3_000_000),
    ])];
    for (const id of ["paused", "archived", "off", "recent"]) {
      conn.prepare("INSERT INTO chat_sessions (id) VALUES (?)").run(id);
    }
    checkGoalReminders(3_600_000, { isSessionRunning: () => false, openSession: vi.fn() });
    expect(notificationState.notifications).toHaveLength(0);
    groups[0]!.archived = true;
    checkGoalReminders(7_200_000, { isSessionRunning: () => false, openSession: vi.fn() });
    expect(notificationState.notifications).toHaveLength(0);
  });

  it("目标变化后重新按当前活动时间计算；系统通知不可用时不记为已提醒", () => {
    const goal = { text: "旧目标", status: "active" as const, tokenBudget: null, reminderIntervalHours: 1 };
    groups = [group([session("s", goal)])];
    conn.prepare("INSERT INTO chat_sessions (id) VALUES (?)").run("s");
    const options = { isSessionRunning: () => false, openSession: vi.fn() };
    notificationState.supported = false;
    checkGoalReminders(3_600_000, options);
    expect(notificationState.notifications).toHaveLength(0);
    notificationState.supported = true;
    checkGoalReminders(3_600_001, options);
    expect(notificationState.notifications).toHaveLength(1);

    groups = [group([session("s", { ...goal, text: "新目标" }, 3_600_002)])];
    checkGoalReminders(3_600_003, options);
    expect(notificationState.notifications).toHaveLength(1);
    checkGoalReminders(7_200_002, options);
    expect(notificationState.notifications).toHaveLength(2);
    expect(notificationState.notifications[1]?.body).toContain("新目标");
  });

  it("提醒间隔只接受 1 到 168 小时的整数", () => {
    const base = { text: "目标", status: "active", tokenBudget: null };
    expect(normalizeSessionGoal({ ...base, reminderIntervalHours: 24 })?.reminderIntervalHours).toBe(24);
    for (const reminderIntervalHours of [0, -1, 1.5, 169, "24"]) {
      expect(normalizeSessionGoal({ ...base, reminderIntervalHours })?.reminderIntervalHours).toBeUndefined();
    }
  });
});
