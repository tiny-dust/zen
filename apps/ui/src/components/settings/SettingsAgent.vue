<script setup lang="ts">
import MemorySection from "@/components/settings/sections/MemorySection.vue";
import PermissionSection from "@/components/settings/sections/PermissionSection.vue";
import SandboxSection from "@/components/settings/sections/SandboxSection.vue";
import WebSearchSection from "@/components/settings/sections/WebSearchSection.vue";

/**
 * Agent 与权限：权限三档 / 项目隔离区 / 网络搜索 / 记忆 四小节，
 * 各小节独立组件并带锚点（settings 搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <PermissionSection />
    <SandboxSection />
    <WebSearchSection />
    <MemorySection />
  </div>
</template>
