<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import { useSettingsStore } from "@/stores/settings";

/**
 * 聊天内容区背景层（对照 nomi 的 ChatBackgroundLayer，但只作用在中央聊天区）：
 * 底图清晰、尺寸固定，上层单层蒙版承担模糊与遮罩，避免模糊后缩放出现边缘透明。
 * 纯装饰：pointer-events-none，不拦截消息滚动与输入。
 */
const settingsStore = useSettingsStore();
const { settings, themeImageUrl } = storeToRefs(settingsStore);

/** 自定义主题自带的背景图：优先于图片主题，主题一切换就重新读 */
const customBackgroundUrl = ref("");
const activeCustomBackground = computed(() => {
  if (!settings.value.theme.startsWith("custom:")) {
    return null;
  }
  const id = settings.value.theme.slice(7);
  const theme = settings.value.customThemes.find((item) => item.id === id);
  return theme?.background ?? null;
});

watch(
  () => activeCustomBackground.value?.id ?? "",
  async (imageId) => {
    customBackgroundUrl.value = "";
    if (!imageId || !window.zen) {
      return;
    }
    const result = await window.zen.themeImage.read(imageId);
    // 读图期间主题可能又切走了：只接受当前仍然匹配的结果
    if (result.ok && result.dataUrl && activeCustomBackground.value?.id === imageId) {
      customBackgroundUrl.value = result.dataUrl;
    }
  },
  { immediate: true },
);

const imageUrl = computed(() => customBackgroundUrl.value || themeImageUrl.value);
const mode = computed<"custom" | "image" | null>(() => {
  if (activeCustomBackground.value && customBackgroundUrl.value) {
    return "custom";
  }
  if (settings.value.themeImage.enabled && themeImageUrl.value) {
    return "image";
  }
  return null;
});

const active = computed(() => mode.value !== null);
const blur = computed(() =>
  mode.value === "custom" ? (activeCustomBackground.value?.blur ?? 0) : settings.value.themeImage.blur,
);
const dim = computed(() =>
  mode.value === "custom" ? (activeCustomBackground.value?.dim ?? 0.45) : settings.value.themeImage.dim,
);

const imageStyle = computed(() => ({
  backgroundImage: `url("${imageUrl.value}")`,
  filter: `blur(${blur.value}px)`,
  // 模糊会让边缘透出底色：放大一点盖住
  transform: blur.value > 0 ? "scale(1.06)" : "none",
}));

const maskStyle = computed(() => ({
  backgroundColor: `color-mix(in srgb, var(--color-panel) ${Math.round(dim.value * 100)}%, transparent)`,
}));
</script>

<template>
  <div v-if="active" class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" data-testid="chat-background">
    <div class="absolute inset-0 bg-cover bg-center" :style="imageStyle" data-testid="chat-background-image" />
    <div class="absolute inset-0" :style="maskStyle" data-testid="chat-background-mask" />
  </div>
</template>
