<script setup lang="ts">
import UpdateSection from "@/components/settings/sections/UpdateSection.vue";

/**
 * 通用设置：软件更新。
 * 外观/语言与代码主题拆到「外观」页；各小节独立组件并带锚点（设置搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <UpdateSection />
  </div>
</template>
