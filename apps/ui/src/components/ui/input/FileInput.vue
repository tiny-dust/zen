<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import { inputVariants } from ".";

defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <input type="file" data-slot="input" :class="cn(inputVariants({ variant: 'default' }), $props.class)">
</template>
