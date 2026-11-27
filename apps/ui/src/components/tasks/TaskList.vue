<script setup lang="ts">
import TaskCard from "./TaskCard.vue";

import type { Task } from "@zen/shared";

/** 列表视图：卡片两列（容器窄时自动落成一列），与看板共用 TaskCard */
defineProps<{
  tasks: Task[];
  selectedId: string | null;
  emptyText: string;
}>();

const emit = defineEmits<{
  open: [task: Task];
  run: [task: Task];
  pause: [task: Task];
}>();
</script>

<template>
  <div
    v-if="tasks.length"
    class="grid gap-2"
    style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))"
    data-testid="task-list"
  >
    <TaskCard
      v-for="task in tasks"
      :key="task.id"
      :task="task"
      :selected="task.id === selectedId"
      @open="emit('open', task)"
      @run="emit('run', task)"
      @pause="emit('pause', task)"
    />
  </div>
  <p v-else class="m-0 py-10 text-center text-[12px] text-[var(--color-mut)]">{{ emptyText }}</p>
</template>
