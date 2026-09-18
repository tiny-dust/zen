<script setup lang="ts">
import { Check, Wrench, X } from "@lucide/vue";
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useChatStore } from "@/stores/chat";

/**
 * 工具审批卡片：Agent 请求授权时固定在对话区顶部，支持
 * 批准 / 本会话全部允许（同类工具不再逐次确认）/ 拒绝。
 */
const chatStore = useChatStore();

const approvalInputText = computed(() => {
  const input = chatStore.pendingApproval?.input;
  if (input == null) {
    return "";
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
});
</script>

<template>
  <div
    v-if="chatStore.pendingApproval"
    class="rounded-2xl bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-raised)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent-2)_25%,transparent)]"
    role="alertdialog"
    aria-label="工具审批"
  >
    <div class="flex items-start gap-[9px]">
      <div
        class="grid size-6 flex-none place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-accent-2)_14%,transparent)] text-[var(--color-accent-2)]"
      >
        <Wrench :size="15" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-[7px] text-[var(--color-txt-strong)]">
          <strong>需要确认</strong>
          <Badge variant="outline">{{ chatStore.pendingApproval.toolName }}</Badge>
        </div>
        <p class="m-0 mt-0.5 truncate whitespace-normal text-[11px] text-[var(--color-mut)]">
          {{ chatStore.pendingApproval.prompt }}
        </p>
        <pre
          v-if="approvalInputText"
          class="mt-2 max-h-40 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-code-bg)] p-2.5 font-[family-name:var(--font-mono)] text-[11px] leading-normal whitespace-pre-wrap break-words text-[var(--color-code-fg)]"
        >{{ approvalInputText }}</pre>
      </div>
    </div>
    <div class="mt-2.5 flex items-center gap-2 pl-[33px]">
      <Button size="sm" @click="chatStore.approve(true)">
        <Check :size="14" data-icon="inline-start" />批准
      </Button>
      <Button variant="outline" size="sm" @click="chatStore.approve(true, true)">
        <Check :size="14" data-icon="inline-start" />全部允许（本会话）
      </Button>
      <Button variant="outline" size="sm" @click="chatStore.approve(false)">
        <X :size="14" data-icon="inline-start" />拒绝
      </Button>
      <span class="text-[11px] text-[var(--color-dim)]">全部允许后同类调用不再逐次确认</span>
    </div>
  </div>
</template>
