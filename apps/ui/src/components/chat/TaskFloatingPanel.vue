<script setup lang="ts">
import { ChevronDown, ListChecks } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { useSessionInfoStore } from "@/stores/session-info";

/**
 * 任务悬浮面板：Agent 建立任务清单后悬浮在右下角，运行中常驻、可折叠。
 */
const chatStore = useChatStore();
const sessionInfo = useSessionInfoStore();
const { activeTasks, doneCount } = storeToRefs(sessionInfo);
const collapsed = ref(false);

const visible = computed(() => chatStore.isRunning && activeTasks.value.length > 0);
const progress = computed(() =>
  activeTasks.value.length
    ? Math.round((doneCount.value / activeTasks.value.length) * 100)
    : 0,
);
</script>

<template>
  <div
    v-if="visible"
    class="fixed bottom-4 right-4 z-[var(--z-overlay)] w-[248px] overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] shadow-[var(--shadow-pop)]"
    role="region"
    aria-label="任务清单"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <ListChecks :size="14" class="flex-none text-[var(--color-accent)]" />
      <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-txt-strong)]">
        任务清单
        <span class="ml-1 font-normal text-[var(--color-mut)]">{{ doneCount }}/{{ activeTasks.length }}</span>
      </span>
      <span class="flex-none text-[11px] tabular-nums text-[var(--color-dim)]">{{ progress }}%</span>
      <ChevronDown
        :size="14"
        :class="
          cn('flex-none text-[var(--color-dim)] transition-transform', collapsed && '-rotate-90')
        "
      />
    </button>
    <div v-if="!collapsed" class="h-1 bg-[var(--color-chip-bg)]">
      <div
        class="h-full bg-[var(--color-accent)] transition-[width] duration-300"
        :style="{ width: `${progress}%` }"
      />
    </div>
    <ul v-if="!collapsed" class="max-h-[220px] overflow-auto px-3 pb-2.5 pt-1">
      <li
        v-for="task in activeTasks"
        :key="task.id"
        class="flex items-start gap-2 py-1 text-[12px] leading-snug"
      >
        <span
          class="mt-[5px] grid size-3.5 flex-none place-items-center rounded-full border"
          :class="
            task.done
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
              : 'border-[var(--color-line-strong)]'
          "
          aria-hidden="true"
        >
          <span v-if="task.done" class="size-1.5 rounded-full bg-[var(--color-accent-fg)]" />
        </span>
        <span
          :class="
            task.done
              ? 'text-[var(--color-dim)] line-through'
              : 'text-[var(--color-txt)]'
          "
        >
          {{ task.label }}
        </span>
      </li>
    </ul>
  </div>
</template>
