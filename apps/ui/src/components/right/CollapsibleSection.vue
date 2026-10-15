<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";

/**
 * Git 面板的通用可折叠分区（VS Code 视图分节样式）：
 * 头行整行点击折叠/展开；右侧 actions 插槽放行内操作按钮，不随折叠触发。
 * 展开的分区平分面板剩余高度（flex-1，多个分区同时展开时等分），折叠时只占头行。
 */
defineProps<{
  title: string;
  /** 分区内容计数徽标（如文件数/提交数）；0/undefined 不显示 */
  count?: number;
  open: boolean;
}>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <section class="flex min-h-0 flex-col" :class="open ? 'flex-1' : 'flex-none'">
    <header class="flex h-7 flex-none items-center gap-0.5 select-none">
      <button
        type="button"
        class="flex h-7 min-w-0 items-center gap-1 rounded-md px-1 text-left hover:bg-[var(--color-menu-hover)]"
        :aria-expanded="open"
        @click="$emit('toggle')"
      >
        <ChevronDown
          class="size-3.5 flex-none text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
          :class="open ? '' : '-rotate-90'"
          aria-hidden="true"
        />
        <span class="min-w-0 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]">
          {{ title }}
        </span>
        <span v-if="count" class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
          {{ count }}
        </span>
        <!-- 头行补充信息（如 +N -M 统计） -->
        <slot name="meta" />
      </button>
      <slot name="actions" />
    </header>
    <div v-show="open" class="flex min-h-0 flex-1 flex-col gap-1 pt-0.5">
      <slot />
    </div>
  </section>
</template>
