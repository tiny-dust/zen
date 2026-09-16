<script setup lang="ts">
import { Button } from "@/components/ui/button";

/**
 * 行内删除图标按钮：常态即危险色，悬停加深危险底色（覆写 ghost 的 hover 底色）。
 * 会落库的删除必须再经 ConfirmDialog 二次确认。
 */
withDefaults(
  defineProps<{
    label: string;
    title?: string;
    disabled?: boolean;
  }>(),
  {
    title: undefined,
    disabled: false,
  },
);
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    class="text-[var(--color-del)] hover:bg-[var(--color-danger-bg)]! hover:text-[var(--color-del)]!"
    :aria-label="label"
    :title="title ?? label"
    :disabled="disabled"
  >
    <slot />
  </Button>
</template>
