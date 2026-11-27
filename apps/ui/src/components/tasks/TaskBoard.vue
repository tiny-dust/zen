<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import TaskCard from "./TaskCard.vue";
import { TASK_STAGES, stageOf } from "@/lib/tasks";

import type { Task, TaskStage } from "@zen/shared";

/** 看板视图：四列固定顺序，列内卡片与列表同构（摘要收紧到一行） */
const props = defineProps<{
  tasks: Task[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  open: [task: Task];
  run: [task: Task];
  pause: [task: Task];
}>();

const { t } = useI18n();

const columns = computed(() => {
  const buckets = new Map<TaskStage, Task[]>(TASK_STAGES.map((stage) => [stage, []]));
  for (const task of props.tasks) {
    buckets.get(stageOf(task.status))?.push(task);
  }
  return TASK_STAGES.map((stage) => ({ stage, tasks: buckets.get(stage) ?? [] }));
});
</script>

<template>
  <div class="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4" data-testid="task-board">
    <section
      v-for="column in columns"
      :key="column.stage"
      class="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-sunken)] p-2"
      :data-testid="`task-column-${column.stage}`"
    >
      <header class="flex items-center justify-between px-1 py-0.5">
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ t(`tasks.stages.${column.stage}`) }}
        </span>
        <span class="text-[11px] text-[var(--color-mut)]">{{ column.tasks.length }}</span>
      </header>
      <div class="flex min-w-0 flex-col gap-2">
        <TaskCard
          v-for="task in column.tasks"
          :key="task.id"
          :task="task"
          compact
          :selected="task.id === selectedId"
          @open="emit('open', task)"
          @run="emit('run', task)"
          @pause="emit('pause', task)"
        />
        <p v-if="!column.tasks.length" class="m-0 px-1 py-4 text-center text-[11px] text-[var(--color-mut)]">
          {{ t("tasks.emptyStage") }}
        </p>
      </div>
    </section>
  </div>
</template>
