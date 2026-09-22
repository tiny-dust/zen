<script setup lang="ts">
import { Bot, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref } from "vue";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { SUB_AGENT_STATUS_META, useAgentsStore } from "@/stores/agents";
import { useRightPanelStore } from "@/stores/right-panel";

import type { AgentNode } from "@/stores/agents";
import type { SubAgentStatus } from "@zen/shared";

/**
 * 会话信息悬浮窗「子 Agent」节：主 Agent 派发的子 Agent 全量罗列。
 * 点击一行在右栏 Agents 面板展示该 Agent 的消息（任务 / 日志 / 结果）。
 */
const agentsStore = useAgentsStore();
const rightPanel = useRightPanelStore();
const { nodes } = storeToRefs(agentsStore);
const open = ref(true);

function meta(status: SubAgentStatus) {
  return SUB_AGENT_STATUS_META[status] ?? SUB_AGENT_STATUS_META.queued;
}

function openMessages(node: AgentNode) {
  agentsStore.select(node.id);
  rightPanel.ensureTab("agents");
}

/** 独占资源 → 中文标签（busyResource 展示用） */
const BUSY_RESOURCE_LABELS: Record<"write" | "terminal" | "browser", string> = {
  write: "写文件",
  terminal: "终端",
  browser: "浏览器",
};

/** 状态行补充信息：尝试次数 / 独占资源 */
function extraLine(node: AgentNode): string {
  const parts: string[] = [];
  if (node.maxAttempts > 1) {
    parts.push(`第 ${node.attempts}/${node.maxAttempts} 次`);
  }
  if (node.busyResource) {
    parts.push(`占用${BUSY_RESOURCE_LABELS[node.busyResource]}资源`);
  }
  return parts.join(" · ");
}
</script>

<template>
  <!-- 无子 Agent 时整节隐藏（含空态文案），不再占一节位置 -->
  <section v-if="nodes.length" class="flex flex-col">
    <SessionSectionHead
      :icon="Bot"
      title="子 Agent"
      :open="open"
      :count="`${nodes.filter((item) => item.status === 'running').length}/${nodes.length}`"
      @toggle="open = !open"
    />

    <div v-if="open" class="mt-1 flex flex-col gap-1">
      <Button
        v-for="node in nodes"
        :key="node.id"
        variant="ghost"
        class="h-auto min-h-7 w-full justify-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left font-normal hover:bg-[var(--color-menu-hover)]"
        :title="`${node.task} · 在右栏查看消息`"
        @click="openMessages(node)"
      >
        <component
          :is="meta(node.status).icon"
          class="size-3.5 flex-none"
          :class="[meta(node.status).cls, node.status === 'running' ? 'animate-spin' : '']"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">
          {{ node.name }}
        </span>
        <span v-if="extraLine(node)" class="flex-none text-[10px] text-[var(--color-dim)]">
          {{ extraLine(node) }}
        </span>
        <span class="flex-none text-[10.5px] text-[var(--color-mut)]">
          {{ meta(node.status).label }}
        </span>
        <SquareTerminal
          v-if="node.busyResource === 'terminal'"
          class="size-3 flex-none text-[var(--color-dim)]"
          aria-hidden="true"
        />
      </Button>
    </div>
  </section>
</template>
