<script setup lang="ts">
import { computed } from "vue";

import type { Component } from "vue";

/**
 * 全项目通用图标入口（对齐 nomi 的图标规范）：
 * - 尺寸三档：nav 18 / inline 16 / empty 22，也可传数字；
 * - 线宽 1.75（lucide 默认 2 偏粗）；
 * - 颜色跟随 currentColor，激活态由调用方给 text-[var(--color-accent)]；
 * - 默认 aria-hidden：装饰性图标不参与朗读，需要朗读时由外层容器给 aria-label。
 * 品牌标识（VendorLogo / agent-logos）与文件类型图标（charmed-icons）不走这里。
 */
const props = withDefaults(
  defineProps<{
    icon: Component;
    size?: "nav" | "inline" | "empty" | number;
    strokeWidth?: number;
    label?: string;
  }>(),
  { size: "inline", strokeWidth: 1.75 },
);

const SIZE_MAP = { nav: 18, inline: 16, empty: 22 } as const;

const px = computed(() => (typeof props.size === "number" ? props.size : SIZE_MAP[props.size]));
const a11y = computed(() =>
  props.label
    ? { role: "img" as const, "aria-label": props.label }
    : { "aria-hidden": true as const },
);
</script>

<template>
  <component :is="icon" :size="px" :stroke-width="strokeWidth" v-bind="a11y" class="shrink-0" />
</template>
