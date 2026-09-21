<script setup lang="ts">
import { Circle, CircleCheck, ListChecks } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useSessionInfoStore } from "@/stores/session-info";
import { cn } from "@/lib/utils";

const sessionInfo = useSessionInfoStore();
const open = ref(true);
const tabsEl = ref<HTMLElement | null>(null);

const versions = computed(() => sessionInfo.versions);
const activeId = computed(() => sessionInfo.activeVersionId);
const tasks = computed(() => sessionInfo.activeTasks);
const doneCount = computed(() => sessionInfo.doneCount);

function select(id: string) {
  sessionInfo.activeVersionId = id;
}

watch(
  () => versions.value.length,
  () => {
    void requestAnimationFrame(() => {
      tabsEl.value?.scrollTo({ left: tabsEl.value.scrollWidth });
    });
  },
);
</script>

<template>
  <section class="flex flex-col">
    <SessionSectionHead
      :icon="ListChecks"
      title="任务清单"
      :open="open"
      :count="tasks.length ? `${doneCount}/${tasks.length}` : undefined"
      @toggle="open = !open"
    />

    <div v-if="open" class="mt-1 flex flex-col gap-1.5">
      <div
        v-if="versions.length > 1"
        ref="tabsEl"
        class="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]"
        role="tablist"
        aria-label="任务清单版本"
      >
        <Button
          v-for="item in versions"
          :key="item.id"
          variant="ghost"
          size="xs"
          role="tab"
          :aria-selected="item.id === activeId"
          :class="
            cn(
              'h-6 flex-none rounded-full px-2 text-[11px] font-normal',
              item.id === activeId
                ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-active)] hover:text-[var(--color-txt-strong)] dark:hover:bg-[var(--color-menu-active)]'
                : 'text-[var(--color-mut)] hover:bg-transparent hover:text-[var(--color-txt)] dark:hover:bg-transparent',
            )
          "
          @click="select(item.id)"
        >
          v{{ item.version }}
        </Button>
      </div>

      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <li
          v-for="task in tasks"
          :key="task.id"
          class="flex items-start gap-2 text-[12px] leading-snug"
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
          <span class="min-w-0 flex-1">{{ task.label }}</span>
        </li>
      </ul>

      <p v-if="!tasks.length" class="m-0 text-[12px] text-[var(--color-dim)]">暂无任务</p>
    </div>
  </section>
</template>
