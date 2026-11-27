<script setup lang="ts">
import { computed } from "vue";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Agent 状态徽章：颜色、图标（由调用方放进默认插槽）与文字共同表达状态，
 * 不依赖单一色相。色值只走 --agent-* 语义变量，与用户可选强调色无关。
 */
const props = defineProps<{
  status: "thinking" | "approval" | "success" | "danger" | "idle";
  label: string;
  class?: string;
}>();

const TONE: Record<typeof props.status, string> = {
  thinking:
    "border-[color-mix(in_srgb,var(--agent-thinking)_38%,transparent)] bg-[color-mix(in_srgb,var(--agent-thinking)_12%,transparent)] text-[var(--agent-thinking)]",
  approval:
    "border-[color-mix(in_srgb,var(--agent-approval)_48%,transparent)] bg-[color-mix(in_srgb,var(--agent-approval)_14%,transparent)] text-[var(--agent-approval)]",
  success:
    "border-[color-mix(in_srgb,var(--agent-success)_38%,transparent)] bg-[color-mix(in_srgb,var(--agent-success)_12%,transparent)] text-[var(--agent-success)]",
  danger:
    "border-[color-mix(in_srgb,var(--agent-danger)_38%,transparent)] bg-[color-mix(in_srgb,var(--agent-danger)_12%,transparent)] text-[var(--agent-danger)]",
  idle: "border-[var(--color-line)] text-[var(--color-mut)]",
};

const toneClass = computed(() => cn(TONE[props.status], props.class));
</script>

<template>
  <Badge
    variant="outline"
    :class="cn('h-[18px] gap-1 rounded-sm px-1.5 text-[11px] font-medium tabular-nums', toneClass)"
  >
    <slot />
    {{ label }}
  </Badge>
</template>
