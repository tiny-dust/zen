<script setup lang="ts">
import { Bot, MessageCircleQuestion, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";

import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import ToolCallGroup from "@/components/chat/ToolCallGroup.vue";
import { SUB_AGENT_STATUS_META, useAgentsStore } from "@/stores/agents";

import type { AgentNode } from "@/stores/agents";
import type { AgentTranscriptEntry, ChatMessagePart, ToolCallState } from "@zen/shared";

/**
 * 右栏 Agents 面板：全宽展示所选子 Agent 的消息流，渲染组件与主信息流一致
 * （正文 markdown / 思考块 / 工具卡 / 用户气泡）。悬浮信息卡点击子 Agent 直达，
 * 顶部只保留一条紧凑切换条用于在多个子 Agent 之间换人，不再有二级列表页。
 */
const agentsStore = useAgentsStore();
const { nodes, selected, selectedId, running, limit } = storeToRefs(agentsStore);

/** 未选中或选中项已消失时自动落到首个活跃节点（否则第一个） */
watch(
  [nodes, selectedId],
  () => {
    if (selectedId.value && nodes.value.some((item) => item.id === selectedId.value)) {
      return;
    }
    const active =
      nodes.value.find((item) => item.status === "running" || item.status === "waiting_user") ??
      nodes.value[0];
    selectedId.value = active?.id ?? "";
  },
  { immediate: true },
);

function meta(status: SubAgentStatusLike) {
  return SUB_AGENT_STATUS_META[status] ?? SUB_AGENT_STATUS_META.queued;
}

type SubAgentStatusLike = AgentNode["status"];

type RowKind = "task" | "text" | "reasoning" | "tool" | "ask" | "error" | "system" | "result";

interface Row {
  key: string;
  kind: RowKind;
  text: string;
  time?: number;
  toolName?: string;
  state?: ToolCallState;
  args?: unknown;
  output?: string;
  summary?: string;
}

/** transcript 条目 → 展示行（工具行保留结构化字段，供分组渲染工具卡） */
function entryRow(entry: AgentTranscriptEntry): Row {
  return {
    key: entry.id,
    kind: entry.kind,
    text: entry.text,
    time: entry.t,
    toolName: entry.toolName,
    state: entry.state,
    args: entry.args,
    output: entry.output,
    summary: entry.summary,
  };
}

/** 选中 Agent 的消息流：任务 → transcript（按时间合并运行日志）→ 结果/错误 */
const rows = computed<Row[]>(() => {
  const node: AgentNode | null = selected.value;
  if (!node) {
    return [];
  }
  const list: Row[] = [];
  if (node.task) {
    list.push({ key: "task", kind: "task", text: node.task });
  }
  const merged: Array<{ t: number; row: Row }> = [
    ...(node.transcript ?? []).map((entry) => ({ t: entry.t, row: entryRow(entry) })),
    ...node.log.map((line) => ({
      t: line.t,
      row: {
        key: `log-${line.t}-${line.text.slice(0, 24)}`,
        kind: "system" as const,
        text: line.text,
        time: line.t,
      },
    })),
  ];
  merged.sort((a, b) => a.t - b.t);
  list.push(...merged.map((item) => item.row));
  if (node.result) {
    list.push({ key: "result", kind: "result", text: node.result });
  }
  if (node.error) {
    list.push({ key: "error", kind: "error", text: node.error });
  }
  return list;
});

/**
 * 展示分段：正文/思考按 parts 渲染（与主信息流同构），连续工具行合并为一组工具卡。
 */
interface Segment {
  key: string;
  kind: "text" | "reasoning" | "ask" | "error" | "result" | "system" | "tools";
  text: string;
  parts?: ChatMessagePart[];
}

const FAILED_STATES: ReadonlySet<ToolCallState> = new Set(["error", "denied", "cancelled", "interrupted"]);

function toolPartOf(row: Row): ChatMessagePart {
  const failed = row.state ? FAILED_STATES.has(row.state) : false;
  return {
    type: "tool",
    toolCallId: row.key,
    toolName: row.toolName ?? "tool",
    state: row.state ?? "ok",
    args: row.args,
    summary: row.summary || row.text,
    error: failed ? row.summary || row.text : undefined,
    output: row.output,
  };
}

const segments = computed<Segment[]>(() => {
  const list: Segment[] = [];
  for (const row of rows.value) {
    if (row.kind === "tool") {
      const previous = list.at(-1);
      if (previous?.kind === "tools") {
        previous.parts?.push(toolPartOf(row));
      } else {
        list.push({ key: row.key, kind: "tools", text: "", parts: [toolPartOf(row)] });
      }
      continue;
    }
    if (row.kind === "text") {
      // 正文累计展示由 Response 组件承接：保持一条一段，key 用条目 id
      list.push({ key: row.key, kind: "text", text: row.text });
      continue;
    }
    if (row.kind === "reasoning") {
      list.push({ key: row.key, kind: "reasoning", text: row.text });
      continue;
    }
    if (row.kind === "task" || row.kind === "ask") {
      list.push({ key: row.key, kind: "ask", text: row.text });
      continue;
    }
    list.push({ key: row.key, kind: row.kind, text: row.text });
  }
  return list;
});

function kindLabel(row: Row): string {
  switch (row.kind) {
    case "result":
      return "结果";
    case "error":
      return "错误";
    default:
      return "";
  }
}

const segmentKindLabel = (kind: "result" | "error") =>
  kindLabel({ key: "", kind, text: "" } as Row);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2" aria-label="Agent 消息">
    <!-- 顶部：选中 Agent 状态 + 紧凑切换条（替代原二级列表，点击直达消息流） -->
    <div class="flex flex-none items-center gap-2 px-1 text-[12px] text-[var(--color-mut)]">
      <Bot class="size-3.5" aria-hidden="true" />
      <span v-if="selected" class="min-w-0 truncate font-medium text-[var(--color-txt-strong)]">
        {{ selected.name }}
      </span>
      <span v-if="selected" class="flex-none" :class="meta(selected.status).cls">
        {{ meta(selected.status).label }}
      </span>
      <span class="ml-auto flex-none tabular-nums text-[11px] text-[var(--color-dim)]">
        并发 {{ running }}/{{ limit }}
      </span>
    </div>

    <div
      v-if="nodes.length > 1"
      class="flex flex-none gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]"
      role="tablist"
      aria-label="切换子 Agent"
    >
      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        role="tab"
        :aria-selected="node.id === selectedId"
        class="flex h-6 flex-none items-center gap-1 rounded-full px-2 text-[11px] font-normal transition-colors"
        :class="
          node.id === selectedId
            ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]'
            : 'text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]'
        "
        @click="agentsStore.select(node.id)"
      >
        <component
          :is="meta(node.status).icon"
          class="size-3 flex-none"
          :class="[meta(node.status).cls, node.status === 'running' ? 'animate-spin' : '']"
          aria-hidden="true"
        />
        <span class="max-w-[160px] truncate">{{ node.name }}</span>
      </button>
    </div>

    <!-- 全宽消息流：与主信息流同构（markdown 正文 / 思考块 / 工具卡 / 右对齐问询气泡） -->
    <div
      class="min-h-0 flex-1 overflow-auto px-1"
      aria-label="Agent 消息流"
    >
      <p v-if="!selected" class="m-0 px-1 py-3 text-[12px] text-[var(--color-dim)]">
        暂无子 Agent 消息。
      </p>
      <div v-else class="mx-auto flex w-full flex-col gap-4">
        <template v-for="seg in segments" :key="seg.key">
          <!-- 工具组：与主信息流同一张工具卡 -->
          <ToolCallGroup v-if="seg.kind === 'tools'" :tools="(seg.parts ?? []) as never" />

          <!-- 正文：与助手气泡相同的 markdown 渲染 -->
          <Response
            v-else-if="seg.kind === 'text'"
            :content="seg.text"
            class="md-content w-full min-w-0 max-w-full"
          />

          <!-- 思考：与主信息流同款折叠块 -->
          <Reasoning v-else-if="seg.kind === 'reasoning'" class="w-full min-w-0 max-w-full" :is-streaming="false">
            <ReasoningTrigger class="w-fit max-w-full text-[12px]" />
            <ReasoningContent :content="seg.text" class="mt-2 min-w-0 text-[12px] reasoning-dim" />
          </Reasoning>

          <!-- 任务 / 问询：右对齐用户气泡样式 -->
          <div v-else-if="seg.kind === 'ask'" class="flex w-full justify-end">
            <div
              class="flex max-w-[min(760px,85%)] items-start gap-1.5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-side-sel)] px-3.5 py-2 text-[13px] text-[var(--color-txt-strong)]"
            >
              <MessageCircleQuestion
                v-if="seg.key !== 'task'"
                class="mt-0.5 size-3.5 flex-none text-[var(--color-accent)]"
                aria-hidden="true"
              />
              <span class="min-w-0 whitespace-pre-wrap break-words">{{ seg.text }}</span>
            </div>
          </div>

          <!-- 结果 / 错误 / 运行日志 -->
          <div v-else class="w-fit min-w-0 max-w-[min(100%,72ch)]">
            <div
              v-if="seg.kind === 'result' || seg.kind === 'error'"
              class="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px]"
              :class="
                seg.kind === 'error'
                  ? 'bg-[var(--color-notice-danger-bg)] text-[var(--color-danger-fg)]'
                  : 'border border-[var(--color-line-soft)] bg-[var(--color-side)] text-[var(--color-ok,#3d9a6a)]'
              "
              :role="seg.kind === 'error' ? 'alert' : 'status'"
            >
              <span class="flex-none font-medium">{{ segmentKindLabel(seg.kind === 'error' ? 'error' : 'result') }}</span>
              <span class="min-w-0 whitespace-pre-wrap break-words">{{ seg.text }}</span>
            </div>
            <p
              v-else
              class="m-0 truncate px-1 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-dim)]"
              :title="seg.text"
            >
              {{ seg.text }}
            </p>
          </div>
        </template>

        <p
          v-if="selected.busyResource === 'terminal'"
          class="m-0 flex items-center gap-1 text-[11px] text-[var(--color-mut)]"
        >
          <SquareTerminal class="size-3" aria-hidden="true" />
          占用终端资源
        </p>
      </div>
    </div>
  </div>
</template>
