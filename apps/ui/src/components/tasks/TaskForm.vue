<script setup lang="ts">
import { IconPlus as Plus, IconX as X } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  grantLevelLabel,
  grantLevelOf,
  triggerLabel,
  executorLabel,
} from "@/lib/tasks";
import { useTasksStore } from "@/stores/tasks";
import { useWorkspaceStore } from "@/stores/workspace";

import type { Task, TaskCategory, TaskInput, TaskPriority, TaskToolClass, TaskTrigger } from "@zen/shared";

/**
 * 新建任务：表单 → 授权确认卡 → create。
 * 授权范围由所选能力/目录/期限在渲染层推导，主进程再逐项校验；
 * 确认卡是唯一提交入口，避免「点创建才发现给了 shell 权限」。
 */
const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  created: [task: Task];
}>();

const store = useTasksStore();
const workspaceStore = useWorkspaceStore();
const { groups } = storeToRefs(workspaceStore);
const { t } = useI18n();

type WhenKind = "manual" | "once" | "daily" | "workdays" | "interval" | "event";

const WHEN_OPTIONS: WhenKind[] = ["manual", "once", "daily", "workdays", "interval", "event"];
const TOOL_OPTIONS: TaskToolClass[] = ["read", "web", "file_write", "shell"];
const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];
const CATEGORIES: TaskCategory[] = ["coding", "review", "research", "writing", "monitor", "chore"];
const GRANT_DAYS = [7, 30, 90];

const step = ref<"form" | "confirm">("form");
const error = ref("");
const submitting = ref(false);

function emptyForm() {
  return {
    title: "",
    goal: "",
    when: "manual" as WhenKind,
    date: "",
    time: "09:00",
    interval: "30",
    executor: "agent" as "agent" | "notify",
    notifyText: "",
    tools: ["read"] as TaskToolClass[],
    paths: [] as string[],
    pathDraft: "",
    grantDays: 30,
    doneWhen: "",
    acceptance: "user" as "auto" | "user",
    priority: "medium" as TaskPriority,
    category: "coding" as TaskCategory,
  };
}

const form = reactive(emptyForm());

const workspaceOptions = computed(() =>
  groups.value.filter((group) => !group.archived && group.kind === "workspace" && group.path),
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return;
    }
    Object.assign(form, emptyForm());
    step.value = "form";
    error.value = "";
    void workspaceStore.refresh();
  },
);

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 绝对路径：POSIX 以 / 开头；Windows 盘符 + 分隔符（三平台都要能填） */
const ABSOLUTE_PATH = /^\/|^[A-Za-z]:[\\/]/;

function toggleTool(tool: TaskToolClass): void {
  form.tools = form.tools.includes(tool)
    ? form.tools.filter((item) => item !== tool)
    : [...form.tools, tool];
}

function togglePath(path: string): void {
  form.paths = form.paths.includes(path)
    ? form.paths.filter((item) => item !== path)
    : [...form.paths, path];
}

function addPath(): void {
  const path = form.pathDraft.trim();
  if (!path) {
    return;
  }
  if (!ABSOLUTE_PATH.test(path)) {
    error.value = t("tasks.form.errPath");
    return;
  }
  if (!form.paths.includes(path)) {
    form.paths = [...form.paths, path];
  }
  form.pathDraft = "";
  error.value = "";
}

function onceAt(): number {
  return new Date(`${form.date}T${form.time}`).getTime();
}

function buildTrigger(): TaskTrigger {
  if (form.when === "manual") {
    return { kind: "manual" };
  }
  if (form.when === "event") {
    return { kind: "event", source: "app.run.finished" };
  }
  if (form.when === "once") {
    return { kind: "schedule", schedule: { kind: "once", at: onceAt() } };
  }
  if (form.when === "daily") {
    return { kind: "schedule", schedule: { kind: "recurrence", every: 1, unit: "day", times: [form.time] } };
  }
  if (form.when === "workdays") {
    return {
      kind: "schedule",
      schedule: { kind: "recurrence", every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5], times: [form.time] },
    };
  }
  return {
    kind: "schedule",
    schedule: { kind: "interval", every: Number(form.interval), unit: "minute" },
  };
}

const grantLevel = computed(() =>
  form.executor === "notify" ? 0 : grantLevelOf(form.tools),
);

