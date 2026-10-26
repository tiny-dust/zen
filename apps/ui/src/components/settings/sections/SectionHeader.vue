<script setup lang="ts">
import type { Component } from "vue";

/**
 * 设置页小节标题：图标 + 标题 + 说明 + 可选右侧操作。
 * Agent / 记忆这类「多小节并列」的页面靠统一头部建立层级，避免标题与正文平铺。
 */
defineProps<{
  icon: Component;
  title: string;
  desc?: string;
}>();
</script>

<template>
  <div class="flex items-start gap-2.5">
    <span
      class="mt-px flex size-6 flex-none items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] text-[var(--color-mut)]"
      aria-hidden="true"
    >
      <component :is="icon" :size="14" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ title }}</h3>
      <p v-if="desc" class="m-0 text-[12px] leading-relaxed text-[var(--color-mut)]">{{ desc }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-none items-center gap-1.5">
      <slot name="actions" />
    </div>
  </div>
</template>
