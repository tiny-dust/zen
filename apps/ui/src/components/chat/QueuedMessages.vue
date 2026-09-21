<script setup lang="ts">
import { ArrowUpToLine, Pencil, X } from "@lucide/vue";

import { Button } from "@/components/ui/button";

import type { QueuedMessage } from "@/stores/chat-types";

defineProps<{
  /** 运行中插入的排队消息（按执行顺序排列） */
  items: QueuedMessage[];
}>();

defineEmits<{
  promote: [id: string];
  edit: [id: string];
  remove: [id: string];
}>();
</script>

<template>
  <!-- 运行中插入的消息队列：每条可插队（移到最前）/ 编辑（放回输入框）/ 删除 -->
  <div
    v-if="items.length"
    class="mb-1.5 flex flex-col gap-0.5"
    aria-label="插入消息队列"
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
      <span class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-txt)]" :title="item.text">
        {{ item.text }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        :disabled="index === 0"
        :title="index === 0 ? '已在队首' : '插队：下一步执行'"
        :aria-label="index === 0 ? '已在队首' : '插队'"
        @click="$emit('promote', item.id)"
      >
        <ArrowUpToLine class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        title="编辑：放回输入框"
        aria-label="编辑插入消息"
        @click="$emit('edit', item.id)"
      >
        <Pencil class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        title="删除"
        aria-label="删除插入消息"
        @click="$emit('remove', item.id)"
      >
        <X class="size-3" />
      </Button>
    </div>
  </div>
</template>
