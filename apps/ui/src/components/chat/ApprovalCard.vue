<script setup lang="ts">
import { IconTool as Wrench } from "@tabler/icons-vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import ApprovalActionBar from "@/components/agent/ApprovalActionBar.vue";
import { Badge } from "@/components/ui/badge";
import { useChatStore } from "@/stores/chat";

/**
 * 工具审批卡片：Agent 请求授权时固定在对话区顶部，支持
 * 批准 / 本会话全部允许（同类工具不再逐次确认）/ 拒绝。
 * 视觉走 --agent-approval 语义（与用户可选强调色解耦）。
 */
const { t } = useI18n();
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
    class="rounded-md bg-[var(--color-composer-surface)] p-2.5 shadow-[var(--shadow-raised)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--agent-approval)_48%,transparent)]"
    role="alertdialog"
    :aria-label="t('chat.approval.title')"
  >
    <div class="flex items-start gap-2">
      <div
        class="grid size-6 flex-none place-items-center rounded-sm bg-[color-mix(in_srgb,var(--agent-approval)_14%,transparent)] text-[var(--agent-approval)]"
      >
        <Wrench :size="15" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 text-[var(--color-txt-strong)]">
          <strong>{{ t("chat.approval.needsConfirmation") }}</strong>
          <Badge variant="outline" class="rounded-sm text-[11px]">{{ chatStore.pendingApproval.toolName }}</Badge>
        </div>
        <p class="m-0 mt-0.5 truncate whitespace-normal text-[11px] text-[var(--color-mut)]">
          {{ chatStore.pendingApproval.prompt }}
        </p>
        <pre
          v-if="approvalInputText"
          class="mt-2 max-h-40 overflow-auto rounded-sm bg-[var(--color-code-bg)] p-2.5 font-[family-name:var(--font-mono)] text-[11px] leading-normal whitespace-pre-wrap break-words text-[var(--color-code-fg)]"
        >{{ approvalInputText }}</pre>
      </div>
    </div>
    <div class="mt-2 pl-8">
      <ApprovalActionBar
        @approve="chatStore.approve(true)"
        @trust="chatStore.approve(true, true)"
        @deny="chatStore.approve(false)"
      />
    </div>
  </div>
</template>
