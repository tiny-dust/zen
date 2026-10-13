<script setup lang="ts">
import { CalendarClock, Loader2, Pencil, Play, Plus, Trash2, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useSchedulerStore } from "@/stores/scheduler";
import { useWorkspaceStore } from "@/stores/workspace";

import type { ScheduledTask, ScheduledTaskInput } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const schedulerStore = useSchedulerStore();
const workspaceStore = useWorkspaceStore();
const { tasks } = storeToRefs(schedulerStore);

const { t } = useI18n();

// 弹窗浮在内嵌浏览器之上时会被原生视图盖住，打开期间压制浏览器视图
useBrowserOverlayGuard(open);

/** 新建/编辑共用表单；editingId 为 null 表示「新建」 */
const editingId = ref<string | null>(null);
const formError = ref("");

const form = reactive({
  name: "",
  prompt: "",
  kind: "interval" as "interval" | "daily",
  intervalMinutes: "30",
  dailyTime: "08:30",
  workspacePath: "",
  enabled: true,
});

/** 可选目标工作区：有目录的项目工作区 + 公共区（空串） */
const workspaceOptions = computed(() => {
  const groups = workspaceStore.groups.filter(
    (group) => !group.archived && group.kind === "workspace" && group.path,
  );
  return [
    { path: "", label: t("scheduler.workspaceCommon") },
    ...groups.map((group) => ({ path: group.path ?? "", label: group.name })),
  ];
});

watch(open, (value) => {
  if (value) {
    void schedulerStore.load();
  }
});

function resetForm() {
  editingId.value = null;
  formError.value = "";
  form.name = "";
  form.prompt = "";
  form.kind = "interval";
  form.intervalMinutes = "30";
  form.dailyTime = "08:30";
  form.workspacePath = "";
  form.enabled = true;
}

function startEdit(task: ScheduledTask) {
  editingId.value = task.id;
  formError.value = "";
  form.name = task.name;
  form.prompt = task.prompt;
  form.kind = task.schedule.kind;
  form.intervalMinutes = String(task.schedule.intervalMinutes ?? 30);
  form.dailyTime = task.schedule.dailyTime ?? "08:30";
  form.workspacePath = task.workspacePath ?? "";
  form.enabled = task.enabled;
}

function cancelEdit() {
  resetForm();
}

/** 表单 → ScheduledTaskInput；校验失败返回错误文案 */
function buildInput(): { input: ScheduledTaskInput } | { error: string } {
  const name = form.name.trim();
  if (!name) {
    return { error: t("scheduler.errNameRequired") };
  }
  const prompt = form.prompt.trim();
  if (!prompt) {
    return { error: t("scheduler.errPromptRequired") };
  }
  if (form.kind === "interval") {
    const minutes = Number(form.intervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 1) {
      return { error: t("scheduler.errInterval") };
    }
    return {
      input: {
        name,
        prompt,
        schedule: { kind: "interval", intervalMinutes: minutes },
        enabled: form.enabled,
        workspacePath: form.workspacePath || null,
      },
    };
  }
  if (!/^\d{1,2}:\d{1,2}$/.test(form.dailyTime.trim())) {
    return { error: t("scheduler.errDailyTime") };
  }
  return {
    input: {
      name,
      prompt,
      schedule: { kind: "daily", dailyTime: form.dailyTime.trim() },
      enabled: form.enabled,
      workspacePath: form.workspacePath || null,
    },
  };
}

async function submitForm() {
  const parsed = buildInput();
  if ("error" in parsed) {
    formError.value = parsed.error;
    return;
  }
  const result = editingId.value
    ? await schedulerStore.update(editingId.value, parsed.input)
    : await schedulerStore.create(parsed.input);
  // update 找不到任务返回 null（任务刚被删）：按取消编辑处理
  if (!result) {
    resetForm();
    return;
  }
  if ("error" in result && result.error) {
    formError.value = result.error;
    return;
  }
  resetForm();
}

