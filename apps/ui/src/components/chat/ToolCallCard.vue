<script setup lang="ts">
import { Ban, Check, ChevronDown, FileText, Hourglass, Loader2, Pause, X } from "@lucide/vue";
import { computed, ref } from "vue";

import {
  formatToolDetailSections,
  toolDisplay,
  toolStateLabel,
  toolStatusLine,
} from "@/components/chat/tool-part";
import { useRightPanelStore } from "@/stores/right-panel";
import { cn } from "@/lib/utils";

import type { ToolCallMessageMeta, ToolCallState } from "@zen/shared";

const props = defineProps<{
  meta: ToolCallMessageMeta;
  content?: string;
}>();

const rightPanel = useRightPanelStore();
const expanded = ref(false);

const state = computed<ToolCallState>(() => props.meta.state ?? (props.meta.ok ? "ok" : "error"));
const display = computed(() => toolDisplay(props.meta.toolName, props.meta.args));
const statusLabel = computed(() => toolStateLabel(state.value, props.meta.percent));
const statusLine = computed(() =>
  toolStatusLine({
    state: state.value,
    message: props.meta.message,
    error:
      state.value === "denied" || state.value === "error"
        ? props.meta.summary || props.content
        : undefined,
    summary: props.meta.summary || props.content,
  }),
);
const targetText = computed(() => display.value.target?.text || "");
const isFileTarget = computed(() => display.value.target?.kind === "file" && Boolean(targetText.value));
const statusIcon = computed(() => {
  if (state.value === "input-streaming" || state.value === "running") return Loader2;
  if (state.value === "awaiting-approval") return Hourglass;
  if (state.value === "ok") return Check;
  if (state.value === "denied") return Ban;
  if (state.value === "cancelled" || state.value === "interrupted") return Pause;
  return X;
});
const stateClass = computed(() => {
  if (state.value === "ok") return "text-[var(--color-ok)]";
  if (state.value === "error") return "text-[var(--color-danger-fg)]";
  if (state.value === "denied") return "text-[var(--color-accent-2)]";
  if (
    state.value === "input-streaming" ||
    state.value === "running" ||
    state.value === "awaiting-approval"
  ) {
    return "text-[var(--color-accent)]";
  }
  return "text-[var(--color-mut)]";
});
const rowClass = computed(() => {
  if (state.value === "error") {
    return "border-l-[var(--color-err)] bg-[color-mix(in_srgb,var(--color-danger-bg)_34%,transparent)]";
  }
  if (state.value === "denied") {
    return "border-l-[var(--color-accent-2)] bg-[color-mix(in_srgb,var(--color-accent-2)_8%,transparent)]";
  }
  if (
    state.value === "cancelled" ||
    state.value === "interrupted" ||
    state.value === "awaiting-approval"
  ) {
    return "border-l-[var(--color-dim)] bg-[var(--color-side)]";
  }
  return "border-l-transparent";
});

const detailText = computed(() => {
  const failed =
    state.value === "error" ||
    state.value === "denied" ||
    state.value === "cancelled" ||
    state.value === "interrupted";
  return (
    formatToolDetailSections({
      args: props.meta.args,
      error: failed ? props.meta.summary || props.content || statusLine.value : undefined,
      output: props.meta.output,
      message: props.meta.message,
      percent: props.meta.percent,
    }) || props.content ||
    ""
  );
});

function toggleDetails() {
  if (detailText.value) {
    expanded.value = !expanded.value;
  }
}

function revealFile() {
  const path = display.value.target?.text;
  if (display.value.target?.kind === "file" && path) {
    rightPanel.revealFile(path);
  }
}
</script>

<template>
  <div
    class="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] border-l-2 bg-[var(--color-side-glass)]"
    :class="rowClass"
  >
    <!-- 兄弟控件行：动作可展开详情，文件目标独立可点，避免嵌套 button -->
    <div class="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
      <button
        type="button"
        class="flex min-w-0 flex-none items-center gap-2 text-left"
        :aria-expanded="detailText ? expanded : undefined"
        :aria-label="`${display.label}${detailText ? (expanded ? '，收起详情' : '，展开详情') : ''}`"
        @click="toggleDetails"
      >
        <component :is="display.icon" :size="14" class="flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span class="flex-none text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ display.label }}
        </span>
      </button>

      <button
        v-if="isFileTarget"
        type="button"
        class="flex min-w-0 max-w-[40%] items-center gap-1 rounded-md border border-[var(--color-line)] px-1.5 py-0.5 text-left font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-txt-strong)]"
        :title="`在右侧面板查看 ${targetText}`"
        @click="revealFile"
      >
        <FileText class="size-3 shrink-0" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ targetText }}</span>
      </button>
      <span
        v-else-if="targetText"
        class="min-w-0 max-w-[40%] truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
        :title="targetText"
      >
        {{ targetText }}
      </span>

      <span class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-dim)]" :title="statusLine">
        {{ statusLine }}
      </span>

      <span
        class="flex-none inline-flex items-center gap-1 text-[11px]"
        :class="stateClass"
        :aria-label="statusLabel"
      >
        <component
          :is="statusIcon"
          :size="13"
          :class="cn(state === 'input-streaming' || state === 'running' ? 'animate-spin' : '')"
        />
        {{ statusLabel }}
      </span>

      <span
        v-if="detailText"
        class="flex size-5 flex-none items-center justify-center text-[var(--color-dim)]"
        aria-hidden="true"
      >
        <ChevronDown
          :size="13"
          :class="cn('transition-transform duration-[var(--motion-fast)]', expanded && 'rotate-180')"
        />
      </span>
    </div>

    <pre
      v-if="expanded && detailText"
      class="m-0 max-h-64 overflow-auto border-t border-[var(--color-line-soft)] bg-[var(--color-code-bg)] px-2.5 py-2 font-[family-name:var(--font-mono)] text-[11px] leading-normal whitespace-pre-wrap break-words text-[var(--color-code-fg)]"
    >{{ detailText }}</pre>
  </div>
</template>
