<script setup lang="ts">
import { ref } from "vue";

const props = withDefaults(
  defineProps<{
    orientation?: "vertical" | "horizontal";
    invert?: boolean;
  }>(),
  {
    orientation: "vertical",
    invert: false,
  },
);

const emit = defineEmits<{
  drag: [delta: number];
}>();

const dragging = ref(false);
let lastX = 0;
let lastY = 0;

function onPointerDown(event: PointerEvent) {
  dragging.value = true;
  lastX = event.clientX;
  lastY = event.clientY;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) {
    return;
  }
  if (props.orientation === "vertical") {
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    emit("drag", props.invert ? -dx : dx);
    return;
  }
  const dy = event.clientY - lastY;
  lastY = event.clientY;
  emit("drag", props.invert ? -dy : dy);
}

function onPointerUp() {
  dragging.value = false;
}
</script>

<template>
  <div
    class="resize-handle"
    :class="[`resize-handle--${orientation}`, { 'is-dragging': dragging }]"
    role="separator"
    :aria-orientation="orientation"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</template>

<style scoped>
.resize-handle {
  position: relative;
  flex: none;
  z-index: 5;
  touch-action: none;
  background: transparent;
}

.resize-handle--vertical {
  width: 5px;
  cursor: col-resize;
  margin: 0 -2px;
}

.resize-handle--horizontal {
  height: 5px;
  cursor: row-resize;
  margin: -2px 0;
}

.resize-handle::after {
  content: "";
  position: absolute;
  inset: 0;
  background: transparent;
  transition: background var(--motion-fast) var(--ease-enter);
}

.resize-handle:hover::after,
.resize-handle.is-dragging::after {
  background: color-mix(in srgb, var(--color-accent) 55%, transparent);
}
</style>
