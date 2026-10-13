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

import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskSchedule, ScheduleUnit } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const schedulerStore = useSchedulerStore();
const workspaceStore = useWorkspaceStore();
const { tasks } = storeToRefs(schedulerStore);

const { t } = useI18n();

// 弹窗浮在内嵌浏览器之上时会被原生视图盖住，打开期间压制浏览器视图
useBrowserOverlayGuard(open);

/**
 * 「公共区」选项的哨兵值：reka-ui 禁止 SelectItem 用空字符串 value
 * （会抛异常打断弹窗渲染循环，导致弹窗内所有交互失效），
 * 表单侧一律用哨兵，提交/回显时与真实 path（null=公共区）互转。
 */
const COMMON_WORKSPACE = "__common__";

function toFormWorkspace(path: string | null | undefined): string {
  return path || COMMON_WORKSPACE;
}

function fromFormWorkspace(value: string): string | null {
  return value === COMMON_WORKSPACE ? null : value;
}

/** interval 单位 → 文案键（下拉与列表标签共用） */
const UNIT_KEYS: Record<ScheduleUnit, string> = {
  second: "scheduler.unitSecond",
  minute: "scheduler.unitMinute",
  hour: "scheduler.unitHour",
  day: "scheduler.unitDay",
  month: "scheduler.unitMonth",
};

const SCHEDULE_KINDS = ["interval", "daily", "monthly", "once", "window"] as const;
type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
const KIND_KEYS: Record<ScheduleKind, string> = {
  interval: "scheduler.scheduleInterval",
  daily: "scheduler.scheduleDaily",
  monthly: "scheduler.scheduleMonthly",
  once: "scheduler.scheduleOnce",
  window: "scheduler.scheduleWindow",
};

const HHMM_RE = /^\d{1,2}:\d{1,2}$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地时区日期的 YYYY-MM-DD（date input 的取值格式） */
function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** HH:mm → 分钟数（跨字段比较起止时刻用） */
function hmToMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

/** 新建/编辑共用表单；editingId 为 null 表示「新建」 */
const editingId = ref<string | null>(null);
const formError = ref("");

const form = reactive({
  name: "",
  prompt: "",
  kind: "interval" as ScheduleKind,
  every: "30",
  unit: "minute" as ScheduleUnit,
  time: "08:30",
  day: "1",
  date: localDateISO(new Date()),
  startTime: "09:00",
  endTime: "18:00",
  everyMinutes: "30",
  workspacePath: COMMON_WORKSPACE,
  enabled: true,
});

