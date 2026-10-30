import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useActivityInboxStore } from "@/stores/activity-inbox";
import { useChatStore } from "@/stores/chat";
import { useSchedulerStore } from "@/stores/scheduler";
import { useSessionStatusStore } from "@/stores/session-status";
import { useWorkspaceStore } from "@/stores/workspace";

import type { ScheduledTask, SessionRecord } from "@zen/shared";

function session(id: string): SessionRecord {
  return {
    id,
    title: id,
    workspaceId: "common",
    draft: "",
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function scheduledTask(id: string, lastSessionId: string | null): ScheduledTask {
  return {
    id,
    name: id,
    prompt: id,
    schedule: { kind: "once", at: 1000 },
    enabled: false,
    workspacePath: null,
    lastRunAt: 1000,
    lastRunOk: true,
    lastResult: "done",
    lastSessionId,
    createdAt: 1,
    updatedAt: 1000,
  };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe("activity inbox", () => {
  it("聚合会话和计划任务的待处理状态，同一运行结果只计一次", () => {
    const workspace = useWorkspaceStore();
    workspace.groups = [{
      id: "common", name: "公共区", path: null, kind: "common", pinned: false,
      archived: false, createdAt: 1,
      sessions: [
        session("needs-action"),
        session("finished"),
        { ...session("blocked"), goal: { text: "修复构建", status: "blocked", tokenBudget: null } },
      ],
    }];
    const status = useSessionStatusStore();
    status.set("needs-action", "needs_action");
    status.set("finished", "done");
    const scheduler = useSchedulerStore();
    scheduler.tasks = [
      scheduledTask("same-result", "finished"),
      scheduledTask("independent-result", null),
    ];

    const inbox = useActivityInboxStore();
    expect(inbox.pendingCount).toBe(4);
    expect(inbox.goals.map((item) => item.id)).toEqual(["blocked"]);
    expect(inbox.scheduledResults.map((item) => item.id)).toEqual([
      "same-result", "independent-result",
    ]);

    inbox.markResultsSeen();
    expect(inbox.pendingCount).toBe(2);
    expect(status.hasUnseenResult("finished")).toBe(false);
    expect(inbox.isScheduledUnread(scheduler.tasks[0]!)).toBe(false);
  });

  it("计划任务已读回执持久化；当前会话目标状态实时覆盖侧栏快照", () => {
    const workspace = useWorkspaceStore();
    workspace.groups = [{
      id: "common", name: "公共区", path: null, kind: "common", pinned: false,
      archived: false, createdAt: 1,
      sessions: [{ ...session("goal"), goal: { text: "旧状态", status: "blocked", tokenBudget: null } }],
    }];
    const scheduler = useSchedulerStore();
    scheduler.tasks = [scheduledTask("daily", null)];
    const chat = useChatStore();
    chat.sessionId = "goal";
    chat.sessionGoal = { text: "新状态", status: "complete", tokenBudget: null };

    const inbox = useActivityInboxStore();
    expect(inbox.goals).toEqual([]);
    expect(inbox.pendingCount).toBe(1);
    inbox.markScheduledSeen(scheduler.tasks[0]!);
    expect(inbox.pendingCount).toBe(0);
    expect(JSON.parse(localStorage.getItem("zen.activityInbox.seenScheduledRuns") ?? "{}")).toEqual({ daily: 1000 });
  });
});
