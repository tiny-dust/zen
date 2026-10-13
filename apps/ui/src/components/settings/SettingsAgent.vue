<script setup lang="ts">
import MemorySection from "@/components/settings/sections/MemorySection.vue";
import WebSearchSection from "@/components/settings/sections/WebSearchSection.vue";

/**
 * Agent 能力设置：网络搜索 / 记忆 两小节。
 * 权限与隔离区已拆到独立的「权限」页；各小节独立组件并带锚点（设置搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <WebSearchSection />
    <MemorySection />
  </div>
</template>
