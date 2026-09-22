<script setup lang="ts">
import { ChevronDown, ChevronRight, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref } from "vue";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { PROCESS_STATUS_META, useAgentProcessesStore } from "@/stores/agent-processes";

import type { AgentProcessStatus } from "@/stores/agent-processes";

/**
 * 会话信息悬浮窗「进程」节：Agent runTerminal 调起的终端服务。
 * 运行中置顶展示状态；下方罗列全部历史进程，点击展开命令与输出。
 */
const processes = useAgentProcessesStore();
const { items, expandedId, runningCount } = storeToRefs(processes);
const open = ref(true);

function meta(status: AgentProcessStatus) {
  return PROCESS_STATUS_META[status] ?? PROCESS_STATUS_META.running;
}

/** 运行中的排前面，其余按开始时间倒序 */
function ordered() {
  return [...items.value].sort((a, b) => {
    const aRun = a.status === "running" ? 0 : 1;
    const bRun = b.status === "running" ? 0 : 1;
    if (aRun !== bRun) {
      return aRun - bRun;
    }
    return b.startedAt - a.startedAt;
  });
}
</script>

<template>
  <section v-if="items.length" class="flex flex-col">
    <SessionSectionHead
      :icon="SquareTerminal"
      title="进程"
      :open="open"
      :count="`${runningCount}/${items.length}`"
      @toggle="open = !open"
    />

    <div v-if="open" class="mt-1 flex flex-col gap-1">
      <div
        v-for="item in ordered()"
        :key="item.id"
        class="overflow-hidden rounded-[var(--radius-sm)]"
        :class="expandedId === item.id ? 'bg-[var(--color-np-btn-bg)]' : ''"
      >
        <Button
          variant="ghost"
          class="h-auto min-h-7 w-full justify-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left font-normal hover:bg-[var(--color-menu-hover)]"
          :aria-expanded="expandedId === item.id"
          @click="processes.toggle(item.id)"
        >
          <SquareTerminal class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--color-txt)]">
            {{ item.command || "(空命令)" }}
          </span>
          <span class="flex-none text-[10.5px]" :class="meta(item.status).cls">
            {{ meta(item.status).label }}
          </span>
          <component
            :is="expandedId === item.id ? ChevronDown : ChevronRight"
            class="size-3 flex-none text-[var(--color-dim)]"
            aria-hidden="true"
          />
        </Button>

        <div v-if="expandedId === item.id" class="flex flex-col gap-1 px-2 pb-2">
          <p v-if="item.summary" class="m-0 text-[11px] text-[var(--color-mut)]">{{ item.summary }}</p>
          <p v-if="item.error" class="m-0 text-[11px] text-[var(--color-err,#c45c5c)]">{{ item.error }}</p>
          <pre
            v-if="item.output"
            class="m-0 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-np-btn-bg)] p-2 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-txt)]"
          >{{ item.output }}</pre>
        </div>
      </div>
    </div>
  </section>
</template>
