<script setup lang="ts">
import { Ban, Check, ChevronRight, Hourglass, Loader2, Pause, X } from "@lucide/vue";
import { computed, ref } from "vue";

import { toolDisplay, toolStateLabel, toolStatusLine } from "@/components/chat/tool-part";
import ToolResultView from "@/components/chat/ToolResultView.vue";
import { codeLines, toolResult, toolResultState } from "@/components/chat/tool-result";
import FileLabel from "@/components/files/FileLabel.vue";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRightPanelStore } from "@/stores/right-panel";

import type { ToolPart } from "@/components/chat/tool-part";

const props = defineProps<{ part: ToolPart }>();

const rightPanel = useRightPanelStore();
const open = ref(false);
const display = computed(() => toolDisplay(props.part.toolName, props.part.args));
const result = computed(() => toolResult(props.part));
const state = computed(() => toolResultState(props.part));
const preparing = computed(() => props.part.state === "input-streaming");
const awaitingApproval = computed(() => props.part.state === "awaiting-approval");
const running = computed(() => props.part.state === "running");
const hasDetails = computed(() => result.value !== null);
const statusLabel = computed(() => toolStateLabel(state.value, props.part.percent));
const statusText = computed(() => toolStatusLine({ ...props.part, state: state.value }));
const readRange = computed(() => {
  if (props.part.toolName !== "readFile" || result.value?.kind !== "code") return "";
  const count = codeLines(result.value.text).length;
  return count ? (count === 1 ? "L1" : `L1-L${count}`) : "空文件";
});

function revealFile() {
  const target = display.value.target;
  if ((target?.kind === "file" || target?.kind === "dir") && target.text) {
    rightPanel.revealFile(target.text);
  }
}
</script>

<template>
  <Collapsible v-model:open="open" class="tool-row-wrap">
    <div class="tool-row" :data-state="state">
      <CollapsibleTrigger
        class="tool-action"
        :disabled="!hasDetails"
        :aria-label="`${display.label}${hasDetails ? (open ? '，收起结果' : '，查看结果') : ''}`"
      >
        <ChevronRight v-if="hasDetails" class="size-3 shrink-0" :class="{ 'rotate-90': open }" aria-hidden="true" />
        <component :is="display.icon" class="size-3.5 shrink-0" aria-hidden="true" />
        <span>{{ display.label }}</span>
      </CollapsibleTrigger>

      <Button
        v-if="(display.target?.kind === 'file' || display.target?.kind === 'dir') && display.target.text"
        variant="link"
        class="tool-file-target"
        :title="display.target.text"
        @click="revealFile"
      >
        <FileLabel
          :path="display.target.text"
          :name="display.target.text"
          :kind="display.target.kind === 'dir' ? 'directory' : 'file'"
          variant="link"
          class="tool-file-path"
        />
      </Button>
      <span v-else-if="display.target?.text && part.toolName !== 'runTerminal'" class="tool-target" :title="display.target.text">
        {{ display.target.text }}
      </span>

      <span v-if="readRange" class="tool-range">{{ readRange }}</span>
      <span class="tool-state" :data-state="state" :title="statusText">
        <Loader2 v-if="preparing || running" class="size-3.5 animate-spin" aria-hidden="true" />
        <Hourglass v-else-if="awaitingApproval" class="size-3.5" aria-hidden="true" />
        <Check v-else-if="state === 'ok'" class="size-3.5" aria-hidden="true" />
        <Ban v-else-if="state === 'denied'" class="size-3.5" aria-hidden="true" />
        <Pause v-else-if="state === 'cancelled' || state === 'interrupted'" class="size-3.5" aria-hidden="true" />
        <X v-else class="size-3.5" aria-hidden="true" />
        <span>{{ statusLabel }}</span>
      </span>
    </div>

    <CollapsibleContent v-if="result">
      <ToolResultView :result="result" />
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
.tool-row-wrap {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.tool-row {
  display: flex;
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 3px 0;
  font-size: 12px;
}

.tool-action {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 5px;
  padding: 0;
  text-align: left;
  color: var(--color-mut);
  cursor: pointer;
}

.tool-action span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tool-action:hover {
  color: var(--color-txt-strong);
}

.tool-action:disabled {
  cursor: default;
}

.tool-file-target {
  height: auto;
  min-width: 0;
  max-width: 100%;
  flex-shrink: 1;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: inherit;
  font-weight: inherit;
  text-decoration: none;
}

.tool-file-path {
  max-width: min(520px, 100%);
  overflow: hidden;
  color: var(--color-mut);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-target {
  max-width: min(320px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-mut);
  font-size: 11px;
}

.tool-state {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--color-mut);
}

.tool-range {
  color: var(--color-dim);
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-state[data-state="input-streaming"],
.tool-state[data-state="running"],
.tool-state[data-state="awaiting-approval"] {
  color: var(--color-accent);
}

.tool-state[data-state="ok"] {
  color: var(--color-ok);
}

.tool-state[data-state="error"] {
  color: var(--color-err);
}

.tool-state[data-state="denied"] {
  color: var(--color-accent-2);
}

</style>