/** 删除确认（任务落库，删除不可恢复） */
const pendingDelete = ref<ScheduledTask | null>(null);

async function onDeleteTask() {
  const task = pendingDelete.value;
  pendingDelete.value = null;
  if (!task) {
    return;
  }
  if (editingId.value === task.id) {
    resetForm();
  }
  await schedulerStore.remove(task.id);
}

const runErrors = ref<Record<string, string>>({});

async function onRunNow(task: ScheduledTask) {
  const result = await schedulerStore.runNow(task.id);
  if (!result.ok) {
    runErrors.value[task.id] = t("scheduler.runFailed", { error: result.error ?? "" });
  } else {
    delete runErrors.value[task.id];
  }
}

function scheduleLabel(task: ScheduledTask): string {
  if (task.schedule.kind === "interval") {
    return t("scheduler.everyMinutes", { n: task.schedule.intervalMinutes ?? 0 });
  }
  return t("scheduler.dailyAt", { time: task.schedule.dailyTime ?? "" });
}

function workspaceLabel(task: ScheduledTask): string {
  if (!task.workspacePath) {
    return t("scheduler.workspaceCommon");
  }
  const group = workspaceStore.groups.find((item) => item.path === task.workspacePath);
  return group?.name ?? task.workspacePath;
}

function lastRunLabel(task: ScheduledTask): string {
  if (!task.lastRunAt) {
    return t("scheduler.never");
  }
  return new Date(task.lastRunAt).toLocaleString();
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-large-panel="true"
      class="flex h-[min(86vh,760px)] w-[min(760px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
    >
      <DialogHeader class="flex-none border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <DialogTitle class="text-[15px]">{{ t("scheduler.title") }}</DialogTitle>
        <DialogDescription class="text-[12px]">{{ t("scheduler.desc") }}</DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <!-- 新建 / 编辑表单 -->
        <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3.5">
          <div class="text-[12px] font-medium text-[var(--color-txt-strong)]">
            {{ editingId ? t("scheduler.editTask") : t("scheduler.add") }}
          </div>
          <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(150px,200px)]">
            <Input
              v-model="form.name"
              class="h-8 text-[12px]"
              :placeholder="t('scheduler.namePlaceholder')"
              :aria-label="t('scheduler.name')"
            />
            <Select v-model="form.workspacePath">
              <SelectTrigger class="h-8 text-[12px]" :aria-label="t('scheduler.workspace')">
                <SelectValue :placeholder="t('scheduler.workspace')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in workspaceOptions" :key="item.path || 'common'" :value="item.path">
                  {{ item.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            v-model="form.prompt"
            class="min-h-[60px] text-[12px]"
            :placeholder="t('scheduler.promptPlaceholder')"
            :aria-label="t('scheduler.prompt')"
          />
          <div class="grid gap-2 md:grid-cols-[minmax(120px,160px)_minmax(0,1fr)]">
            <Select v-model="form.kind">
              <SelectTrigger class="h-8 text-[12px]" :aria-label="t('scheduler.schedule')">
                <SelectValue :placeholder="t('scheduler.schedule')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">{{ t("scheduler.scheduleInterval") }}</SelectItem>
                <SelectItem value="daily">{{ t("scheduler.scheduleDaily") }}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              v-if="form.kind === 'interval'"
              v-model="form.intervalMinutes"
              type="number"
              min="1"
              step="1"
              class="h-8 text-[12px]"
              :placeholder="t('scheduler.intervalMinutes')"
              :aria-label="t('scheduler.intervalMinutes')"
            />
            <Input
              v-else
              v-model="form.dailyTime"
              class="h-8 text-[12px]"
              :placeholder="t('scheduler.dailyTimePlaceholder')"
              :aria-label="t('scheduler.dailyTime')"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-[12px] text-[var(--color-mut)]">
              <Switch v-model="form.enabled" size="sm" :aria-label="t('scheduler.enabled')" />
              {{ t("scheduler.enabled") }}
            </label>
            <Button size="sm" @click="submitForm">
              <Plus v-if="!editingId" class="size-3.5" />{{ editingId ? t("common.save") : t("scheduler.add") }}
            </Button>
            <Button v-if="editingId" variant="ghost" size="sm" @click="cancelEdit">
              <X class="size-3.5" />{{ t("common.cancel") }}
            </Button>
            <span v-if="formError" class="text-[11px] text-[var(--color-danger-fg)]">{{ formError }}</span>
          </div>
        </div>

        <!-- 任务列表 -->
        <div class="min-w-0">
          <div class="mb-2 text-[12px] font-medium text-[var(--color-mut)]">
            {{ t("scheduler.taskCount", { n: tasks.length }) }}
          </div>
          <div v-if="tasks.length" class="flex flex-col gap-1.5">
            <div
              v-for="task in tasks"
              :key="task.id"
              class="flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ task.name }}</span>
                  <Badge variant="secondary" class="text-[10px]">
                    <CalendarClock class="mr-0.5 size-3" aria-hidden="true" />{{ scheduleLabel(task) }}
                  </Badge>
                  <Badge v-if="task.lastRunOk !== null" :variant="task.lastRunOk ? 'secondary' : 'destructive'"
                    class="text-[10px]">
                    {{ task.lastRunOk ? t("scheduler.ok") : t("scheduler.failed") }}
                  </Badge>
                  <span class="text-[10px] text-[var(--color-dim)]">{{ workspaceLabel(task) }}</span>
                </div>
                <p class="m-0 mt-0.5 line-clamp-2 text-[11px] text-[var(--color-mut)]" :title="task.prompt">
                  {{ task.prompt }}
                </p>
                <p class="m-0 mt-0.5 text-[10px] text-[var(--color-dim)]">
                  {{ t("scheduler.lastRun") }}：{{ lastRunLabel(task) }}
                </p>
                <p
                  v-if="task.lastResult"
                  class="m-0 mt-0.5 line-clamp-2 text-[11px]"
                  :class="task.lastRunOk === false ? 'text-[var(--color-danger-fg)]' : 'text-[var(--color-dim)]'"
                  :title="task.lastResult"
                >
                  {{ t("scheduler.lastResult") }}：{{ task.lastResult }}
                </p>
                <p v-if="runErrors[task.id]" class="m-0 mt-0.5 text-[11px] text-[var(--color-danger-fg)]">
                  {{ runErrors[task.id] }}
                </p>
              </div>
              <div class="flex flex-none items-center gap-1">
                <Switch
                  :model-value="task.enabled"
                  size="sm"
                  :aria-label="t('scheduler.enabled')"
                  @update:model-value="(value: boolean) => schedulerStore.toggle(task.id, value === true)"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="schedulerStore.isRunning(task.id)"
                  :aria-label="t('scheduler.runNow')"
                  :title="t('scheduler.runNow')"
                  @click="onRunNow(task)"
                >
                  <Loader2 v-if="schedulerStore.isRunning(task.id)" class="size-3.5 animate-spin" />
                  <Play v-else class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('scheduler.editTask')"
                  :title="t('scheduler.editTask')"
                  @click="startEdit(task)"
                >
                  <Pencil class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-[var(--color-del)] hover:text-[var(--color-danger-fg)] hover:bg-transparent!"
                  :aria-label="t('scheduler.remove')"
                  :title="t('scheduler.remove')"
                  @click="pendingDelete = task"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <p v-else class="m-0 text-[12px] text-[var(--color-dim)]">{{ t("scheduler.noTasks") }}</p>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <!-- 删除确认（任务落库，不可恢复） -->
  <ConfirmDialog
    :open="!!pendingDelete"
    :title="t('scheduler.removeTitle', { name: pendingDelete?.name ?? '' })"
    :description="t('scheduler.removeDesc')"
    :confirm-label="t('scheduler.remove')"
    :cancel-label="t('common.cancel')"
    @update:open="pendingDelete = null"
    @confirm="onDeleteTask"
  />
</template>
