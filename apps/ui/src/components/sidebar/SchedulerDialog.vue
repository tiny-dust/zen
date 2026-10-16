<script setup lang="ts">
import { CalendarClock, History, Loader2, MessageSquareText, Pencil, Play, Plus, Trash2, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { ScheduleEditor } from "@/components/scheduler";
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
import { openSessionById } from "@/lib/open-session";
import { useSchedulerStore } from "@/stores/scheduler";
import { useWorkspaceStore } from "@/stores/workspace";

import type { ComponentInstance } from "vue";
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskSchedule, ScheduleUnit } from "@zen/shared";
import { isValidSchedule } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const schedulerStore = useSchedulerStore();
const workspaceStore = useWorkspaceStore();
const { tasks, runs } = storeToRefs(schedulerStore);

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

/** interval 单位 → 文案键（间隔类徽标共用） */
const UNIT_KEYS: Record<ScheduleUnit, string> = {
  second: "scheduler.unitSecond",
  minute: "scheduler.unitMinute",
  hour: "scheduler.unitHour",
  day: "scheduler.unitDay",
  week: "scheduler.unitWeek",
  month: "scheduler.unitMonth",
};

/** 弹窗视图：list=任务列表（默认），form=新建/编辑配置页（提交/取消后回列表） */
const view = ref<"list" | "form">("list");

/** 新建/编辑共用表单；editingId 为 null 表示「新建」；调度细节由 ScheduleEditor 管理 */
const editingId = ref<string | null>(null);
const formError = ref("");
const editorRef = ref<ComponentInstance<typeof ScheduleEditor> | null>(null);

/** 调度草稿（ScheduleEditor 的 v-model；内容可能不完整，提交前 validate） */
function defaultSchedule(): ScheduledTaskSchedule {
  return { kind: "recurrence", every: 1, unit: "day", times: ["09:00"] };
}

const form = reactive({
  name: "",
  prompt: "",
  schedule: defaultSchedule(),
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
    // 每次打开都从任务列表进（上次关闭前停在表单页不延续）
    view.value = "list";
    resetForm();
    void schedulerStore.load();
  }
});

function resetForm() {
  editingId.value = null;
  formError.value = "";
  form.name = "";
  form.prompt = "";
  form.schedule = defaultSchedule();
  form.workspacePath = COMMON_WORKSPACE;
  form.enabled = true;
}

/** 列表 → 新建配置页 */
function startCreate() {
  resetForm();
  view.value = "form";
}

function startEdit(task: ScheduledTask) {
  editingId.value = task.id;
  formError.value = "";
  form.name = task.name;
  form.prompt = task.prompt;
  // 旧类型任务（interval/daily/monthly）由编辑器导入时前向迁移到「重复」
  form.schedule = task.schedule;
  form.workspacePath = toFormWorkspace(task.workspacePath);
  form.enabled = task.enabled;
  view.value = "form";
}

