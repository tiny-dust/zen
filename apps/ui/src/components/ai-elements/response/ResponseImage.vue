<script setup lang="ts">
import { computed } from "vue";

import { localPathFromMarker } from "@/components/ai-elements/response/local-file-links";
import { cachedLocalImage } from "@/components/ai-elements/response/local-image-cache";

/**
 * Markdown 图片渲染（uiComponents.Image 覆盖）：
 * - src 是本地引用标记（data:image 标记）→ 经 preview-file 换取 data URL；
 * - 其余（http/https/data）→ 原样渲染，交给浏览器加载。
 */
const props = defineProps<{
  src?: string;
  alt?: string;
  title?: string;
}>();

const isLocal = computed(() => !!localPathFromMarker(props.src));
/** 本地图片解析出的 data URL（未取回时为 null → 显示占位） */
const localDataUrl = computed(() => (isLocal.value ? cachedLocalImage(props.src) : null));
const resolvedSrc = computed(() => (isLocal.value ? localDataUrl.value : props.src));
</script>

<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="alt ?? ''"
    :title="title"
    class="zen-local-image"
  >
  <span
    v-else-if="isLocal"
    class="zen-local-image-loading"
    role="status"
  >加载图片…</span>
</template>

<style scoped>
.zen-local-image {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.zen-local-image-loading {
  display: inline-block;
  padding: 6px 10px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-code-bg);
  color: var(--color-dim);
  font-size: 11px;
}
</style>
