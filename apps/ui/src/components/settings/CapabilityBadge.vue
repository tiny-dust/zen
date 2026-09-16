<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  tone?: "default" | "accent";
}>();

const rootClass = computed(() =>
  props.tone === "accent"
    ? "inline-flex h-[18px] items-center rounded-[5px] border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-1.5 text-[10.5px] leading-none text-[var(--color-accent)] whitespace-nowrap"
    : "inline-flex h-[18px] items-center rounded-[5px] border border-[var(--color-line)] bg-[var(--color-menu-active)] px-1.5 text-[10.5px] leading-none text-[var(--color-txt)] whitespace-nowrap",
);
</script>

<template>
  <span :class="rootClass">{{ label }}</span>
</template>
