<script setup lang="ts">
import {
  IconAlertTriangle as AlertTriangle,
  IconArchive as Archive,
  IconArchiveOff as ArchiveOff,
  IconArrowBackUp as SendBack,
  IconCheck as Check,
  IconExternalLink as ExternalLink,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconShield as Shield,
  IconX as X,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  attemptStatusLabel,
  canArchive,
  executorLabel,
  fmtDuration,
  fmtTime,
  grantLevelLabel,
  stageOf,
  statusLabel,
  toolLabel,
  triggerLabel,
} from "@/lib/tasks";
import { openSessionById } from "@/lib/open-session";
import { useTasksStore } from "@/stores/tasks";

import type { Task } from "@zen/shared";

/**
 * 任务详情抽屉（右侧 400px，随内容区排布、不盖住列表滚动）。
 * 数据与操作都走 tasks store：宿主只负责「选中/关闭」，详情内部的动作直接落库。
 */
const emit = defineEmits<{
  close: [];
}>();

const store = useTasksStore();
const { selected, selectedAttempts, selectedJournal, selectedQueue } = storeToRefs(store);
const { t } = useI18n();

const tab = ref("progress");
const actionError = ref("");
const reply = ref("");
const rejectOpen = ref(false);
const rejectFeedback = ref("");
const saving = ref(false);
const saved = ref(false);
const revokeOpen = ref(false);

const task = computed(() => selected.value);

const drafts = reactive({ title: "", goal: "", doneWhen: "" });

/** 换任务才回到「进度与对话」；落库（updatedAt 变化）只同步草稿，不打断当前 tab */
watch(
  () => task.value?.id,
  () => {
    reply.value = "";
    rejectFeedback.value = "";
    rejectOpen.value = false;
    actionError.value = "";
    tab.value = "progress";
  },
  { immediate: true },
);

watch(
  () => [task.value?.id, task.value?.updatedAt] as const,
  () => {
    const current = task.value;
    if (!current) {
      return;
    }
    drafts.title = current.title;
    drafts.goal = current.goal;
    drafts.doneWhen = current.executor.kind === "agent" ? (current.executor.doneWhen ?? "") : "";
  },
  { immediate: true },
);

const banner = computed<"waiting" | "accept" | "failed" | "idle" | "running" | null>(() => {
  const status = task.value?.status;
  if (!status) {
    return null;
  }
  if (status === "waiting_user") {
    return "waiting";
  }
  if (status === "awaiting_accept") {
    return "accept";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "idle" || status === "queued") {
    return "idle";
  }
  return status === "running" || status === "needs_reconcile" ? "running" : null;
});

const waitHint = computed(() => {
  const wait = task.value?.wait;
  if (!wait) {
    return "";
  }
  const key = wait.kind === "input" ? "tasks.detail.waitInput" : wait.kind === "approval" ? "tasks.detail.waitApproval" : "tasks.detail.waitGrant";
  return t(key, { detail: wait.detail ?? "" });
});

const latestSummary = computed(() => selectedAttempts.value[0]?.result?.summary ?? "");

const failureText = computed(
  () => task.value?.lastError?.message ?? selectedAttempts.value[0]?.error?.message ?? "",
);

const grant = computed(() => task.value?.grant ?? null);
const grantRevoked = computed(() => Boolean(grant.value?.revokedAt));

const stage = computed(() => (task.value ? stageOf(task.value.status) : "todo"));

const acceptance = computed<Task["acceptance"]>({
  get: () => task.value?.acceptance ?? "user",
  set: (value) => void save({ acceptance: value }),
});

const priority = computed<Task["priority"]>({
  get: () => task.value?.priority ?? "medium",
  set: (value) => void save({ priority: value }),
});

const category = computed<Task["category"]>({
  get: () => task.value?.category ?? "coding",
  set: (value) => void save({ category: value }),
});

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const CATEGORIES = ["coding", "review", "research", "writing", "monitor", "chore"] as const;

async function act(run: () => Promise<string | null>): Promise<void> {
  actionError.value = "";
  const error = await run();
  if (error) {
    actionError.value = error;
  }
}

function runNow(): void {
  const id = task.value?.id;
  if (id) {
    void act(() => store.runNow(id));
  }
}

function pause(): void {
  const id = task.value?.id;
  if (id) {
    void act(() => store.pause(id));
  }
}

