<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import CapabilityBadge from "@/components/settings/CapabilityBadge.vue";

import type { ModelCapabilities } from "@zen/shared";

const props = defineProps<{
  capabilities?: ModelCapabilities;
  showLimits?: boolean;
}>();

const { t } = useI18n();

const badges = computed(() => {
  const caps = props.capabilities;
  if (!caps) {
    return [] as string[];
  }
  const list: string[] = [];
  if (caps.toolCall) {
    list.push("settings.models.capTool");
  }
  if (caps.vision) {
    list.push("settings.models.capVision");
  }
  if (caps.reasoning) {
    list.push("settings.models.capReasoning");
  }
  if (caps.media) {
    list.push("settings.models.capMedia");
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
    parts.push(t("settings.models.ctxLimit", { value: formatK(caps.contextWindow) }));
  }
  if (caps.maxOutputTokens) {
    parts.push(t("settings.models.outLimit", { value: formatK(caps.maxOutputTokens) }));
  }
  return parts.join(" · ");
});
</script>

<template>
  <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
    <CapabilityBadge v-for="item in badges" :key="item" :label="t(item)" />
    <span v-if="showLimits && limits" class="text-[11px] whitespace-nowrap text-[var(--color-dim)]">
      {{ limits }}
    </span>
  </span>
</template>
