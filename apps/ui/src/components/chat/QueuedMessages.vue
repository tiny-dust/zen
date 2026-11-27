<script setup lang="ts">
import {
  IconArrowUpBar as ArrowUpToLine,
  IconHourglass as Hourglass,
  IconPaperclip as Paperclip,
  IconPencil as Pencil,
  IconBolt as Zap,
  IconX as X,
} from "@tabler/icons-vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";

import type { QueuedMessage } from "@/stores/chat-types";

const props = defineProps<{
  /** 运行中插入的排队消息（按执行顺序排列） */
  items: QueuedMessage[];
  /** 插入执行进行中：按钮禁用，避免并发插入 */
  insertDisabled?: boolean;
}>();

const emit = defineEmits<{
  promote: [id: string];
  edit: [id: string];
  remove: [id: string];
  insert: [id: string];
}>();

const { t } = useI18n();
const removeCandidateId = ref<string | null>(null);

function confirmRemove() {
  const id = removeCandidateId.value;
  removeCandidateId.value = null;
  if (id && props.items.some((item) => item.id === id)) emit("remove", id);
}

/** 队列条目展示文本：正文为空（纯附件消息）时退回附件名列表 */
function displayText(item: QueuedMessage): string {
  return item.text || (item.attachments ?? []).map((att) => att.name).join("、");
}

/** 带附件的排队消息不能「插入执行」（插入通道只传文本），按队列顺序自动发送 */
function insertBlocked(item: QueuedMessage): boolean {
  return (item.attachments?.length ?? 0) > 0;
}

/** 插入按钮禁用态与提示：插入执行中 / 带附件 / 正常 */
function insertButtonHint(item: QueuedMessage): { disabled: boolean; label: string } {
  if (props.insertDisabled) {
    return { disabled: true, label: t("chat.queued.inserting") };
  }
  if (insertBlocked(item)) {
    return { disabled: true, label: t("chat.queued.insertNoAttachments") };
  }
  return { disabled: false, label: t("chat.queued.insertTitle") };
}

/** 行内说明：这条现在处于什么状态、接下来会怎样 */
function stateLine(item: QueuedMessage): string {
  if (insertBlocked(item)) {
    return t("chat.queued.sendsWithAttachments", { n: item.attachments?.length ?? 0 });
  }
  return t("chat.queued.sendsAfterTask");
}
</script>

<template>
  <!-- 运行中排队消息：等待态（按序发送）与「插入执行」（打断当前任务先跑）分两种语义展示 -->
  <div
    v-if="items.length"
    class="mb-2 flex flex-col gap-1"
    :aria-label="t('chat.queued.label')"
  >
    <div class="flex min-w-0 items-center gap-1.5 px-1 text-[11px]">
      <Hourglass class="size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
      <span class="flex-none font-medium text-[var(--color-mut)]">
        {{ t("chat.queued.header", { n: items.length }) }}
      </span>
      <span class="min-w-0 truncate text-[var(--color-dim)]">{{ t("chat.queued.headerHint") }}</span>
    </div>

    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="flex min-w-0 items-start gap-2 rounded-lg border px-2 py-1.5"
      :class="
        index === 0
          ? 'border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))] bg-[var(--color-menu-active)]'
          : 'border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)]'
      "
    >
      <span
        class="mt-0.5 flex size-4 flex-none items-center justify-center rounded-full text-[10px] font-medium tabular-nums"
        :class="
          index === 0
            ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
            : 'bg-[var(--color-line)] text-[var(--color-mut)]'
        "
        :title="index === 0 ? t('chat.queued.atHead') : t('chat.queued.position', { n: index + 1 })"
      >
        {{ index + 1 }}
      </span>

      <div class="min-w-0 flex-1">
        <p class="m-0 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-snug text-[var(--color-txt)]">
          {{ displayText(item) }}
        </p>
        <p class="m-0 mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-[var(--color-dim)]">
          <Paperclip v-if="insertBlocked(item)" class="size-2.5 flex-none" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ stateLine(item) }}</span>
        </p>
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <!-- 主操作：插入执行（打断当前任务，优先跑这条） -->
        <Button
          variant="ghost"
          class="h-6 flex-none items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors"
          :class="
            insertButtonHint(item).disabled
              ? 'border-[var(--color-line-soft)] text-[var(--color-dim)]'
              : 'border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-line))] text-[var(--color-accent)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]'
          "
          :disabled="insertButtonHint(item).disabled"
          :title="insertButtonHint(item).label"
          :aria-label="insertButtonHint(item).label"
          @click="emit('insert', item.id)"
        >
          <Zap class="size-3" aria-hidden="true" />
          {{ t("chat.queued.insert") }}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
          :disabled="index === 0"
          :title="index === 0 ? t('chat.queued.atHead') : t('chat.queued.promoteTitle')"
          :aria-label="index === 0 ? t('chat.queued.atHead') : t('chat.queued.promote')"
          @click="emit('promote', item.id)"
        >
          <ArrowUpToLine class="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
          :title="t('chat.queued.editTitle')"
          :aria-label="t('chat.queued.edit')"
          @click="emit('edit', item.id)"
        >
          <Pencil class="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
          :title="t('common.delete')"
          :aria-label="t('chat.queued.remove')"
          @click="removeCandidateId = item.id"
        >
          <X class="size-3" />
        </Button>
      </div>
    </div>

    <ConfirmDialog
      :open="removeCandidateId !== null"
      :title="t('chat.queued.removeConfirmTitle')"
      :description="t('chat.queued.removeConfirmDescription')"
      @update:open="(open) => { if (!open) removeCandidateId = null; }"
      @confirm="confirmRemove"
    />
  </div>
</template>
