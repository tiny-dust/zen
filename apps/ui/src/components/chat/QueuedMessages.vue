<script setup lang="ts">
import { ArrowUpToLine, Pencil, X, Zap } from "@lucide/vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";

import type { QueuedMessage } from "@/stores/chat-types";

defineProps<{
  /** 运行中插入的排队消息（按执行顺序排列） */
  items: QueuedMessage[];
  /** 插入执行进行中：按钮禁用，避免并发插入 */
  insertDisabled?: boolean;
}>();

defineEmits<{
  promote: [id: string];
  edit: [id: string];
  remove: [id: string];
  insert: [id: string];
}>();

const { t } = useI18n();
</script>

<template>
  <!-- 运行中插入的消息队列：每条可插入执行 / 插队（移到最前）/ 编辑（放回输入框）/ 删除 -->
  <div
    v-if="items.length"
    class="mb-1.5 flex flex-col gap-0.5"
    :aria-label="t('chat.queued.label')"
  >
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="flex items-center gap-1.5 rounded-lg px-2 py-1"
      :class="index === 0 ? 'bg-[var(--color-menu-active)]' : 'bg-[var(--color-np-btn-bg)]'"
    >
      <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
        {{ index + 1 }}
      </span>
      <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-txt)]" :title="item.text">
        {{ item.text }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-accent)]"
        :disabled="insertDisabled"
        :title="insertDisabled ? t('chat.queued.inserting') : t('chat.queued.insertTitle')"
        :aria-label="insertDisabled ? t('chat.queued.inserting') : t('chat.queued.insert')"
        @click="$emit('insert', item.id)"
      >
        <Zap class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :disabled="index === 0"
        :title="index === 0 ? t('chat.queued.atHead') : t('chat.queued.promoteTitle')"
        :aria-label="index === 0 ? t('chat.queued.atHead') : t('chat.queued.promote')"
        @click="$emit('promote', item.id)"
      >
        <ArrowUpToLine class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :title="t('chat.queued.editTitle')"
        :aria-label="t('chat.queued.edit')"
        @click="$emit('edit', item.id)"
      >
        <Pencil class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :title="t('common.delete')"
        :aria-label="t('chat.queued.remove')"
        @click="$emit('remove', item.id)"
      >
        <X class="size-3" />
      </Button>
    </div>
  </div>
</template>
