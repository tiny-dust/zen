<script setup lang="ts">
import { Circle, CircleCheck, ListChecks } from "@lucide/vue";

import type { TaskItem } from "@zen/shared";

defineProps<{
  version: number;
  items: TaskItem[];
}>();
</script>

<template>
  <div
    class="rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-side-glass)] px-2.5 py-2"
  >
    <div class="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-txt-strong)]">
      <ListChecks :size="14" class="flex-none text-[var(--color-accent)]" aria-hidden="true" />
      任务清单
      <span class="font-normal text-[var(--color-dim)]">v{{ version }}</span>
      <span class="ml-auto text-[11px] font-normal text-[var(--color-mut)]">
        {{ items.filter((item) => item.done).length }}/{{ items.length }}
      </span>
    </div>
    <ul class="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
      <li
        v-for="task in items"
        :key="task.id"
        class="flex items-start gap-1.5 text-[12px] leading-snug"
        :class="task.done ? 'text-[var(--color-mut)]' : 'text-[var(--color-txt)]'"
      >
        <CircleCheck
          v-if="task.done"
          class="mt-0.5 size-3.5 flex-none text-[var(--color-add)]"
          aria-hidden="true"
        />
        <Circle
          v-else
          class="mt-0.5 size-3.5 flex-none text-[var(--color-dim)]"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1" :class="task.done && 'line-through'">{{ task.label }}</span>
      </li>
    </ul>
  </div>
</template>
