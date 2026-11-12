<script setup lang="ts">
import { ref } from "vue";
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import { inputVariants } from ".";

defineProps<{ class?: HTMLAttributes["class"] }>();
const input = ref<HTMLInputElement | null>(null);
defineExpose({ open: () => input.value?.click() });
</script>

<template>
  <input ref="input" type="file" data-slot="input" :class="cn(inputVariants({ variant: 'default' }), $props.class)">
</template>
