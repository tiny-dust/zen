<script setup lang="ts">
import { ArrowRight, Bell, Check, CircleAlert, LoaderCircle, Play } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openSessionById } from "@/lib/open-session";
import { useActivityInboxStore } from "@/stores/activity-inbox";
import { useChatStore } from "@/stores/chat";
import { useSchedulerStore } from "@/stores/scheduler";
import { useSessionStatusStore } from "@/stores/session-status";
import { useWorkspaceStore } from "@/stores/workspace";

import type { ScheduledTask, SessionRecord } from "@zen/shared";

const inbox = useActivityInboxStore();
const scheduler = useSchedulerStore();
const sessionStatus = useSessionStatusStore();
const workspace = useWorkspaceStore();
const chat = useChatStore();
const { open, needsAction, unseenResults, running, goals, scheduledResults, pendingCount } =
  storeToRefs(inbox);
const { t } = useI18n();
const error = shallowRef("");

const blockedGoals = computed(() => {
  const alreadyListed = new Set([
    ...needsAction.value.map((session) => session.id),
    ...unseenResults.value.map((session) => session.id),
  ]);
  return goals.value.filter(
    (session) => session.goal?.status === "blocked" && !alreadyListed.has(session.id),
  );
});
const otherGoals = computed(() => goals.value.filter((session) => session.goal?.status !== "blocked"));
const hasAttention = computed(
  () => needsAction.value.length > 0 || unseenResults.value.length > 0 || blockedGoals.value.length > 0,
);

function workspaceName(session: SessionRecord): string {
  return workspace.groups.find((group) => group.id === (session.workspaceId ?? "common"))?.name ?? "";
}

async function openSession(sessionId: string): Promise<boolean> {
  error.value = "";
  try {
    const found = await openSessionById(sessionId);
    if (!found) {
      error.value = t("activityInbox.sessionMissing");
      return false;
    }
    open.value = false;
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    return false;
  }
}

async function continueGoal(session: SessionRecord): Promise<void> {
  if (await openSession(session.id)) {
    await chat.continueGoal();
  }
}

async function openScheduledResult(task: ScheduledTask): Promise<void> {
  if (!task.lastSessionId || await openSession(task.lastSessionId)) {
    inbox.markScheduledSeen(task);
  }
}

function statusText(session: SessionRecord): string {
  switch (sessionStatus.byId[session.id]) {
    case "needs_action": return t("activityInbox.needsAction");
    case "error": return t("activityInbox.failed");
    case "done": return t("activityInbox.completed");
    default: return "";
  }
}

function goalStatusText(session: SessionRecord): string {
  switch (session.goal?.status) {
    case "blocked": return t("activityInbox.blocked");
    case "paused": return t("activityInbox.paused");
    default: return t("activityInbox.active");
  }
}

