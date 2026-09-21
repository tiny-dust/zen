<script setup lang="ts">
import { Bot, ChevronDown, ChevronRight } from "@lucide/vue";
import { ref } from "vue";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { SUB_AGENT_STATUS_META, useAgentsStore } from "@/stores/agents";

import type { AgentNode } from "@/stores/agents";
import type { SubAgentStatus } from "@zen/shared";

/**
 * 会话信息悬浮窗「子 Agent」节：主 Agent 派发的子 Agent 全量罗列，
 * 点击一行展开该 Agent 的任务、结果与日志详情。
 */
const agentsStore = useAgentsStore();
const open = ref(true);
/** 当前展开详情的子 Agent id（手风琴，同一时间只展开一条） */
const expandedId = ref("");

const nodes = agentsStore.nodes;

function meta(status: SubAgentStatus) {
  return SUB_AGENT_STATUS_META[status] ?? SUB_AGENT_STATUS_META.queued;
}

function toggleDetail(node: AgentNode) {
  expandedId.value = expandedId.value === node.id ? "" : node.id;
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
      <div
        v-for="node in nodes"
        :key="node.id"
        class="overflow-hidden rounded-[var(--radius-sm)]"
        :class="expandedId === node.id ? 'bg-[var(--color-np-btn-bg)]' : ''"
      >
        <Button
          variant="ghost"
          class="h-auto min-h-7 w-full justify-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left font-normal hover:bg-[var(--color-menu-hover)]"
          :aria-expanded="expandedId === node.id"
          @click="toggleDetail(node)"
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
          <span class="flex-none text-[10.5px] text-[var(--color-mut)]">
            {{ meta(node.status).label }}
          </span>
          <component
            :is="expandedId === node.id ? ChevronDown : ChevronRight"
            class="size-3 flex-none text-[var(--color-dim)]"
            aria-hidden="true"
          />
        </Button>

        <div v-if="expandedId === node.id" class="flex flex-col gap-1 px-2 pb-2">
          <p class="m-0 text-[11.5px] leading-relaxed text-[var(--color-mut)]">{{ node.task }}</p>
          <p v-if="extraLine(node)" class="m-0 text-[10.5px] text-[var(--color-dim)]">
            {{ extraLine(node) }}
          </p>
          <p v-if="node.dependsOn.length" class="m-0 text-[10.5px] text-[var(--color-dim)]">
            依赖：{{ node.dependsOn.join("、") }}
          </p>
          <p v-if="node.error" class="m-0 text-[11.5px] text-[var(--color-err,#c45c5c)]">
            {{ node.error }}
          </p>
          <pre
            v-if="node.result"
            class="m-0 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-np-btn-bg)] p-2 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-txt)]"
          >{{ node.result }}</pre>
          <div v-if="node.log.length" class="flex flex-col gap-0.5">
            <p class="m-0 text-[10.5px] font-medium text-[var(--color-dim)]">日志</p>
            <p
              v-for="(line, index) in node.log.slice(-6)"
              :key="index"
              class="m-0 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-mut)]"
              :title="line.text"
            >
              {{ line.text }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