/** 表单 → TaskInput；校验失败只给第一条错误（避免一次弹一屏） */
function buildInput(): { input: TaskInput } | { error: string } {
  const title = form.title.trim();
  if (!title) {
    return { error: t("tasks.form.errTitle") };
  }
  const goal = form.goal.trim();
  if (!goal) {
    return { error: t("tasks.form.errGoal") };
  }
  if (form.when === "once") {
    if (!DATE_PATTERN.test(form.date)) {
      return { error: t("tasks.form.errDate") };
    }
    if (!TIME_PATTERN.test(form.time)) {
      return { error: t("tasks.form.errTime") };
    }
    if (onceAt() <= Date.now()) {
      return { error: t("tasks.form.errWhenPast") };
    }
  }
  if ((form.when === "daily" || form.when === "workdays") && !TIME_PATTERN.test(form.time)) {
    return { error: t("tasks.form.errTime") };
  }
  if (form.when === "interval") {
    const every = Number(form.interval);
    if (!Number.isInteger(every) || every < 1) {
      return { error: t("tasks.form.errInterval") };
    }
  }
  if (form.executor === "notify" && !form.notifyText.trim()) {
    return { error: t("tasks.form.errNotify") };
  }
  if (form.executor === "agent" && !form.tools.length) {
    return { error: t("tasks.form.errTools") };
  }
  if (form.paths.some((path) => !ABSOLUTE_PATH.test(path))) {
    return { error: t("tasks.form.errPath") };
  }

  const executor: TaskInput["executor"] =
    form.executor === "agent"
      ? {
          kind: "agent",
          tools: [...form.tools],
          doneWhen: form.doneWhen.trim() || undefined,
        }
      : { kind: "notify", text: form.notifyText.trim() };

  return {
    input: {
      title,
      goal,
      trigger: buildTrigger(),
      executor,
      acceptance: form.acceptance,
      priority: form.priority,
      category: form.category,
      grant: {
        level: grantLevel.value,
        paths: form.executor === "notify" ? [] : [...form.paths],
        expiresAt: Date.now() + form.grantDays * 24 * 3600_000,
      },
    },
  };
}

/** 表单 → 确认卡（此时还不落库） */
function toConfirm(): void {
  const parsed = buildInput();
  if ("error" in parsed) {
    error.value = parsed.error;
    return;
  }
  error.value = "";
  step.value = "confirm";
}

async function submit(): Promise<void> {
  const parsed = buildInput();
  if ("error" in parsed) {
    error.value = parsed.error;
    step.value = "form";
    return;
  }
  submitting.value = true;
  const result = await store.create(parsed.input);
  submitting.value = false;
  if ("error" in result) {
    error.value = result.error;
    return;
  }
  emit("created", result.task);
  emit("update:open", false);
}

const preview = computed(() => {
  const parsed = buildInput();
  if ("error" in parsed) {
    return null;
  }
  const { trigger, executor, grant } = parsed.input;
  return {
    trigger: t(triggerLabel(trigger).key, triggerLabel(trigger).params ?? {}),
    executor: t(executorLabel(executor).key),
    level: t(grantLevelLabel(grant.level as 0 | 1 | 2 | 3).key),
    paths: grant.paths,
    days: form.grantDays,
  };
});
</script>

