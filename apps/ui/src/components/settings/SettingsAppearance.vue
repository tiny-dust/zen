<script setup lang="ts">
import AppearanceSection from "@/components/settings/sections/AppearanceSection.vue";
import CodeThemeSection from "@/components/settings/sections/CodeThemeSection.vue";

/**
 * 外观设置：主题与语言 / 代码主题 两小节，
 * 各小节独立组件并带锚点（设置搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppearanceSection />
    <CodeThemeSection />
  </div>
</template>
