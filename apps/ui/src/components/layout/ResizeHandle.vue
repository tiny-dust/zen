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

const rootClass =
  "group relative z-5 flex-none touch-none bg-transparent after:absolute after:inset-0 after:bg-transparent after:transition-colors after:duration-[var(--motion-fast)] after:ease-[var(--ease-enter)] hover:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]";
</script>

<template>
  <div
    :class="[
      rootClass,
      orientation === 'vertical'
        ? 'w-[5px] -mx-0.5 cursor-col-resize'
        : 'h-[5px] -my-0.5 cursor-row-resize',
      dragging ? 'after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]' : '',
    ]"
    role="separator"
    :aria-orientation="orientation"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</template>
