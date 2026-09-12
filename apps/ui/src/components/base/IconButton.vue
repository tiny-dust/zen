<script setup lang="ts">
import { classes } from "rattail";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    label: string;
    active?: boolean;
    title?: string;
  }>(),
  {
    active: false,
    title: "",
  },
);

const buttonClass = computed(() => {
  return classes("icon-button", [props.active, "is-active"]);
});
</script>

<template>
  <button type="button" :class="buttonClass" :aria-label="label" :title="title || label">
    <slot />
  </button>
</template>

<style scoped>
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--color-topbar-icon);
  border: 1px solid transparent;
  transition:
    background var(--motion-fast) var(--ease-enter),
    color var(--motion-fast) var(--ease-enter);
}

.icon-button:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}

.icon-button.is-active {
  background: var(--color-menu-active);
  color: var(--color-txt-strong);
}

.icon-button :deep(svg) {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
