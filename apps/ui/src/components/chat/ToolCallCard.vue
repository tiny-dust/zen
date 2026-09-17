<script setup lang="ts">
import { Check, ChevronDown, X } from "@lucide/vue";
import { computed, ref } from "vue";

import { cn } from "@/lib/utils";
import { toolIconSpec, toolSummaryLine } from "@/lib/tool-meta";

import type { ToolCallMessageMeta } from "@zen/shared";

const props = defineProps<{
  meta: ToolCallMessageMeta;
  content?: string;
}>();

const expanded = ref(false);
const spec = computed(() => toolIconSpec(props.meta.toolName));
const summary = computed(() =>
  toolSummaryLine(props.meta.summary, props.meta.output, props.meta.args),
);

const detailText = computed(() => {
  const parts: string[] = [];
  if (props.meta.args != null) {
    try {
      parts.push(`参数\n${JSON.stringify(props.meta.args, null, 2)}`);
    } catch {
      parts.push(`参数\n${String(props.meta.args)}`);
    }
  }
  const output = props.meta.output;
  if (typeof output === "string" && output.trim()) {
    parts.push(output.length > 4000 ? `${output.slice(0, 4000)}…` : output);
  } else if (output != null && typeof output !== "string") {
    try {
      const text = JSON.stringify(output, null, 2);
      parts.push(text.length > 4000 ? `${text.slice(0, 4000)}…` : text);
    } catch {
      parts.push(String(output));
    }
  }
  if (!parts.length && props.content) {
    parts.push(props.content);
  }
  return parts.join("\n\n");
});
</script>

<template>
  <div
    class="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-side-glass)]"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <component
        :is="spec.icon"
        :size="14"
        :class="cn('flex-none', meta.ok ? spec.cls : 'text-[var(--color-err)]')"
        aria-hidden="true"
      />
      <span class="flex-none text-[12px] font-medium text-[var(--color-txt-strong)]">
        {{ spec.label }}
      </span>
      <span class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-mut)]">
        {{ summary }}
      </span>
      <span
        v-if="!meta.ok"
        class="flex-none grid size-4 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-err)_16%,transparent)] text-[var(--color-err)]"
        aria-label="失败"
      >
        <X :size="11" />
      </span>
      <span
        v-else
        class="flex-none text-[var(--color-ok)]"
        aria-label="成功"
      >
        <Check :size="13" />
      </span>
      <ChevronDown
        :size="13"
        :class="
          cn(
            'flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]',
            expanded && 'rotate-180',
          )
        "
        aria-hidden="true"
      />
    </button>
    <pre
      v-if="expanded && detailText"
      class="m-0 max-h-64 overflow-auto border-t border-[var(--color-line-soft)] bg-[var(--color-code-bg)] px-2.5 py-2 font-[family-name:var(--font-mono)] text-[11px] leading-normal whitespace-pre-wrap break-words text-[var(--color-code-fg)]"
    >{{ detailText }}</pre>
  </div>
</template>
