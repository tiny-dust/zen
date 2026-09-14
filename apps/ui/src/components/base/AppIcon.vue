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

const label = computed(() => {
  if (props.id === "zen-ink") return "Z";
  if (props.id === "zen-mint") return "Z";
  if (props.id === "zen-ember") return "Z";
  if (props.id === "zen-mono") return "Z";
  return "Z";
});
</script>

<template>
  <div class="app-icon" :class="`app-icon--${id}`" :style="sizeStyle" aria-hidden="true">
    <img v-if="id === 'custom-preview' && customPath" :src="`file://${customPath}`" alt="" />
    <span v-else class="glyph">{{ label }}</span>
  </div>
</template>

<style scoped>
.app-icon {
  display: grid;
  place-items: center;
  border-radius: 22%;
  overflow: hidden;
  flex: none;
  font-weight: 700;
  user-select: none;
}

.app-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.glyph {
  line-height: 1;
}

.app-icon--zen-ink {
  background: linear-gradient(145deg, #1b1f1d 0%, #0d0f0e 100%);
  color: #e8ebe7;
  box-shadow: inset 0 0 0 1px #ffffff14;
}

.app-icon--zen-mint {
  background: linear-gradient(145deg, #1f3a2e 0%, #0f1c16 100%);
  color: #7ddea2;
  box-shadow: inset 0 0 0 1px #7ddea233;
}

.app-icon--zen-ember {
  background: linear-gradient(145deg, #3a1d12 0%, #1a0e0a 100%);
  color: #ff8a52;
  box-shadow: inset 0 0 0 1px #ff6a2b40;
}

.app-icon--zen-mono {
  background: linear-gradient(145deg, #f4f4f1 0%, #d9d9d3 100%);
  color: #151c13;
  box-shadow: inset 0 0 0 1px #151c131a;
}

.app-icon--custom-preview {
  background: var(--color-side-sel);
}
</style>
