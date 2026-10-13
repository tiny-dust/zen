<script setup lang="ts">
import PermissionSection from "@/components/settings/sections/PermissionSection.vue";
import SandboxSection from "@/components/settings/sections/SandboxSection.vue";

/**
 * 权限设置：权限三档 / 项目隔离区 两小节（原「Agent 与权限」页拆出），
 * 各小节独立组件并带锚点（设置搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <PermissionSection />
    <SandboxSection />
  </div>
</template>