/** 可选目标工作区：有目录的项目工作区 + 公共区（哨兵值） */
const workspaceOptions = computed(() => {
  const groups = workspaceStore.groups.filter(
    (group) => !group.archived && group.kind === "workspace" && group.path,
  );
  return [
    { path: COMMON_WORKSPACE, label: t("scheduler.workspaceCommon") },
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
  form.every = "30";
  form.unit = "minute";
  form.time = "08:30";
  form.day = "1";
  form.date = localDateISO(new Date());
  form.startTime = "09:00";
  form.endTime = "18:00";
  form.everyMinutes = "30";
  form.workspacePath = COMMON_WORKSPACE;
  form.enabled = true;
}

function startEdit(task: ScheduledTask) {
  editingId.value = task.id;
  formError.value = "";
  form.name = task.name;
  form.prompt = task.prompt;
  form.kind = task.schedule.kind;
  const s = task.schedule;
  form.every = String(s.kind === "interval" ? (s.every ?? 30) : 30);
  form.unit = s.kind === "interval" ? (s.unit ?? "minute") : "minute";
  form.time = s.kind === "daily" || s.kind === "monthly" ? (s.time ?? "08:30") : "08:30";
  form.day = String(s.kind === "monthly" ? (s.day ?? 1) : 1);
  form.date = localDateISO(new Date());
  form.startTime = "09:00";
  form.endTime = "18:00";
  form.everyMinutes = "30";
  if (s.kind === "once" && Number.isFinite(s.at)) {
    const d = new Date(s.at ?? Date.now());
    form.date = localDateISO(d);
    form.time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  if (s.kind === "window") {
    form.startTime = s.startTime ?? "09:00";
    form.endTime = s.endTime ?? "18:00";
    form.everyMinutes = String(s.everyMinutes ?? 30);
  }
  form.workspacePath = toFormWorkspace(task.workspacePath);
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
  const base = {
    name,
    prompt,
    enabled: form.enabled,
    workspacePath: fromFormWorkspace(form.workspacePath),
  };
  switch (form.kind) {
    case "interval": {
      const every = Number(form.every);
      if (!Number.isInteger(every) || every < 1) {
        return { error: t("scheduler.errEvery") };
      }
      return { input: { ...base, schedule: { kind: "interval", every, unit: form.unit } } };
    }
    case "daily": {
      const time = form.time.trim();
      if (!HHMM_RE.test(time)) {
        return { error: t("scheduler.errTime") };
      }
      return { input: { ...base, schedule: { kind: "daily", time } } };
    }
    case "monthly": {
      const day = Number(form.day);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return { error: t("scheduler.errDay") };
      }
      const time = form.time.trim();
      if (!HHMM_RE.test(time)) {
        return { error: t("scheduler.errTime") };
      }
      return { input: { ...base, schedule: { kind: "monthly", day, time } } };
    }
    case "once": {
      const time = form.time.trim();
      if (!form.date || !HHMM_RE.test(time)) {
        return { error: t("scheduler.errTime") };
      }
      // "YYYY-MM-DDTHH:mm" 按本地时区解析
      const at = new Date(`${form.date}T${time}`).getTime();
      if (!Number.isFinite(at)) {
        return { error: t("scheduler.errTime") };
      }
      if (at <= Date.now()) {
        return { error: t("scheduler.errOnceFuture") };
      }
      return { input: { ...base, schedule: { kind: "once", at } } };
    }
    case "window": {
      const startTime = form.startTime.trim();
      const endTime = form.endTime.trim();
      if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) {
        return { error: t("scheduler.errTime") };
      }
      if (hmToMinutes(startTime) >= hmToMinutes(endTime)) {
        return { error: t("scheduler.errWindowTime") };
      }
      const everyMinutes = Number(form.everyMinutes);
      if (!Number.isInteger(everyMinutes) || everyMinutes < 1) {
        return { error: t("scheduler.errWindowEvery") };
      }
      return {
        input: { ...base, schedule: { kind: "window", startTime, endTime, everyMinutes } },
      };
    }
  }
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

/** 调度描述（任务列表徽标） */
function scheduleLabel(task: ScheduledTask): string {
  const s: ScheduledTaskSchedule = task.schedule;
  if (s.kind === "interval") {
    return t("scheduler.everyUnit", {
      n: s.every ?? 0,
      unit: t(UNIT_KEYS[s.unit ?? "minute"]),
    });
  }
  if (s.kind === "daily") {
    return t("scheduler.dailyAt", { time: s.time ?? "" });
  }
  if (s.kind === "monthly") {
    return t("scheduler.monthlyOn", { day: s.day ?? 1, time: s.time ?? "" });
  }
  if (s.kind === "once") {
    return t("scheduler.onceAt", { time: new Date(s.at ?? 0).toLocaleString() });
  }
  return t("scheduler.windowRange", {
    start: s.startTime ?? "",
    end: s.endTime ?? "",
    n: s.everyMinutes ?? 0,
  });
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
          <!-- 调度类型 + 对应选择器：间隔(数字+单位) / 每日(时间) / 每月(几号+时间) / 单次(日期+时间) / 时间范围(起止+间隔) -->
          <div class="grid gap-2 md:grid-cols-[minmax(110px,140px)_minmax(0,1fr)]">
            <Select v-model="form.kind">
              <SelectTrigger class="h-8 text-[12px]" :aria-label="t('scheduler.schedule')">
                <SelectValue :placeholder="t('scheduler.schedule')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="kind in SCHEDULE_KINDS" :key="kind" :value="kind">
                  {{ t(KIND_KEYS[kind]) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <div v-if="form.kind === 'interval'" class="grid grid-cols-[minmax(0,1fr)_minmax(96px,120px)] gap-2">
              <Input
                v-model="form.every"
                type="number"
                min="1"
                step="1"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.intervalEvery')"
                :placeholder="t('scheduler.intervalEvery')"
              />
              <Select v-model="form.unit">
                <SelectTrigger class="h-8 text-[12px]" :aria-label="t('scheduler.unitMinute')">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(key, unit) in UNIT_KEYS" :key="unit" :value="unit">
                    {{ t(key) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              v-else-if="form.kind === 'daily'"
              v-model="form.time"
              type="time"
              class="h-8 text-[12px]"
              :aria-label="t('scheduler.time')"
            />
            <div v-else-if="form.kind === 'monthly'" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <Input
                v-model="form.day"
                type="number"
                min="1"
                max="31"
                step="1"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.dayOfMonth')"
                :placeholder="t('scheduler.dayOfMonth')"
              />
              <Input
                v-model="form.time"
                type="time"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.time')"
              />
            </div>
            <div v-else-if="form.kind === 'once'" class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
              <Input
                v-model="form.date"
                type="date"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.onceDate')"
              />
              <Input
                v-model="form.time"
                type="time"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.onceTime')"
              />
            </div>
            <div v-else class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <Input
                v-model="form.startTime"
                type="time"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.windowStart')"
              />
              <Input
                v-model="form.endTime"
                type="time"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.windowEnd')"
              />
              <Input
                v-model="form.everyMinutes"
                type="number"
                min="1"
                step="1"
                class="h-8 text-[12px]"
                :aria-label="t('scheduler.windowEvery')"
                :placeholder="t('scheduler.windowEvery')"
              />
            </div>
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
