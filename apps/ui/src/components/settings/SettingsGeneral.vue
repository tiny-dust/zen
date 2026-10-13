<script setup lang="ts">
import AppearanceSection from "@/components/settings/sections/AppearanceSection.vue";
import CodeThemeSection from "@/components/settings/sections/CodeThemeSection.vue";
import UpdateSection from "@/components/settings/sections/UpdateSection.vue";

/**
 * 常规设置：外观与语言 / 软件更新 / 代码主题 三小节，
 * 各小节独立组件并带锚点（settings 搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppearanceSection />
    <UpdateSection />
    <CodeThemeSection />
  </div>
</template>