function cancel(): void {
  const id = task.value?.id;
  if (id) {
    void act(() => store.cancel(id));
  }
}

function ack(): void {
  const id = task.value?.id;
  if (id) {
    void act(() => store.ack(id));
  }
}

function accept(): void {
  const id = task.value?.id;
  if (id) {
    void act(() => store.accept(id));
  }
}

function submitReply(): void {
  const id = task.value?.id;
  if (!id) {
    return;
  }
  void act(async () => {
    const error = await store.decide(id, true, reply.value.trim() || undefined);
    if (!error) {
      reply.value = "";
    }
    return error;
  });
}

function giveUp(): void {
  const id = task.value?.id;
  if (id) {
    void act(() => store.decide(id, false));
  }
}

function submitReject(): void {
  const id = task.value?.id;
  if (!id) {
    return;
  }
  void act(async () => {
    const error = await store.reject(id, rejectFeedback.value.trim());
    if (!error) {
      rejectOpen.value = false;
      rejectFeedback.value = "";
    }
    return error;
  });
}

function archive(): void {
  const id = task.value?.id;
  if (!id) {
    return;
  }
  void act(async () => (task.value?.archivedAt ? store.unarchive(id) : store.archive(id)));
}

async function save(patch: Parameters<typeof store.update>[1]): Promise<void> {
  const id = task.value?.id;
  if (!id) {
    return;
  }
  saving.value = true;
  actionError.value = "";
  const error = await store.update(id, patch);
  saving.value = false;
  if (error) {
    actionError.value = error;
    return;
  }
  saved.value = true;
  window.setTimeout(() => {
    saved.value = false;
  }, 1600);
}

function saveRules(): void {
  const current = task.value;
  if (!current) {
    return;
  }
  const patch: Parameters<typeof store.update>[1] = {
    title: drafts.title.trim(),
    goal: drafts.goal.trim(),
    acceptance: current.acceptance,
    priority: current.priority,
    category: current.category,
  };
  if (current.executor.kind === "agent") {
    patch.executor = { ...current.executor, doneWhen: drafts.doneWhen.trim() };
  }
  void save(patch);
}

/** 撤销授权：接口没有单独的 revoke，按 TaskInput.grant（Omit<TaskGrant,"grantedAt">）传已撤销的 grant */
function revokeGrant(): void {
  const current = task.value;
  if (!current) {
    return;
  }
  const { level, paths, expiresAt } = current.grant;
  revokeOpen.value = false;
  void save({ grant: { level, paths, expiresAt, revokedAt: Date.now() } });
}

async function openSession(sessionId: string): Promise<void> {
  const opened = await openSessionById(sessionId);
  if (!opened) {
    actionError.value = t("tasks.detail.sessionMissing");
  }
}

function durationOf(startedAt: number, endedAt?: number): string {
  return fmtDuration((endedAt ?? Date.now()) - startedAt);
}

const canArchiveNow = computed(() => (task.value ? canArchive(task.value) : false));
</script>

