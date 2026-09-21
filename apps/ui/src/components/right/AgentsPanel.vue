<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import { SUB_AGENT_STATUS_META, useAgentsStore } from "@/stores/agents";

import type { SubAgentStatus } from "@zen/shared";

const agentsStore = useAgentsStore();
const { nodes, root, selected, selectedId, limit, running } = storeToRefs(agentsStore);

const listItems = computed(() => {
  const items: Array<{ id: string; name: string; status: SubAgentStatus; task: string; depth: number; attempts: string; dependsOn: string[] }> = [];
  if (root.value) {
    items.push({
      id: root.value.id,
      name: root.value.name,
      status: root.value.status,
      task: root.value.task,
      depth: 0,
      attempts: "",
      dependsOn: [],
    });
  }
  for (const node of nodes.value) {
    items.push({
      id: node.id,
      name: node.name,
      status: node.status,
      task: node.task,
      depth: 1,
      attempts: node.maxAttempts > 1 ? `${node.attempts}/${node.maxAttempts}` : "",
      dependsOn: node.dependsOn,
    });
  }
  return items;
});

function meta(status: SubAgentStatus) {
  return SUB_AGENT_STATUS_META[status] ?? SUB_AGENT_STATUS_META.queued;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2" aria-label="Agent 协作状态">
    <div class="flex items-center gap-2 px-1 text-[12px] text-[var(--color-mut)]">
      <Bot class="size-3.5" aria-hidden="true" />
      <span>多 Agent 协作</span>
      <span class="tabular-nums text-[11px] text-[var(--color-dim)]">
        并发 {{ running }}/{{ limit }}
      </span>
      <span v-if="nodes.some((n) => n.busyResource)" class="text-[11px] text-[var(--color-dim)]">
        · 独占资源串行中
      </span>
    </div>

    <div class="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-line-soft)]">
      <p v-if="!listItems.length" class="m-0 px-3 py-4 text-[12px] text-[var(--color-dim)]">
        暂无子 Agent。主 Agent 可通过 spawnAgent 拆分并行任务。
      </p>
      <ul v-else class="m-0 list-none p-1">
        <li v-for="item in listItems" :key="item.id">
          <Button
            variant="ghost"
            class="flex h-auto w-full items-start justify-start gap-2 rounded-lg px-2 py-1.5 text-left font-normal"
            :class="
              selectedId === item.id
                ? 'bg-[var(--color-menu-active)] hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]'
                : 'hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
            "
            :style="{ paddingLeft: `${8 + item.depth * 14}px` }"
            @click="agentsStore.select(item.id)"
          >
            <component
              :is="meta(item.status).icon"
              class="mt-0.5 size-3.5 flex-none"
              :class="[meta(item.status).cls, item.status === 'running' ? 'animate-spin' : '']"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5">
                <span class="truncate text-[12.5px] text-[var(--color-txt-strong)]">{{ item.name }}</span>
                <span v-if="item.attempts" class="text-[10.5px] text-[var(--color-dim)]">{{ item.attempts }}</span>
                <span class="text-[11px] text-[var(--color-mut)]">{{ meta(item.status).label }}</span>
              </span>
              <span class="mt-0.5 block truncate text-[11px] text-[var(--color-dim)]">{{ item.task }}</span>
            </span>
            <ChevronRight class="mt-0.5 size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </Button>
        </li>
      </ul>
    </div>

    <div
      v-if="selected"
      class="flex max-h-[42%] min-h-[120px] flex-col gap-1.5 overflow-auto rounded-xl border border-[var(--color-line-soft)] p-2.5"
    >
      <div class="flex items-center gap-2">
        <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">{{ selected.name }}</span>
        <span class="text-[11px]" :class="meta(selected.status).cls">{{ meta(selected.status).label }}</span>
      </div>
      <p class="m-0 text-[11.5px] leading-relaxed text-[var(--color-mut)]">{{ selected.task }}</p>
      <p v-if="selected.dependsOn.length" class="m-0 text-[11px] text-[var(--color-dim)]">
        依赖：{{ selected.dependsOn.join(", ") }}
      </p>
      <p v-if="selected.error" class="m-0 text-[11.5px] text-[var(--color-err,#c45c5c)]">
        {{ selected.error }}
      </p>
      <pre
        v-if="selected.result"
        class="m-0 max-h-[140px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-np-btn-bg)] p-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]"
      >{{ selected.result }}</pre>
      <div v-if="selected.log.length" class="flex flex-col gap-0.5">
        <p class="m-0 text-[11px] font-medium text-[var(--color-dim)]">日志</p>
        <p
          v-for="(line, index) in selected.log.slice(-12)"
          :key="index"
          class="m-0 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-mut)]"
        >
          {{ line.text }}
        </p>
      </div>
    </div>
  </div>
</template>
