<script setup lang="ts">
import {
  IconArrowRight as ArrowRight,
  IconBell as Bell,
  IconCalendarClock as CalendarClock,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconRobot as Bot,
} from "@tabler/icons-vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  executorLabel,
  fmtTime,
  resultSummary,
  stageOf,
  statusLabel,
  triggerLabel,
} from "@/lib/tasks";

import type { Task, TaskStage } from "@zen/shared";

/**
 * 任务卡片（列表与看板共用）：标题、状态点+文案、执行者、触发器/下次运行、最近结果，
 * 右上角只给按状态推出的一个快捷动作——其它操作进详情，避免卡片变成按钮堆。
 */
const props = defineProps<{
  task: Task;
  selected?: boolean;
  /** 看板列内更窄：摘要只留一行 */
  compact?: boolean;
}>();

const emit = defineEmits<{
  open: [];
  run: [];
  pause: [];
}>();

const { t } = useI18n();

const stage = computed<TaskStage>(() => stageOf(props.task.status));

const STAGE_DOT: Record<TaskStage, string> = {
  todo: "bg-[var(--color-dim)]",
  in_progress: "bg-[var(--color-link)]",
  needs_you: "bg-[var(--agent-approval)]",
  done: "bg-[var(--color-ok)]",
};

const dotClass = computed(() => STAGE_DOT[stage.value]);

const statusText = computed(() => {
  const label = statusLabel(props.task.status);
  return t(label.key);
});

const executorText = computed(() => t(executorLabel(props.task.executor).key));

const triggerText = computed(() => {
  const label = triggerLabel(props.task.trigger);
  return t(label.key, label.params ?? {});
});

const summary = computed(() => resultSummary(props.task));

/** 任务本身不带结果文本（摘要只存在 attempt 里），卡片用最近一次运行状态兜底 */
const lastRunText = computed(() => {
  if (summary.value || !props.task.lastRunStatus) {
    return "";
  }
  const key = {
    succeeded: "tasks.card.lastSucceeded",
    failed: "tasks.card.lastFailed",
    cancelled: "tasks.card.lastCancelled",
  }[props.task.lastRunStatus];
  return t(key);
});

/** 快捷动作：待开始→立即运行；进行中→暂停；待处理→立即处理（打开详情） */
const quickAction = computed<"run" | "pause" | "open" | null>(() => {
  if (props.task.archivedAt) {
    return null;
  }
  if (stage.value === "todo") {
    return "run";
  }
  if (stage.value === "in_progress") {
    return props.task.status === "running" ? "pause" : null;
  }
  return stage.value === "needs_you" ? "open" : null;
});

const quickLabel = computed(() => {
  if (quickAction.value === "run") {
    return t("tasks.card.run");
  }
  if (quickAction.value === "pause") {
    return t("tasks.card.pause");
  }
  return t("tasks.card.processing");
});

function onQuick(): void {
  if (quickAction.value === "run") {
    emit("run");
  } else if (quickAction.value === "pause") {
    emit("pause");
  } else {
    emit("open");
  }
}
</script>

<template>
  <article
    class="group/card flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-3 transition-colors hover:border-[var(--color-line-strong)]"
    :class="selected ? 'border-[var(--color-line-strong)] bg-[var(--color-raise)]' : ''"
    :data-task-id="task.id"
    :data-testid="`task-card-${task.id}`"
  >
    <div class="flex min-w-0 items-start gap-1.5">
      <div class="min-w-0 flex-1">
        <Button
          variant="ghost"
          size="sm"
          class="h-auto w-full min-w-0 justify-start px-0 py-0 text-left text-[13px] font-medium whitespace-normal text-[var(--color-txt-strong)] hover:bg-transparent"
          :aria-label="task.title"
          @click="emit('open')"
        >
          <span class="line-clamp-2 min-w-0">{{ task.title }}</span>
        </Button>
        <div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-mut)]">
          <span class="inline-flex items-center gap-1">
            <span class="size-1.5 flex-none rounded-full" :class="dotClass" aria-hidden="true" />
            {{ statusText }}
          </span>
          <span class="inline-flex min-w-0 items-center gap-1">
            <Bot v-if="task.executor.kind === 'agent'" class="size-3 flex-none" aria-hidden="true" />
            <Bell v-else class="size-3 flex-none" aria-hidden="true" />
            <span class="truncate">{{ executorText }}</span>
          </span>
          <span class="inline-flex min-w-0 items-center gap-1">
            <CalendarClock class="size-3 flex-none" aria-hidden="true" />
            <span class="truncate">{{ triggerText }}</span>
          </span>
        </div>
      </div>
      <Button
        v-if="quickAction"
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-icon)]"
        :title="quickLabel"
        :aria-label="quickLabel"
        :data-testid="`task-quick-${task.id}`"
        @click="onQuick"
      >
        <Play v-if="quickAction === 'run'" class="size-3.5" aria-hidden="true" />
        <Pause v-else-if="quickAction === 'pause'" class="size-3.5" aria-hidden="true" />
        <ArrowRight v-else class="size-3.5" aria-hidden="true" />
      </Button>
    </div>

    <p
      v-if="summary"
      class="m-0 text-[11px] leading-normal text-[var(--color-dim)]"
      :class="compact ? 'line-clamp-1' : 'line-clamp-2'"
      :title="summary"
    >
      {{ summary }}
    </p>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-mut)]">
      <span v-if="task.nextRunAt">{{ t("tasks.card.nextRun", { time: fmtTime(task.nextRunAt) }) }}</span>
      <span v-else-if="!summary">{{ t("tasks.card.noNextRun") }}</span>
      <span v-if="lastRunText">{{ lastRunText }}</span>
      <span v-if="task.archivedAt" class="text-[var(--color-dim)]">{{ t("tasks.archived") }}</span>
    </div>
  </article>
</template>
