<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SESSION_EXPORT_FORMATS } from "@zen/shared";
import { classes } from "rattail";

import type { SessionExportFormat } from "@zen/shared";

/**
 * 导出会话弹窗：选格式 + 是否带上助手思考过程。
 * 侧栏任意会话、当前会话环境信息共用这一个弹窗；取消保存对话框时保持弹窗并提示。
 */
const props = defineProps<{
  open: boolean;
  sessionId: string;
  sessionTitle?: string;
  assistantMessageId?: string;
}>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();

const format = ref<SessionExportFormat>("md");
const includeReasoning = ref(false);
const pending = ref(false);
const error = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = "";
      pending.value = false;
    }
  },
);

async function confirm() {
  if (pending.value || !props.sessionId) {
    return;
  }
  const zen = window.zen;
  if (!zen?.session?.exportSession) {
    error.value = t("features.exportUnavailable");
    return;
  }
  pending.value = true;
  error.value = "";
  try {
    const result = await zen.session.exportSession(props.sessionId, format.value, {
      includeReasoning: includeReasoning.value,
      ...(props.assistantMessageId ? { assistantMessageId: props.assistantMessageId } : {}),
    });
    if (result.ok) {
      if (!result.canceled) emit("update:open", false);
      return;
    }
    error.value = result.error || t("features.exportFailed", { error: "" });
  } catch (caught) {
    error.value = t("features.exportFailed", {
      error: caught instanceof Error ? caught.message : String(caught),
    });
  } finally {
    pending.value = false;
  }
}

function formatClass(id: string) {
  return classes(
    "h-8 flex-1 rounded-[var(--radius-sm)] border text-[12px] transition-colors",
    [
      format.value === id,
      "border-[var(--color-line-strong)] bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]",
    ],
    [format.value !== id, "border-[var(--color-line)] text-[var(--color-mut)] hover:text-[var(--color-txt)]"],
  );
}
</script>

<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent
      class="w-[min(400px,calc(100vw-48px))] gap-2 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
      :show-close-button="false"
    >
      <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
        {{ t(assistantMessageId ? "features.exportTurn" : "features.exportTitle") }}
      </DialogTitle>
      <DialogDescription class="truncate text-[12px] text-[var(--color-mut)]">
        {{ sessionTitle || t("features.exportUntitled") }}
      </DialogDescription>

      <div class="mt-1 flex min-w-0 flex-col gap-2">
        <span class="text-[12px] text-[var(--color-mut)]">{{ t("features.exportFormat") }}</span>
        <div class="flex min-w-0 items-center gap-1.5">
          <Button
            v-for="item in SESSION_EXPORT_FORMATS"
            :key="item.id"
            variant="ghost"
            :class="formatClass(item.id)"
            :aria-pressed="format === item.id"
            @click="format = item.id"
          >
            {{ t(item.labelKey) }}
          </Button>
        </div>

        <label class="mt-1 flex cursor-pointer items-start gap-2">
          <Checkbox v-model="includeReasoning" class="mt-0.5 size-3.5" />
          <span class="min-w-0">
            <span class="block text-[12px] text-[var(--color-txt)]">
              {{ t("features.exportIncludeReasoning") }}
            </span>
            <span class="block text-[11px] leading-snug text-[var(--color-dim)]">
              {{ t("features.exportIncludeReasoningHint") }}
            </span>
          </span>
        </label>

        <p v-if="error" class="m-0 text-[11px] text-[var(--color-err)]" role="alert">{{ error }}</p>
      </div>

      <div class="mt-2 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" :disabled="pending" @click="emit('update:open', false)">
          {{ t("common.cancel") }}
        </Button>
        <Button size="sm" :disabled="pending || !sessionId" @click="confirm">
          {{ pending ? t("features.exporting") : t("features.exportConfirm") }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
