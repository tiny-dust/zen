<script setup lang="ts">
import { classes } from "rattail";
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

const buttonClass = computed(() => {
  return classes(
    "base-button",
    [props.variant === "primary", "base-button--primary"],
    [props.variant === "ghost", "base-button--ghost"],
  );
});
</script>

<template>
  <button :type="type" :class="buttonClass" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  min-width: 72px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition:
    background var(--motion-fast) var(--ease-enter),
    border-color var(--motion-fast) var(--ease-enter),
    color var(--motion-fast) var(--ease-enter);
}

.base-button--primary {
  background: var(--color-send);
  color: var(--color-send-fg);
  font-weight: 500;
}

.base-button--primary:hover:not(:disabled) {
  filter: brightness(0.96);
}

.base-button--ghost {
  border-color: var(--color-btn-border);
  background: transparent;
  color: var(--color-mut);
}

.base-button--ghost:hover:not(:disabled) {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}
</style>