function reminderLabel(hours: number): string {
  return hours === 1
    ? t("activityInbox.reminderHourly")
    : t("activityInbox.reminderEvery", { hours });
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-large-panel="true"
      class="flex h-[min(84vh,720px)] w-[min(680px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
    >
      <DialogHeader class="flex-none border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <div class="flex items-center justify-between gap-3">
          <DialogTitle class="flex items-center gap-2 text-[15px]">
            <Bell class="size-4 text-[var(--color-accent)]" aria-hidden="true" />
            {{ t("activityInbox.title") }}
            <span v-if="pendingCount" class="rounded-full bg-[var(--color-side-chip)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]">
              {{ pendingCount }}
            </span>
          </DialogTitle>
          <Button variant="ghost" size="sm" class="mr-7 text-[var(--color-mut)]" @click="inbox.markResultsSeen()">
            <Check class="size-3.5" aria-hidden="true" />{{ t("activityInbox.markAllRead") }}
          </Button>
        </div>
        <DialogDescription class="text-[12px]">{{ t("activityInbox.desc") }}</DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <p v-if="error" role="alert" class="m-0 rounded-md bg-[var(--color-side-chip)] px-2 py-1.5 text-[12px] text-[var(--color-danger-fg)]">
          {{ error }}
        </p>

        <section class="flex flex-col gap-1.5" :aria-label="t('activityInbox.attention')">
          <h3 class="m-0 text-[12px] font-semibold text-[var(--color-txt-strong)]">
            {{ t("activityInbox.attention") }}
          </h3>
          <p v-if="!hasAttention" class="m-0 py-2 text-[12px] text-[var(--color-dim)]">
            {{ t("activityInbox.noAttention") }}
          </p>
          <button
            v-for="session in needsAction"
            :key="`action:${session.id}`"
            type="button"
            class="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--color-side-chip)] px-3 py-2 text-left hover:bg-[var(--color-side-hover)]"
            @click="openSession(session.id)"
          >
            <CircleAlert class="size-4 flex-none text-[var(--color-accent)]" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt-strong)]">{{ session.title }}</span>
            <span class="text-[10px] text-[var(--color-accent)]">{{ statusText(session) }}</span>
            <ArrowRight class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </button>
          <button
            v-for="session in unseenResults"
            :key="`result:${session.id}`"
            type="button"
            class="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--color-side-chip)] px-3 py-2 text-left hover:bg-[var(--color-side-hover)]"
            @click="openSession(session.id)"
          >
            <span class="size-1.5 flex-none rounded-full" :class="sessionStatus.byId[session.id] === 'error' ? 'bg-[var(--color-del)]' : 'bg-[var(--color-ok)]'" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt-strong)]">{{ session.title }}</span>
            <span class="text-[10px] text-[var(--color-mut)]">{{ statusText(session) }}</span>
            <ArrowRight class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </button>
          <button
            v-for="session in blockedGoals"
            :key="`blocked:${session.id}`"
            type="button"
            class="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--color-side-chip)] px-3 py-2 text-left hover:bg-[var(--color-side-hover)]"
            @click="openSession(session.id)"
          >
            <CircleAlert class="size-4 flex-none text-[var(--color-accent)]" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt-strong)]">{{ session.goal?.text }}</span>
            <span class="text-[10px] text-[var(--color-accent)]">{{ goalStatusText(session) }}</span>
            <ArrowRight class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </button>
        </section>

        <section v-if="running.length" class="flex flex-col gap-1.5" :aria-label="t('activityInbox.running')">
          <h3 class="m-0 text-[12px] font-semibold text-[var(--color-txt-strong)]">{{ t("activityInbox.running") }}</h3>
          <button
            v-for="session in running"
            :key="session.id"
            type="button"
            class="flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--color-side-hover)]"
            @click="openSession(session.id)"
          >
            <LoaderCircle class="size-3.5 flex-none animate-spin text-[var(--color-accent)]" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">{{ session.title }}</span>
            <span class="text-[10px] text-[var(--color-dim)]">{{ workspaceName(session) }}</span>
          </button>
        </section>

        <section v-if="otherGoals.length" class="flex flex-col gap-1.5" :aria-label="t('activityInbox.goals')">
          <h3 class="m-0 text-[12px] font-semibold text-[var(--color-txt-strong)]">{{ t("activityInbox.goals") }}</h3>
          <div v-for="session in otherGoals" :key="session.id" class="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="m-0 truncate text-[12px] text-[var(--color-txt-strong)]">{{ session.goal?.text }}</p>
              <p class="m-0 mt-0.5 truncate text-[10px] text-[var(--color-dim)]">
                {{ session.title }} · {{ goalStatusText(session) }}
                <span v-if="session.goal?.status === 'active' && session.goal.reminderIntervalHours">
                  · {{ reminderLabel(session.goal.reminderIntervalHours) }}
                </span>
              </p>
            </div>
            <Button
              v-if="session.goal?.status === 'active' && sessionStatus.byId[session.id] !== 'running'"
              variant="ghost" size="sm" class="flex-none"
              @click="continueGoal(session)"
            >
              <Play class="size-3" aria-hidden="true" />{{ t("activityInbox.continue") }}
            </Button>
            <Button v-else variant="ghost" size="sm" class="flex-none" @click="openSession(session.id)">
              {{ t("activityInbox.open") }}
            </Button>
          </div>
        </section>

        <section class="flex flex-col gap-1.5" :aria-label="t('activityInbox.scheduled')">
          <h3 class="m-0 text-[12px] font-semibold text-[var(--color-txt-strong)]">{{ t("activityInbox.scheduled") }}</h3>
          <p v-if="!scheduledResults.length && !scheduler.loaded" class="m-0 py-2 text-[12px] text-[var(--color-dim)]">
            {{ t("activityInbox.loading") }}
          </p>
          <p v-else-if="!scheduledResults.length" class="m-0 py-2 text-[12px] text-[var(--color-dim)]">
            {{ t("activityInbox.noScheduled") }}
          </p>
          <div v-for="task in scheduledResults" :key="task.id" class="flex items-start gap-2 rounded-lg border border-[var(--color-line-soft)] px-3 py-2">
            <span v-if="inbox.isScheduledUnread(task)" class="mt-1.5 size-1.5 flex-none rounded-full bg-[var(--color-accent)]" :aria-label="t('activityInbox.unread')" />
            <div class="min-w-0 flex-1">
              <p class="m-0 truncate text-[12px] font-medium text-[var(--color-txt-strong)]">{{ task.name }}</p>
              <p class="m-0 mt-0.5 line-clamp-2 text-[11px]" :class="task.lastRunOk === false ? 'text-[var(--color-danger-fg)]' : 'text-[var(--color-mut)]'">
                {{ task.lastResult || t("activityInbox.noResult") }}
              </p>
              <p class="m-0 mt-1 text-[10px] text-[var(--color-dim)]">{{ task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : '' }}</p>
            </div>
            <Button v-if="task.lastSessionId" variant="ghost" size="sm" class="flex-none" @click="openScheduledResult(task)">
              {{ t("activityInbox.open") }}
            </Button>
            <Button v-else-if="inbox.isScheduledUnread(task)" variant="ghost" size="sm" class="flex-none" @click="inbox.markScheduledSeen(task)">
              {{ t("activityInbox.markRead") }}
            </Button>
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
