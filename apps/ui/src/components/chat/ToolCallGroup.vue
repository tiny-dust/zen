<script setup lang="ts">
import { ChevronRight, ListChecks, Loader2 } from "@lucide/vue";
import { computed, ref } from "vue";

import { summarizeTools } from "@/components/chat/message-groups";
import ToolCallRow from "@/components/chat/ToolCallRow.vue";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import type { ToolPart } from "@/components/chat/tool-part";

const props = defineProps<{ tools: ToolPart[] }>();
const open = ref(false);
const summary = computed(() => summarizeTools(props.tools));
</script>

<template>
  <Collapsible v-model:open="open" class="tool-group">
    <CollapsibleTrigger class="tool-group-trigger" :aria-label="`${open ? '收起' : '展开'}工具记录：${summary.label}`">
      <ChevronRight class="size-3.5 shrink-0" :class="{ 'rotate-90': open }" aria-hidden="true" />
      <Loader2 v-if="summary.active" class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <ListChecks v-else class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="tool-group-label">{{ summary.label }}</span>
      <span v-for="status in summary.states" :key="status.state" class="tool-group-state" :data-state="status.state">
        {{ status.label }}
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent class="tool-group-content">
      <ToolCallRow v-for="tool in tools" :key="tool.toolCallId" :part="tool" />
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
.tool-group {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.tool-group-trigger {
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px 7px;
  padding: 4px 0;
  color: var(--color-mut);
  text-align: left;
  font-size: 12px;
  line-height: 1.6;
  cursor: pointer;
}

.tool-group-trigger:hover {
  color: var(--color-txt-strong);
}

.tool-group-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tool-group-state {
  font-size: 11px;
  white-space: nowrap;
  color: var(--color-dim);
}

.tool-group-state[data-state="error"] {
  color: var(--color-err);
}

.tool-group-state[data-state="denied"],
.tool-group-state[data-state="awaiting-approval"] {
  color: var(--color-accent-2);
}

.tool-group-content {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  margin-top: 4px;
  margin-left: 6px;
  padding-left: 12px;
  border-left: 1px solid var(--color-line);
}
</style>
