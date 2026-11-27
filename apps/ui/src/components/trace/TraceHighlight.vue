<script setup lang="ts">
import { highlightSegments } from "@/lib/trace/queries";

/** 轨迹文本里的关键词高亮：拆词规则与搜索过滤一致 */
const props = defineProps<{ text: string; query: string }>();
</script>

<template>
  <!-- 没搜索词时直接输出原文：不为每行建 mark 节点、也不跑正则 -->
  <template v-if="!props.query">{{ props.text }}</template>
  <template v-else v-for="(segment, index) in highlightSegments(props.text, props.query)" :key="index">
    <mark v-if="segment.hit" class="trace-mark">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<style scoped>
.trace-mark {
  padding: 0 2px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--agent-approval) 24%, transparent);
  color: var(--color-txt-strong);
}
</style>
