<script setup lang="ts">
import { ChevronRight, FoldVertical } from "@lucide/vue";
import { computed, ref } from "vue";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const props = defineProps<{
  /** 摘要全文（meta.output） */
  summary: string;
  /** 折叠掉的更早消息条数 */
  compactedCount?: number;
  /** 时间线上的简短标签（meta.summary） */
  label?: string;
}>();

const open = ref(false);

const countText = computed(() => {
  const n = props.compactedCount;
  if (n != null && n > 0) {
    return `已折叠 ${n} 条更早消息`;
  }
  return props.label || "更早对话已折叠为摘要";
});
</script>

<template>
  <Collapsible v-model:open="open" class="context-compact-card w-full min-w-0 max-w-[min(100%,72ch)]">
    <div class="compact-shell">
      <div class="compact-accent" aria-hidden="true" />
      <div class="compact-body">
        <CollapsibleTrigger as-child>
          <Button
            variant="ghost"
            class="compact-head h-auto w-full justify-start gap-2 px-2.5 py-2 font-normal"
            :aria-label="open ? '收起压缩摘要' : '展开压缩摘要'"
          >
            <FoldVertical class="size-4 shrink-0 compact-icon" aria-hidden="true" />
            <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
              <span class="compact-title">上下文已压缩</span>
              <span class="compact-sub">{{ countText }}</span>
            </span>
            <ChevronRight
              class="size-3.5 shrink-0 transition-transform duration-[var(--motion-fast)]"
              :class="{ 'rotate-90': open }"
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent class="compact-content">
          <pre class="compact-summary">{{ summary }}</pre>
        </CollapsibleContent>
      </div>
    </div>
  </Collapsible>
</template>

<style scoped>
.compact-shell {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--radius);
  background: var(--color-side);
}

.compact-accent {
  width: 3px;
  flex: none;
  background: var(--color-accent);
}

.compact-body {
  min-width: 0;
  flex: 1;
}

.compact-head {
  border-radius: 0;
}

.compact-head:hover {
  background: var(--color-menu-hover);
}

.compact-icon {
  color: var(--color-accent);
}

.compact-title {
  color: var(--color-txt-strong);
  font-size: 13px;
  font-weight: 500;
}

.compact-sub {
  color: var(--color-mut);
  font-size: 11px;
}

.compact-content {
  border-top: 1px solid var(--color-line-soft);
}

.compact-summary {
  margin: 0;
  max-height: 280px;
  overflow: auto;
  padding: 10px 12px;
  color: var(--color-mut);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
