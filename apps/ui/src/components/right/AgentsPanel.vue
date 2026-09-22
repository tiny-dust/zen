<script setup lang="ts">
import { Bot, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import { SUB_AGENT_STATUS_META, useAgentsStore } from "@/stores/agents";

import type { AgentNode } from "@/stores/agents";
import type { SubAgentStatus } from "@zen/shared";

/**
 * 右栏 Agents 面板：左侧子 Agent 列表 + 右侧该 Agent 的消息时间线
 * （任务 → 过程日志 → 结果/错误）。由悬浮信息卡「子 Agent」点击进入。
 */
const agentsStore = useAgentsStore();
const { nodes, root, selected, selectedId, limit, running } = storeToRefs(agentsStore);

const listItems = computed(() => {
  const items: Array<{
    id: string;
    name: string;
    status: SubAgentStatus;
    task: string;
    depth: number;
    attempts: string;
  }> = [];
  if (root.value) {
    items.push({
      id: root.value.id,
      name: root.value.name,
      status: root.value.status,
      task: root.value.task,
      depth: 0,
      attempts: "",
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
    });
  }
  return items;
});

/** 选中 Agent 的消息流：任务 → 日志 → 结果/错误 */
const messages = computed(() => {
  const node: AgentNode | null = selected.value;
  if (!node) {
    return [];
  }
  const rows: Array<{ key: string; kind: "task" | "log" | "result" | "error"; text: string; time?: number }> =
    [];
  if (node.task) {
    rows.push({ key: "task", kind: "task", text: node.task });
  }
  for (const line of node.log) {
    rows.push({ key: `log-${line.t}-${line.text.slice(0, 24)}`, kind: "log", text: line.text, time: line.t });
  }
  if (node.result) {
    rows.push({ key: "result", kind: "result", text: node.result });
  }
  if (node.error) {
    rows.push({ key: "error", kind: "error", text: node.error });
  }
  return rows;
});

function meta(status: SubAgentStatus) {
  return SUB_AGENT_STATUS_META[status] ?? SUB_AGENT_STATUS_META.queued;
}

function timeLabel(t?: number) {
  if (!t) {
    return "";
  }
  const date = new Date(t);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2" aria-label="Agent 消息">
    <div class="flex items-center gap-2 px-1 text-[12px] text-[var(--color-mut)]">
      <Bot class="size-3.5" aria-hidden="true" />
      <span>子 Agent 消息</span>
      <span class="tabular-nums text-[11px] text-[var(--color-dim)]">
        并发 {{ running }}/{{ limit }}
      </span>
    </div>

    <div class="flex min-h-0 flex-1 gap-2">
      <div class="w-[42%] min-w-[140px] overflow-auto rounded-xl border border-[var(--color-line-soft)]">
        <p v-if="!listItems.length" class="m-0 px-3 py-4 text-[12px] text-[var(--color-dim)]">
          暂无子 Agent。
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
              :style="{ paddingLeft: `${8 + item.depth * 12}px` }"
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
                  <span class="truncate text-[12px] text-[var(--color-txt-strong)]">{{ item.name }}</span>
                  <span v-if="item.attempts" class="text-[10px] text-[var(--color-dim)]">{{ item.attempts }}</span>
                </span>
                <span class="mt-0.5 block truncate text-[10.5px] text-[var(--color-mut)]">
                  {{ meta(item.status).label }}
                </span>
              </span>
            </Button>
          </li>
        </ul>
      </div>

      <div
        class="min-w-0 flex-1 overflow-auto rounded-xl border border-[var(--color-line-soft)] p-2.5"
        aria-label="Agent 消息流"
      >
        <p v-if="!selected" class="m-0 px-1 py-3 text-[12px] text-[var(--color-dim)]">
          点击左侧子 Agent 查看消息。
        </p>
        <template v-else>
          <div class="mb-2 flex items-center gap-2 border-b border-[var(--color-line-soft)] pb-2">
            <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ selected.name }}
            </span>
            <span class="flex-none text-[11px]" :class="meta(selected.status).cls">
              {{ meta(selected.status).label }}
            </span>
          </div>

          <div v-if="!messages.length" class="px-1 py-3 text-[12px] text-[var(--color-dim)]">
            暂无消息。
          </div>
          <div v-else class="flex flex-col gap-2">
            <div v-for="row in messages" :key="row.key" class="flex flex-col gap-0.5">
              <div class="flex items-baseline gap-1.5">
                <span
                  class="text-[10.5px] font-medium"
                  :class="
                    row.kind === 'error'
                      ? 'text-[var(--color-err,#c45c5c)]'
                      : row.kind === 'result'
                        ? 'text-[var(--color-ok,#3d9a6a)]'
                        : 'text-[var(--color-dim)]'
                  "
                >
                  {{ row.kind === "task" ? "任务" : row.kind === "log" ? "日志" : row.kind === "result" ? "结果" : "错误" }}
                </span>
                <span v-if="row.time" class="font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]">
                  {{ timeLabel(row.time) }}
                </span>
              </div>
              <pre
                v-if="row.kind === 'result' || row.kind === 'error'"
                class="m-0 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-np-btn-bg)] p-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]"
              >{{ row.text }}</pre>
              <p
                v-else
                class="m-0 text-[11.5px] leading-relaxed"
                :class="row.kind === 'task' ? 'text-[var(--color-txt)]' : 'truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-mut)]'"
                :title="row.text"
              >
                {{ row.text }}
              </p>
            </div>
          </div>

          <p
            v-if="selected.busyResource === 'terminal'"
            class="m-0 mt-2 flex items-center gap-1 text-[11px] text-[var(--color-mut)]"
          >
            <SquareTerminal class="size-3" aria-hidden="true" />
            占用终端资源
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
