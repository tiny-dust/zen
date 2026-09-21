<script setup lang="ts">
import { computed } from "vue";

import type { PermissionMode } from "@zen/shared";

/**
 * 三种权限模式图标（自绘几何，不依赖厂商资源）：
 * default = 盾牌锁（需确认）/ smart = 盾牌勾（智能放行）/ full = 敞开盾（完全访问）
 */
const props = defineProps<{
  mode: PermissionMode | string;
  size?: number;
}>();

const size = computed(() => props.size ?? 16);

const label = computed(() => {
  if (props.mode === "full") return "完全访问权限";
  if (props.mode === "smart") return "智能权限";
  return "默认权限";
});

const accent = computed(() => {
  if (props.mode === "full") return "var(--color-accent)";
  if (props.mode === "smart") return "var(--color-ok, #3d9a6a)";
  return "var(--color-mut)";
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :aria-label="label"
    role="img"
  >
    <!-- 默认：盾 + 锁 -->
    <template v-if="mode !== 'smart' && mode !== 'full'">
      <path
        d="M12 3.2 4.8 6.2v5.3c0 4.6 3 8.2 7.2 9.3 4.2-1.1 7.2-4.7 7.2-9.3V6.2L12 3.2Z"
        :stroke="accent"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <rect x="9.2" y="11" width="5.6" height="4.4" rx="1" :stroke="accent" stroke-width="1.4" />
      <path d="M10.4 11V9.8a1.6 1.6 0 0 1 3.2 0V11" :stroke="accent" stroke-width="1.4" stroke-linecap="round" />
    </template>
    <!-- 智能：盾 + 勾 -->
    <template v-else-if="mode === 'smart'">
      <path
        d="M12 3.2 4.8 6.2v5.3c0 4.6 3 8.2 7.2 9.3 4.2-1.1 7.2-4.7 7.2-9.3V6.2L12 3.2Z"
        :stroke="accent"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path d="M8.6 12.2 11 14.6l4.6-4.8" :stroke="accent" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- 完全访问：敞口盾 / 放射 -->
    <template v-else>
      <path
        d="M12 3.4 5.2 6.2v5.1c0 4.4 2.8 7.9 6.8 9 4-1.1 6.8-4.6 6.8-9V6.2L12 3.4Z"
        :stroke="accent"
        stroke-width="1.5"
        stroke-linejoin="round"
        opacity="0.55"
      />
      <path
        d="M8.4 12.8c1.2-2.4 2.4-3.6 3.6-3.6s2.4 1.2 3.6 3.6"
        :stroke="accent"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx="12" cy="14.6" r="1.35" :fill="accent" />
    </template>
  </svg>
</template>
