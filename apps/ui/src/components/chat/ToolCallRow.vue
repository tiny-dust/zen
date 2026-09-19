<script setup lang="ts">
import { Ban, Check, ChevronDown, FileText, FolderOpen, Hourglass, Loader2, Pause, X } from "@lucide/vue";
import { computed, ref } from "vue";

import {
  formatToolDetailSections,
  toolDisplay,
  toolStateLabel,
  toolStatusLine,
} from "@/components/chat/tool-part";
import { useRightPanelStore } from "@/stores/right-panel";

import type { ToolPart } from "@/components/chat/tool-part";

const props = defineProps<{ part: ToolPart }>();

const rightPanel = useRightPanelStore();
const open = ref(false);

const display = computed(() => toolDisplay(props.part.toolName, props.part.args));
const preparing = computed(() => props.part.state === "input-streaming");
const awaitingApproval = computed(() => props.part.state === "awaiting-approval");
const running = computed(() => props.part.state === "running");
const hasDetails = computed(() => Boolean(detailText.value));
const statusLabel = computed(() => toolStateLabel(props.part.state, props.part.percent));
const statusText = computed(() => toolStatusLine(props.part));
const detailText = computed(() =>
  formatToolDetailSections({
    args: props.part.args,
    error: props.part.error,
    output: props.part.output,
    message: props.part.message,
    percent: props.part.percent,
  }),
);

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  const lines = text.split("\n");
  while (lines.length && lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  return lines.length;
}

function argString(keys: string[]): string {
  if (typeof props.part.args !== "object" || props.part.args === null) {
    return "";
  }
  const record = props.part.args as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

/** 按入参估算的改动行数摘要，不是 git diff；仅成功态展示 */
const diffStat = computed<{ added: number; removed: number } | null>(() => {
  if (props.part.state !== "ok") {
    return null;
  }
  if (props.part.toolName === "editFile") {
    return {
      added: countLines(argString(["newString", "new_string", "newText"])),
      removed: countLines(argString(["oldString", "old_string", "oldText"])),
    };
  }
  if (props.part.toolName === "writeFile") {
    return { added: countLines(argString(["content", "text"])), removed: 0 };
  }
  return null;
});

function revealFile() {
  const path = display.value.target?.text;
  if (display.value.target?.kind === "file" && path) {
    rightPanel.revealFile(path);
  }
}

function toggleDetails() {
  if (hasDetails.value) {
    open.value = !open.value;
  }
}
</script>

<template>
  <div class="tool-row-wrap">
    <div
      class="tool-row"
      :class="{
        'tool-row-error': part.state === 'error',
        'tool-row-denied': part.state === 'denied',
        'tool-row-warn': part.state === 'cancelled' || part.state === 'interrupted' || part.state === 'awaiting-approval',
      }"
    >
      <button
        type="button"
        class="tool-action"
        :aria-label="`${display.label}${hasDetails ? (open ? '，收起详情' : '，展开详情') : ''}`"
        :aria-expanded="hasDetails ? open : undefined"
        @click="toggleDetails"
      >
        <span class="tool-action-icon" :class="{ 'tool-action-icon-active': preparing || running || awaitingApproval }">
          <component :is="display.icon" class="size-3.5" />
        </span>
        <span>{{ display.label }}</span>
      </button>

      <button
        v-if="display.target?.kind === 'file' && display.target.text"
        type="button"
        class="tool-target tool-target-file"
        :title="`在右侧面板查看 ${display.target.text}`"
        @click="revealFile"
      >
        <FileText class="size-3 shrink-0" />
        <span>{{ display.target.text }}</span>
      </button>
      <span v-else-if="display.target?.kind === 'dir' && display.target.text" class="tool-target">
        <FolderOpen class="size-3 shrink-0" />
        <span>{{ display.target.text }}</span>
      </span>
      <span v-else-if="display.target?.text" class="tool-target">
        <span>{{ display.target.text }}</span>
      </span>
      <span v-else class="tool-target tool-target-empty">无目标</span>

      <span class="tool-message" :title="statusText">{{ statusText }}</span>

      <span
        v-if="diffStat && (diffStat.added > 0 || diffStat.removed > 0)"
        class="tool-diff"
        title="按入参估算，不是 git diff"
      >
        <span v-if="diffStat.added > 0" class="tool-add">+{{ diffStat.added }}</span>
        <span v-if="diffStat.added > 0 && diffStat.removed > 0" class="mx-0.5" />
        <span v-if="diffStat.removed > 0" class="tool-remove">-{{ diffStat.removed }}</span>
      </span>

      <span class="tool-state" :class="`tool-state-${part.state}`">
        <Loader2 v-if="preparing || running" class="size-3.5 animate-spin" />
        <Hourglass v-else-if="awaitingApproval" class="size-3.5" />
        <Check v-else-if="part.state === 'ok'" class="size-3.5" />
        <Ban v-else-if="part.state === 'denied'" class="size-3.5" />
        <Pause v-else-if="part.state === 'cancelled' || part.state === 'interrupted'" class="size-3.5" />
        <X v-else class="size-3.5" />
        <span>{{ statusLabel }}</span>
      </span>

      <!-- 展开控件合并到动作按钮：chevron 仅作视觉指示 -->
      <span v-if="hasDetails" class="tool-details-toggle" aria-hidden="true">
        <ChevronDown class="size-3.5" :class="{ 'rotate-180': open }" />
      </span>
    </div>

    <pre v-if="open && detailText" class="tool-details">{{ detailText }}</pre>
  </div>
