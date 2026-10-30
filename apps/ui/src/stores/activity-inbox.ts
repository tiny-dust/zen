import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

import { useChatStore } from "@/stores/chat";
import { useSchedulerStore } from "@/stores/scheduler";
import { useSessionStatusStore } from "@/stores/session-status";
import { useWorkspaceStore } from "@/stores/workspace";

import type { ScheduledTask, SessionRecord } from "@zen/shared";

const SEEN_RUNS_KEY = "zen.activityInbox.seenScheduledRuns";

function loadSeenRuns(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_RUNS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

/** 从现有会话与计划任务派生收件箱，不另存一份任务状态。 */
export const useActivityInboxStore = defineStore("activity-inbox", () => {
  const workspaceStore = useWorkspaceStore();
  const chatStore = useChatStore();
  const sessionStatus = useSessionStatusStore();
  const schedulerStore = useSchedulerStore();

  const open = shallowRef(false);
  const seenRuns = ref(loadSeenRuns());

  const sessions = computed<SessionRecord[]>(() =>
    workspaceStore.groups
      .filter((group) => !group.archived)
      .flatMap((group) => group.sessions.filter((session) => !session.archived))
      .map((session) =>
        session.id === chatStore.sessionId
          ? { ...session, goal: chatStore.sessionGoal }
          : session,
      ),
  );

  const needsAction = computed(() =>
    sessions.value.filter((session) => sessionStatus.byId[session.id] === "needs_action"),
  );

  const unseenResults = computed(() =>
    sessions.value.filter(
      (session) =>
        sessionStatus.hasUnseenResult(session.id) &&
        (sessionStatus.byId[session.id] === "done" || sessionStatus.byId[session.id] === "error"),
    ),
  );

  const running = computed(() =>
    sessions.value.filter((session) => sessionStatus.byId[session.id] === "running"),
  );

  const goals = computed(() =>
    sessions.value.filter(
      (session) => session.goal && session.goal.status !== "complete",
    ),
  );

  const scheduledResults = computed(() =>
    schedulerStore.tasks
      .filter((task) => task.lastRunAt !== null)
      .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0)),
  );

  function isScheduledUnread(task: ScheduledTask): boolean {
    return task.lastRunAt !== null && task.lastRunAt > (seenRuns.value[task.id] ?? 0);
  }

  const pendingCount = computed(() => {
    const pendingSessions = new Set([
      ...needsAction.value.map((session) => session.id),
      ...unseenResults.value.map((session) => session.id),
      ...goals.value.filter((session) => session.goal?.status === "blocked").map((session) => session.id),
    ]);
    const unreadSchedules = scheduledResults.value.filter(
      (task) => isScheduledUnread(task) && (!task.lastSessionId || !pendingSessions.has(task.lastSessionId)),
    );
    return pendingSessions.size + unreadSchedules.length;
  });

  function markScheduledSeen(task: ScheduledTask): void {
    if (task.lastRunAt === null || !isScheduledUnread(task)) {
      return;
    }
    seenRuns.value = { ...seenRuns.value, [task.id]: task.lastRunAt };
    try {
      localStorage.setItem(SEEN_RUNS_KEY, JSON.stringify(seenRuns.value));
    } catch {
      // 存储不可用时，当前窗口内仍可清除未读状态。
    }
  }

  function markResultsSeen(): void {
    for (const session of unseenResults.value) {
      sessionStatus.markSeen(session.id);
    }
    for (const task of scheduledResults.value) {
      markScheduledSeen(task);
    }
  }

  return {
    open,
    sessions,
    needsAction,
    unseenResults,
    running,
    goals,
    scheduledResults,
    pendingCount,
    isScheduledUnread,
    markScheduledSeen,
    markResultsSeen,
  };
});
