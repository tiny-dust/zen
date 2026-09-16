<script setup lang="ts">
import { computed } from "vue";

import type { AppIconId } from "@zen/shared";

const props = defineProps<{
  id: AppIconId | "custom-preview";
  size?: number;
  customPath?: string | null;
}>();

const sizeStyle = computed(() => ({
  width: `${props.size ?? 48}px`,
  height: `${props.size ?? 48}px`,
}));

const assetSrc = computed(() => {
  if (props.id === "custom" || props.id === "custom-preview") {
    return "";
  }
  return `/assets/app-icon-${props.id}.png`;
});

const label = computed(() => {
  return props.id === "custom-preview" || props.id === "custom" ? "自定义图标" : "Zen";
});
</script>

<template>
  <div
    class="grid flex-none place-items-center overflow-hidden select-none"
    :style="sizeStyle"
    role="img"
    :aria-label="label"
  >
    <img
      v-if="id === 'custom-preview' && customPath"
      class="block size-full object-contain"
      :src="`file://${customPath}`"
      alt=""
    />
    <img v-else-if="assetSrc" class="block size-full object-contain" :src="assetSrc" alt="" />
  </div>
</template>
