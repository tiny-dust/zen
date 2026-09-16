<script setup lang="ts">
import { computed } from "vue";

import CapabilityBadge from "@/components/settings/CapabilityBadge.vue";

import type { ModelCapabilities } from "@zen/shared";

const props = defineProps<{
  capabilities?: ModelCapabilities;
  showLimits?: boolean;
}>();

const badges = computed(() => {
  const caps = props.capabilities;
  if (!caps) {
    return [] as string[];
  }
  const list: string[] = [];
  if (caps.toolCall) {
    list.push("工具");
  }
  if (caps.vision) {
    list.push("视觉");
  }
  if (caps.reasoning) {
    list.push("推理");
  }
  if (caps.media) {
    list.push("媒体");
  }
  return list;
});

function formatK(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 10_000) / 100}m`;
  }
  return `${Math.round(value / 1000)}k`;
}

const limits = computed(() => {
  const caps = props.capabilities;
  if (!caps) {
    return "";
  }
  const parts: string[] = [];
  if (caps.contextWindow) {
    parts.push(`${formatK(caps.contextWindow)} 上下文`);
  }
  if (caps.maxOutputTokens) {
    parts.push(`${formatK(caps.maxOutputTokens)} 输出`);
  }
  return parts.join(" · ");
});
</script>

<template>
  <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
    <CapabilityBadge v-for="item in badges" :key="item" :label="item" />
    <span v-if="showLimits && limits" class="text-[11px] whitespace-nowrap text-[var(--color-dim)]">
      {{ limits }}
    </span>
  </span>
</template>
