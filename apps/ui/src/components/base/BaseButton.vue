<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "ghost";
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  {
    variant: "primary",
    disabled: false,
    type: "button",
  },
);

const classes = computed(() => [
  "base-button",
  props.variant === "primary" ? "base-button-primary" : "base-button-ghost",
]);
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled">
    <slot />
  </button>
</template>
