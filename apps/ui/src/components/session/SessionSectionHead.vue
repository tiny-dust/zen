<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
import type { Component } from "vue";

import { Button } from "@/components/ui/button";

/** 会话信息卡节头：icon + 标题 + 计数徽标 + 折叠箭头，三节共用保证左对齐 */
defineProps<{
  icon: Component;
  title: string;
  open: boolean;
  /** 计数徽标文案（如 2/5），缺省不显示 */
  count?: string;
}>();

const emit = defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <Button
    variant="ghost"
    class="flex h-auto min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-1 text-left text-[13px] font-semibold text-[var(--color-txt-strong)] hover:bg-transparent hover:text-[var(--color-txt)] dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-[var(--color-txt-strong)]"
    :aria-expanded="open"
    @click="emit('toggle')"
  >
    <component :is="icon" class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
    <span class="min-w-0 flex-1">{{ title }}</span>
    <span
      v-if="count"
      class="inline-flex h-5 flex-none items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10.5px] font-normal text-[var(--color-mut)]"
    >
      {{ count }}
    </span>
    <ChevronDown
      class="size-3.5 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
      :class="open ? '' : '-rotate-90'"
      aria-hidden="true"
    />
  </Button>
</template>
