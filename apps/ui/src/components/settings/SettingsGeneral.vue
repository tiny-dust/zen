<script setup lang="ts">
import CacheSection from "@/components/settings/sections/CacheSection.vue";
import UpdateSection from "@/components/settings/sections/UpdateSection.vue";

/**
 * 通用设置：软件更新与临时缓存。
 * 外观/语言与代码主题拆到「外观」页；各小节独立组件并带锚点（设置搜索直达用）。
 */
</script>

<template>
  <div class="flex flex-col gap-5">
    <UpdateSection />
    <CacheSection />
  </div>
</template>