/** 取消/关闭配置页：回列表 */
function cancelEdit() {
  resetForm();
  view.value = "list";
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
  const scheduleError = editorRef.value?.validate() ?? null;
  if (scheduleError) {
    return { error: scheduleError };
  }
  // 编辑器校验通过后理论必然合法；兜底防御草稿被外部改坏
  if (!isValidSchedule(form.schedule)) {
    return { error: t("scheduler.errScheduleInvalid") };
  }
  return {
    input: {
      name,
      prompt,
      schedule: form.schedule,
      enabled: form.enabled,
      workspacePath: fromFormWorkspace(form.workspacePath),
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
    cancelEdit();
    return;
  }
  if ("error" in result && result.error) {
    formError.value = result.error;
    return;
  }
  // 提交成功：回列表
  cancelEdit();
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

// ---------- 运行历史与会话跳转 ----------

/** 展开运行历史的任务 id 集：展开即懒加载，运行结束事件会自动刷新已加载列表 */
const expandedRuns = ref<Set<string>>(new Set());

function isRunsExpanded(taskId: string): boolean {
  return expandedRuns.value.has(taskId);
}

function toggleRuns(taskId: string) {
  const next = new Set(expandedRuns.value);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
    void schedulerStore.loadRuns(taskId);
  }
  expandedRuns.value = next;
}

/** 打开某次运行对应的会话（跳过去看完整过程）；成功后关闭弹窗 */
async function openRun(sessionId: string | null, taskId: string) {
  if (!sessionId) {
    return;
  }
  const opened = await openSessionById(sessionId);
  if (opened) {
    open.value = false;
    return;
  }
  runErrors.value[taskId] = t("scheduler.sessionMissing");
}

/** 历史行状态徽标：ok=null 表示仍在运行 */
function runStatusLabel(ok: boolean | null): string {
  return ok === null ? t("scheduler.runningState") : ok ? t("scheduler.ok") : t("scheduler.failed");
}

function runTimeLabel(at: number): string {
  return new Date(at).toLocaleString();
}

/** 星期几短标签（0=周日 … 6=周六；与 shared weekdays 约定一致） */
function weekdayShort(weekday: number): string {
  return t("scheduler.weekdaysShort").split(",")[weekday] ?? String(weekday);
}

/** 调度描述（任务列表徽标） */
function scheduleLabel(task: ScheduledTask): string {
  const s: ScheduledTaskSchedule = task.schedule;
  if (s.kind === "recurrence") {
    const times = (s.times ?? []).join("、") || "--:--";
    const untilSuffix = s.until ? t("scheduler.recLabelUntil", { date: s.until }) : "";
    const unit = s.unit ?? "day";
    if (unit === "second" || unit === "minute" || unit === "hour") {
      return (
        t("scheduler.everyUnit", { n: s.every ?? 0, unit: t(UNIT_KEYS[unit]) }) + untilSuffix
      );
    }
    if (unit === "day") {
      return t("scheduler.recLabelDay", { n: s.every ?? 1, times }) + untilSuffix;
    }
    if (unit === "week") {
      const days = [...(s.weekdays ?? [])].sort().map(weekdayShort).join("、");
      return (
        (s.every === 1
          ? t("scheduler.recLabelWeek", { days, times })
          : t("scheduler.recLabelWeeks", { n: s.every ?? 1, days, times })) + untilSuffix
      );
    }
    const n = s.every ?? 1;
    if (s.monthlyOn?.mode === "nthWeekday") {
      return (
        t("scheduler.recLabelMonthNth", {
          n,
          nth: s.monthlyOn.nth,
          weekday: weekdayShort(s.monthlyOn.weekday),
          times,
        }) + untilSuffix
      );
    }
    return (
      t("scheduler.recLabelMonthDay", {
        n,
        day: s.monthlyOn?.mode === "day" ? s.monthlyOn.day : 1,
        times,
      }) + untilSuffix
    );
  }
  if (s.kind === "dates") {
    return t("scheduler.datesLabel", { n: (s.dates ?? []).length, times: (s.times ?? []).join("、") });
  }
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
        <!-- 任务列表（默认视图）：先看列表，新建/编辑才进配置页 -->
        <template v-if="view === 'list'">
          <div class="flex flex-none items-center justify-between gap-2">
            <div class="min-w-0 truncate text-[12px] font-medium text-[var(--color-mut)]">
              {{ t("scheduler.taskCount", { n: tasks.length }) }}
            </div>
            <Button size="sm" class="flex-none" @click="startCreate">
              <Plus class="size-3.5" />{{ t("scheduler.add") }}
            </Button>
          </div>
          <div v-if="tasks.length" class="flex min-w-0 flex-col gap-1.5">
            <div
              v-for="task in tasks"
              :key="task.id"
              class="rounded-lg border border-[var(--color-line)] px-3 py-2"
            >
              <div class="flex items-start gap-2">
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
                  v-if="task.lastSessionId"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('scheduler.viewRun')"
                  :title="t('scheduler.viewRun')"
                  @click="openRun(task.lastSessionId, task.id)"
                >
                  <MessageSquareText class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('scheduler.runHistory')"
                  :title="t('scheduler.runHistory')"
                  @click="toggleRuns(task.id)"
                >
                  <History class="size-3.5" />
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

              <!-- 运行历史（展开态；行内「查看运行」跳到该次会话看完整过程） -->
              <div
                v-if="isRunsExpanded(task.id)"
                class="mt-2 border-t border-[var(--color-line-soft)] pt-2"
              >
                <div
                  v-if="!runs[task.id]"
                  class="flex items-center gap-1.5 text-[11px] text-[var(--color-dim)]"
                >
                  <Loader2 class="size-3 animate-spin" aria-hidden="true" />{{ t("common.loading") }}
                </div>
                <template v-else-if="runs[task.id].length">
                  <div
                    v-for="run in runs[task.id]"
                    :key="run.id"
                    class="flex items-center gap-2 py-0.5"
                  >
                    <Badge
                      :variant="run.ok === false ? 'destructive' : 'secondary'"
                      class="flex-none text-[10px]"
                    >
                      {{ runStatusLabel(run.ok) }}
                    </Badge>
                    <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
                      {{ runTimeLabel(run.startedAt) }}
                    </span>
                    <span
                      v-if="run.summary"
                      class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-mut)]"
                      :title="run.summary"
                    >
                      {{ run.summary }}
                    </span>
                    <Button
                      v-if="run.sessionId"
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="t('scheduler.viewRun')"
                      :title="t('scheduler.viewRun')"
                      @click="openRun(run.sessionId, task.id)"
                    >
                      <MessageSquareText class="size-3" />
                    </Button>
                  </div>
                </template>
                <p v-else class="m-0 text-[11px] text-[var(--color-dim)]">{{ t("scheduler.noRuns") }}</p>
              </div>
            </div>
          </div>
          <!-- 空状态：图标 + 一句话（新建按钮已在顶栏，不重复同屏控件） -->
          <div v-else class="flex flex-col items-center gap-2 py-8 text-[var(--color-dim)]">
            <CalendarClock class="size-6" aria-hidden="true" />
            <p class="m-0 text-[12px]">{{ t("scheduler.noTasks") }}</p>
          </div>
        </template>

        <!-- 新建 / 编辑配置页：从列表进入，提交/取消回列表 -->
        <div v-else class="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--color-line)] p-3.5">
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
          <!-- 统一调度编辑器：重复/每日时间范围/单次/指定日期（Calendar + DatePicker） -->
          <ScheduleEditor ref="editorRef" v-model="form.schedule" />
          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-[12px] text-[var(--color-mut)]">
              <Switch v-model="form.enabled" size="sm" :aria-label="t('scheduler.enabled')" />
              {{ t("scheduler.enabled") }}
            </label>
            <Button size="sm" @click="submitForm">{{ t("common.save") }}</Button>
            <Button variant="ghost" size="sm" @click="cancelEdit">
              <X class="size-3.5" />{{ t("common.cancel") }}
            </Button>
            <span v-if="formError" class="text-[11px] text-[var(--color-danger-fg)]">{{ formError }}</span>
          </div>
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