</template>

<style scoped>
.tool-row-wrap {
  width: 100%;
}

.tool-row {
  display: grid;
  grid-template-columns: minmax(112px, auto) minmax(120px, 1.3fr) minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 6px;
  border-left: 2px solid transparent;
  border-radius: var(--radius-sm);
}

.tool-row:hover {
  background: var(--color-menu-hover);
}

.tool-row-error {
  border-left-color: var(--color-err);
  background: color-mix(in srgb, var(--color-danger-bg) 34%, transparent);
}

.tool-row-denied {
  border-left-color: var(--color-accent-2);
  background: color-mix(in srgb, var(--color-accent-2) 8%, transparent);
}

.tool-row-warn {
  border-left-color: var(--color-dim);
  background: color-mix(in srgb, var(--color-side) 55%, transparent);
}

.tool-action,
.tool-target-file {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.tool-action {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
  padding: 0;
  text-align: left;
  font-size: 12px;
  color: var(--color-txt);
}

.tool-action-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--color-chip-bg);
  color: var(--color-mut);
}

.tool-action-icon-active {
  color: var(--color-accent);
}

.tool-target {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--color-mut);
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-target span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-target-file {
  min-width: 0;
  padding: 2px 5px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  text-align: left;
}

.tool-target-file:hover {
  border-color: var(--color-line-strong);
  color: var(--color-txt-strong);
}

.tool-target-empty {
  color: var(--color-dim);
}

.tool-message {
  min-width: 0;
  overflow: hidden;
  color: var(--color-dim);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-diff {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-add {
  color: var(--color-add);
}

.tool-remove {
  color: var(--color-del);
}

.tool-state {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  white-space: nowrap;
}

.tool-state-input-streaming,
.tool-state-running,
.tool-state-awaiting-approval {
  color: var(--color-accent);
}

.tool-state-ok {
  color: var(--color-ok);
}

.tool-state-error {
  color: var(--color-err);
}

.tool-state-denied {
  color: var(--color-accent-2);
}

.tool-state-cancelled,
.tool-state-interrupted {
  color: var(--color-mut);
}

.tool-details-toggle {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--color-dim);
}

.tool-details {
  max-height: 240px;
  margin: 4px 0 6px 27px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-code-bg);
  color: var(--color-code-fg);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 620px) {
  .tool-row {
    grid-template-columns: minmax(104px, auto) minmax(0, 1fr) auto auto;
    gap: 5px 8px;
  }

  .tool-target {
    grid-column: 2 / -1;
    grid-row: 2;
  }

  .tool-message {
    grid-column: 1 / -1;
    grid-row: 3;
    padding-left: 27px;
  }

  .tool-diff {
    grid-column: 1;
    grid-row: 2;
  }

  .tool-details-toggle {
    grid-column: 4;
    grid-row: 1;
  }

  .tool-state {
    grid-column: 3;
    grid-row: 1;
  }
}
</style>