<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent
      data-large-panel="true"
      class="flex max-h-[min(760px,calc(100vh-80px))] w-[min(720px,calc(100vw-48px))] flex-col gap-3 border border-[var(--color-line)] bg-[var(--color-popover)] p-4"
      data-testid="task-form"
    >
      <DialogHeader>
        <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
          {{ step === "form" ? t("tasks.form.title") : t("tasks.form.summaryTitle") }}
        </DialogTitle>
        <DialogDescription class="text-[11px] leading-normal text-[var(--color-mut)]">
          {{ t("tasks.form.desc") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <template v-if="step === 'form'">
          <section class="flex flex-col gap-2" data-testid="task-form-group-goal">
            <p class="m-0 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.form.groupGoal") }}</p>
            <div class="flex flex-col gap-1">
              <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.titleField") }}</Label>
              <Input v-model="form.title" class="h-8 text-[13px]" :placeholder="t('tasks.form.titlePlaceholder')" />
            </div>

            <div class="flex flex-col gap-1">
              <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.goal") }}</Label>
              <Textarea v-model="form.goal" class="min-h-24 text-[13px]" :placeholder="t('tasks.form.goalPlaceholder')" />
            </div>
          </section>

          <section class="flex flex-col gap-2" data-testid="task-form-group-when">
            <p class="m-0 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.form.groupWhen") }}</p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.when") }}</Label>
                <Select v-model="form.when">
                  <SelectTrigger size="sm" class="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="when in WHEN_OPTIONS" :key="when" :value="when">
                      {{ t(`tasks.form.when${when.charAt(0).toUpperCase()}${when.slice(1)}`) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.who") }}</Label>
                <Select v-model="form.executor">
                  <SelectTrigger size="sm" class="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">{{ t("tasks.form.agent") }}</SelectItem>
                    <SelectItem value="notify">{{ t("tasks.form.notify") }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div v-if="form.when === 'once'" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input v-model="form.date" class="h-8 text-[13px]" :placeholder="t('tasks.form.datePlaceholder')" :aria-label="t('tasks.form.onceDate')" />
              <Input v-model="form.time" class="h-8 text-[13px]" :placeholder="t('tasks.form.timePlaceholder')" :aria-label="t('tasks.form.onceTime')" />
            </div>
            <div v-else-if="form.when === 'daily' || form.when === 'workdays'" class="w-1/2 max-w-60 pr-1">
              <Input v-model="form.time" class="h-8 text-[13px]" :placeholder="t('tasks.form.timePlaceholder')" :aria-label="t('tasks.form.onceTime')" />
            </div>
            <div v-else-if="form.when === 'interval'" class="flex items-center gap-1.5">
              <Input v-model="form.interval" class="h-8 w-24 text-[13px]" :aria-label="t('tasks.form.intervalEvery')" />
              <span class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.intervalUnit") }}</span>
            </div>

            <div v-if="form.executor === 'notify'" class="flex flex-col gap-1">
              <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.notify") }}</Label>
              <Input v-model="form.notifyText" class="h-8 text-[13px]" :placeholder="t('tasks.form.notifyPlaceholder')" />
            </div>
          </section>

          <section
            v-if="form.executor === 'agent'"
            class="flex flex-col gap-2"
            data-testid="task-form-group-scope"
          >
            <p class="m-0 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.form.groupScope") }}</p>
            <div class="flex flex-col gap-1">
              <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.tools") }}</Label>
              <div class="flex flex-wrap items-center gap-3">
                <label
                  v-for="tool in TOOL_OPTIONS"
                  :key="tool"
                  class="flex items-center gap-1.5 text-[12px] text-[var(--color-txt)]"
                >
                  <Checkbox :model-value="form.tools.includes(tool)" @update:model-value="toggleTool(tool)" />
                  {{ t(`tasks.tool.${tool}`) }}
                </label>
              </div>
              <p class="m-0 text-[10px] text-[var(--color-dim)]">{{ t("tasks.form.toolsHint") }}</p>
            </div>

            <div class="flex flex-col gap-1">
              <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.paths") }}</Label>
              <div v-if="workspaceOptions.length" class="flex flex-col gap-1">
                <label
                  v-for="group in workspaceOptions"
                  :key="group.id"
                  class="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--color-txt)]"
                >
                  <Checkbox
                    :model-value="form.paths.includes(group.path ?? '')"
                    @update:model-value="togglePath(group.path ?? '')"
                  />
                  <span class="min-w-0 truncate">{{ group.name }}</span>
                  <code class="min-w-0 truncate text-[10px] text-[var(--color-dim)]">{{ group.path }}</code>
                </label>
              </div>
              <div class="flex items-center gap-1.5">
                <Input v-model="form.pathDraft" class="h-8 text-[13px]" :placeholder="t('tasks.form.pathPlaceholder')" @keydown.enter.prevent="addPath" />
                <Button variant="outline" size="sm" class="flex-none" @click="addPath">{{ t("tasks.form.addPath") }}</Button>
              </div>
              <div v-if="form.paths.length" class="flex flex-wrap gap-1">
                <span
                  v-for="path in form.paths"
                  :key="path"
                  class="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-sunken)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-txt)]"
                >
                  <span class="min-w-0 truncate">{{ path }}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="size-4 flex-none"
                    :aria-label="t('tasks.form.removePath')"
                    @click="togglePath(path)"
                  >
                    <X class="size-3" aria-hidden="true" />
                  </Button>
                </span>
              </div>
              <p class="m-0 text-[10px] text-[var(--color-dim)]">{{ t("tasks.form.pathsHint") }}</p>
            </div>

            <div class="flex flex-col gap-1">
              <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.doneWhen") }}</Label>
              <Textarea v-model="form.doneWhen" class="min-h-16 text-[13px]" :placeholder="t('tasks.form.doneWhenPlaceholder')" />
            </div>
          </section>

          <section class="flex flex-col gap-2" data-testid="task-form-group-other">
            <p class="m-0 text-[11px] font-medium text-[var(--color-mut)]">{{ t("tasks.form.groupOther") }}</p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.expiry") }}</Label>
                <Select v-model="form.grantDays">
                  <SelectTrigger size="sm" class="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="days in GRANT_DAYS" :key="days" :value="days">
                      {{ t("tasks.form.expiryDays", { n: days }) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.acceptance") }}</Label>
                <Select v-model="form.acceptance">
                  <SelectTrigger size="sm" class="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{{ t("tasks.form.acceptanceAuto") }}</SelectItem>
                    <SelectItem value="user">{{ t("tasks.form.acceptanceUser") }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.priority") }}</Label>
                <Select v-model="form.priority">
                  <SelectTrigger size="sm" class="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="item in PRIORITIES" :key="item" :value="item">
                      {{ t(`tasks.priority.${item}`) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label class="text-[12px] text-[var(--color-mut)]">{{ t("tasks.form.category") }}</Label>
                <Select v-model="form.category">
                  <SelectTrigger size="sm" class="w-full text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="item in CATEGORIES" :key="item" :value="item">
                      {{ t(`tasks.category.${item}`) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="preview">
          <div class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-sunken)] p-3 text-[13px]">
            <div class="flex justify-between gap-2">
              <span class="text-[var(--color-mut)]">{{ t("tasks.form.titleField") }}</span>
              <span class="min-w-0 truncate text-[var(--color-txt-strong)]">{{ form.title }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-[var(--color-mut)]">{{ t("tasks.form.when") }}</span>
              <span class="min-w-0 truncate text-[var(--color-txt)]">{{ preview.trigger }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-[var(--color-mut)]">{{ t("tasks.form.who") }}</span>
              <span class="text-[var(--color-txt)]">{{ preview.executor }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-[var(--color-mut)]">{{ t("tasks.grant.level") }}</span>
              <span class="text-[var(--color-txt)]">{{ preview.level }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="flex-none text-[var(--color-mut)]">{{ t("tasks.grant.paths") }}</span>
              <span class="min-w-0 truncate text-right text-[var(--color-txt)]">
                {{ preview.paths.length ? preview.paths.join("  ") : t("tasks.grant.noPaths") }}
              </span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-[var(--color-mut)]">{{ t("tasks.form.expiry") }}</span>
              <span class="text-[var(--color-txt)]">{{ t("tasks.form.expiryDays", { n: preview.days }) }}</span>
            </div>
          </div>
          <p class="m-0 text-[10px] leading-normal text-[var(--color-dim)]">{{ t("tasks.form.summaryHint") }}</p>
        </template>

        <p v-if="error" class="m-0 text-[11px] text-[var(--color-err)]" data-testid="task-form-error">{{ error }}</p>
      </div>

      <DialogFooter class="flex-none gap-1.5">
        <Button variant="ghost" size="sm" @click="emit('update:open', false)">
          {{ t("tasks.form.cancel") }}
        </Button>
        <Button v-if="step === 'confirm'" variant="outline" size="sm" @click="step = 'form'">
          {{ t("tasks.form.back") }}
        </Button>
        <Button v-if="step === 'form'" size="sm" data-testid="task-form-next" @click="toConfirm">
          {{ t("tasks.form.next") }}
        </Button>
        <Button v-else size="sm" :disabled="submitting" data-testid="task-form-create" @click="submit">
          <Plus class="size-3.5" aria-hidden="true" />{{ t("tasks.form.confirmCreate") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