<template>
  <aside
    v-if="task"
    class="flex h-full w-[400px] flex-none flex-col border-l border-[var(--color-line)] bg-[var(--color-panel)]"
    :aria-label="t('tasks.detail.tabProgress')"
    data-testid="task-detail"
  >
    <header class="flex flex-none flex-col gap-1.5 border-b border-[var(--color-line-soft)] px-4 py-3">
      <div class="flex min-w-0 items-start gap-1.5">
        <div class="min-w-0 flex-1">
          <h3 class="m-0 text-[14px] font-semibold break-words text-[var(--color-txt-strong)]">{{ task.title }}</h3>
          <div class="mt-1">
            <Badge v-if="task.archivedAt" variant="outline" class="text-[10px]">{{ t("tasks.archived") }}</Badge>
            <Badge v-else variant="secondary" class="text-[10px]" :data-testid="`task-detail-status-${stage}`">
              {{ t(statusLabel(task.status).key) }}
            </Badge>
          </div>
        </div>
        <Button
          v-if="task.archivedAt || canArchiveNow"
          variant="ghost"
          size="icon-xs"
          class="flex-none"
          :title="task.archivedAt ? t('tasks.detail.unarchive') : t('tasks.detail.archive')"
          :aria-label="task.archivedAt ? t('tasks.detail.unarchive') : t('tasks.detail.archive')"
          @click="archive"
        >
          <ArchiveOff v-if="task.archivedAt" class="size-3.5" aria-hidden="true" />
          <Archive v-else class="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="flex-none"
          :title="t('tasks.detail.close')"
          :aria-label="t('tasks.detail.close')"
          data-testid="task-detail-close"
          @click="emit('close')"
        >
          <X class="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt class="text-[var(--color-mut)]">{{ t("tasks.detail.metaExecutor") }}</dt>
        <dd class="m-0 truncate text-[var(--color-txt)]">{{ t(executorLabel(task.executor).key) }}</dd>
        <dt class="text-[var(--color-mut)]">{{ t("tasks.detail.metaTrigger") }}</dt>
        <dd class="m-0 truncate text-[var(--color-txt)]">
          {{ t(triggerLabel(task.trigger).key, triggerLabel(task.trigger).params ?? {}) }}
        </dd>
      </dl>
      <p v-if="selectedQueue" class="m-0 text-[11px] text-[var(--color-mut)]">
        {{ t("tasks.detail.queue", {
          position: selectedQueue.position,
          active: selectedQueue.activeCount,
          max: selectedQueue.maxConcurrent,
        }) }}
        <span v-if="selectedQueue.retryAt">{{ t("tasks.detail.retryAt", { time: fmtTime(selectedQueue.retryAt) }) }}</span>
      </p>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <!-- 行动横幅：按状态只给当下该做的一件事 -->
      <section v-if="banner" class="flex flex-none flex-col gap-2 border-b border-[var(--color-line-soft)] px-4 py-3">
        <template v-if="banner === 'waiting'">
          <div class="flex items-center gap-1.5 text-[12px] font-medium text-[var(--agent-approval)]">
            <AlertTriangle class="size-3.5" aria-hidden="true" />
            {{ t("tasks.banner.waitingTitle") }}
          </div>
          <p v-if="waitHint" class="m-0 text-[11px] text-[var(--color-mut)]">{{ waitHint }}</p>
          <Textarea v-model="reply" class="min-h-16 text-[12px]" :placeholder="t('tasks.banner.waitingPlaceholder')" />
          <div class="flex items-center gap-1.5">
            <Button size="sm" data-testid="task-reply-submit" @click="submitReply">{{ t("tasks.banner.submit") }}</Button>
            <Button variant="ghost" size="sm" @click="giveUp">{{ t("tasks.banner.giveUp") }}</Button>
          </div>
        </template>

        <template v-else-if="banner === 'accept'">
          <div class="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-txt-strong)]">
            <Check class="size-3.5 text-[var(--color-ok)]" aria-hidden="true" />
            {{ t("tasks.banner.acceptTitle") }}
          </div>
          <p class="m-0 text-[11px] leading-normal text-[var(--color-mut)]">{{ t("tasks.banner.acceptDesc") }}</p>
          <p v-if="latestSummary" class="m-0 line-clamp-3 rounded-[var(--radius-sm)] bg-[var(--color-sunken)] p-2 text-[11px] text-[var(--color-txt)]">
            {{ latestSummary }}
          </p>
          <div v-if="!rejectOpen" class="flex items-center gap-1.5">
            <Button size="sm" data-testid="task-accept" @click="accept">{{ t("tasks.banner.accept") }}</Button>
            <Button variant="outline" size="sm" @click="rejectOpen = true">
              <SendBack class="size-3.5" aria-hidden="true" />{{ t("tasks.banner.reject") }}
            </Button>
          </div>
          <template v-else>
            <Textarea
              v-model="rejectFeedback"
              class="min-h-16 text-[12px]"
              :placeholder="t('tasks.banner.rejectPlaceholder')"
            />
            <div class="flex items-center gap-1.5">
              <Button variant="destructive" size="sm" @click="submitReject">{{ t("tasks.banner.rejectSubmit") }}</Button>
              <Button variant="ghost" size="sm" @click="rejectOpen = false">{{ t("tasks.form.cancel") }}</Button>
            </div>
          </template>
        </template>

        <template v-else-if="banner === 'failed'">
          <div class="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-err)]">
            <AlertTriangle class="size-3.5" aria-hidden="true" />
            {{ t("tasks.banner.failedTitle") }}
          </div>
          <p v-if="failureText" class="m-0 text-[11px] break-words text-[var(--color-mut)]">{{ failureText }}</p>
          <div class="flex items-center gap-1.5">
            <Button v-if="!task.ackedAt" variant="outline" size="sm" @click="ack">{{ t("tasks.banner.ack") }}</Button>
            <Button size="sm" @click="runNow">{{ t("tasks.banner.run") }}</Button>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-txt-strong)]">
            <Play class="size-3.5" aria-hidden="true" />
            {{ t("tasks.banner.idleTitle") }}
          </div>
          <div class="flex items-center gap-1.5">
            <Button v-if="banner === 'idle' || task.status === 'needs_reconcile'" size="sm" @click="runNow">
              {{ t("tasks.banner.run") }}
            </Button>
            <Button variant="outline" size="sm" @click="pause">
              <Pause class="size-3.5" aria-hidden="true" />{{ t("tasks.banner.pause") }}
            </Button>
            <Button v-if="task.status === 'running'" variant="ghost" size="sm" @click="cancel">
              {{ t("tasks.banner.cancel") }}
            </Button>
          </div>
        </template>
      </section>

      <p v-if="actionError" class="m-0 flex-none bg-[var(--color-danger-bg)] px-4 py-2 text-[11px] text-[var(--color-danger-fg)]">
        {{ t("tasks.error", { error: actionError }) }}
      </p>

      <Tabs v-model="tab" class="flex min-h-0 flex-1 flex-col">
        <TabsList class="mx-4 mt-2 flex-none">
          <TabsTrigger value="progress" class="text-[12px]">{{ t("tasks.detail.tabProgress") }}</TabsTrigger>
          <TabsTrigger value="rules" class="text-[12px]">{{ t("tasks.detail.tabRules") }}</TabsTrigger>
        </TabsList>

        <TabsContent value="progress" class="flex flex-col gap-3 px-4 py-3">
          <section>
            <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.detail.attempts") }}</h4>
            <p v-if="!selectedAttempts.length" class="m-0 text-[11px] text-[var(--color-dim)]">
              {{ t("tasks.detail.noAttempts") }}
            </p>
            <ul v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
              <li
                v-for="attempt in selectedAttempts"
                :key="attempt.id"
                class="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1.5"
              >
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <Badge variant="outline" class="text-[10px]">{{ t(attemptStatusLabel(attempt.status).key) }}</Badge>
                  <span class="text-[var(--color-mut)]">{{ fmtTime(attempt.startedAt) }}</span>
                  <span class="text-[var(--color-dim)]">{{ t("tasks.detail.duration", { value: durationOf(attempt.startedAt, attempt.endedAt) }) }}</span>
                  <Button
                    v-if="attempt.sessionId"
                    variant="link"
                    size="xs"
                    class="ml-auto h-auto px-0 text-[11px]"
                    @click="openSession(attempt.sessionId)"
                  >
                    {{ t("tasks.detail.openSession") }}<ExternalLink class="size-3" aria-hidden="true" />
                  </Button>
                </div>
                <p v-if="attempt.result?.summary" class="m-0 line-clamp-4 text-[11px] text-[var(--color-txt)]">
                  {{ attempt.result.summary }}
                </p>
                <p v-if="attempt.error" class="m-0 text-[11px] break-words text-[var(--color-err)]">
                  {{ attempt.error.message }}
                </p>
              </li>
            </ul>
          </section>

          <Separator />

          <section>
            <h4 class="m-0 mb-1.5 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.detail.journal") }}</h4>
            <p v-if="!selectedJournal.length" class="m-0 text-[11px] text-[var(--color-dim)]">{{ t("tasks.detail.noJournal") }}</p>
            <ul v-else class="m-0 flex list-none flex-col gap-1 p-0">
              <li
                v-for="entry in selectedJournal"
                :key="entry.seq"
                class="flex min-w-0 items-baseline gap-2 text-[11px] text-[var(--color-mut)]"
              >
                <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">{{ fmtTime(entry.at) }}</span>
                <span class="min-w-0 break-words text-[var(--color-txt)]">
                  <template v-if="entry.from && entry.to">
                    {{ t(statusLabel(entry.from).key) }} → {{ t(statusLabel(entry.to).key) }}
                  </template>
                  <template v-else>{{ entry.summary ?? entry.type }}</template>
                </span>
              </li>
            </ul>
          </section>
        </TabsContent>

        <TabsContent value="rules" class="flex flex-col gap-3 px-4 py-3">
          <section class="flex flex-col gap-1.5">
            <h4 class="m-0 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.detail.rulesTitle") }}</h4>
            <Input v-model="drafts.title" class="h-8 text-[12px]" :aria-label="t('tasks.detail.titleField')" />
            <Textarea v-model="drafts.goal" class="min-h-24 text-[12px]" :aria-label="t('tasks.detail.goal')" />
            <template v-if="task.executor.kind === 'agent'">
              <Textarea
                v-model="drafts.doneWhen"
                class="min-h-16 text-[12px]"
                :placeholder="t('tasks.detail.doneWhenPlaceholder')"
                :aria-label="t('tasks.detail.doneWhen')"
              />
            </template>

            <div class="grid grid-cols-3 gap-1.5">
              <Select v-model="acceptance">
                <SelectTrigger size="sm" class="w-full text-[11px]" :aria-label="t('tasks.detail.acceptance')">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{{ t("tasks.detail.acceptanceAuto") }}</SelectItem>
                  <SelectItem value="user">{{ t("tasks.detail.acceptanceUser") }}</SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="priority">
                <SelectTrigger size="sm" class="w-full text-[11px]" :aria-label="t('tasks.priority.label')">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="item in PRIORITIES" :key="item" :value="item">
                    {{ t(`tasks.priority.${item}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="category">
                <SelectTrigger size="sm" class="w-full text-[11px]" :aria-label="t('tasks.category.label')">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="item in CATEGORIES" :key="item" :value="item">
                    {{ t(`tasks.category.${item}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center gap-2">
              <Button size="sm" :disabled="saving" @click="saveRules">{{ t("tasks.detail.save") }}</Button>
              <span v-if="saved" class="text-[11px] text-[var(--color-ok)]">{{ t("tasks.detail.saved") }}</span>
            </div>
          </section>

          <Separator />

          <section class="flex flex-col gap-1.5">
            <h4 class="m-0 flex items-center gap-1 text-[11px] font-medium text-[var(--color-mut)]">
              <Shield class="size-3.5" aria-hidden="true" />{{ t("tasks.grant.title") }}
            </h4>
            <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-txt)]">
              <Badge variant="outline" class="text-[10px]">{{ t(grantLevelLabel(grant?.level ?? 0).key) }}</Badge>
              <template v-if="task.executor.kind === 'agent'">
                <span
                  v-for="tool in task.executor.tools"
                  :key="tool"
                  class="rounded-[var(--radius-xs)] bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-chip-text)]"
                >{{ t(toolLabel(tool).key) }}</span>
              </template>
              <span v-if="grantRevoked" class="text-[var(--color-err)]">{{ t("tasks.grant.revoked") }}</span>
              <span v-else-if="grant?.expiresAt" class="text-[var(--color-mut)]">
                {{ t("tasks.grant.expires", { time: fmtTime(grant.expiresAt) }) }}
              </span>
              <span v-else class="text-[var(--color-mut)]">{{ t("tasks.grant.noExpiry") }}</span>
            </div>
            <div v-if="grant?.paths.length" class="flex flex-col gap-0.5">
              <span class="text-[10px] text-[var(--color-mut)]">{{ t("tasks.grant.paths") }}</span>
              <code
                v-for="path in grant.paths"
                :key="path"
                class="block truncate rounded-[var(--radius-xs)] bg-[var(--color-sunken)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-txt)]"
              >{{ path }}</code>
            </div>
            <span v-else class="text-[11px] text-[var(--color-dim)]">{{ t("tasks.grant.noPaths") }}</span>
            <Button
              v-if="!grantRevoked"
              variant="outline"
              size="xs"
              class="w-fit"
              data-testid="task-revoke-grant"
              @click="revokeOpen = true"
            >
              {{ t("tasks.grant.revoke") }}
            </Button>
          </section>

          <p class="m-0 text-[10px] leading-normal text-[var(--color-dim)]">
            {{ task.archivedAt ? t("tasks.detail.archivedHint") : t("tasks.detail.autoArchiveHint") }}
          </p>
        </TabsContent>
      </Tabs>
    </div>

    <ConfirmDialog
      :open="revokeOpen"
      :title="t('tasks.grant.revokeTitle')"
      :description="t('tasks.grant.revokeDesc')"
      :confirm-label="t('tasks.grant.revoke')"
      @update:open="(next) => (revokeOpen = next)"
      @confirm="revokeGrant"
    />
  </aside>
</template>
