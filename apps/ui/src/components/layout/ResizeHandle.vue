<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    orientation?: "vertical" | "horizontal";
    invert?: boolean;
    /** 常显分隔线模式：手柄中央画 1px 线，悬停仍是整条高亮 */
    line?: boolean;
  }>(),
  {
    orientation: "vertical",
    invert: false,
    line: false,
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

const rootClass = computed(() =>
  [
    "group relative z-5 flex-none touch-none after:absolute after:transition-colors after:duration-[var(--motion-fast)] after:ease-[var(--ease-enter)]",
    props.line
      ? // 常显 1px 分隔线；悬停/拖拽时让位于整条高亮
        "after:inset-y-0 after:left-1/2 after:right-auto after:w-px after:bg-[var(--color-line)]"
      : "after:inset-0 after:bg-transparent",
    "hover:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]",
  ].join(" "),
);
</script>

<template>
  <div
    :class="[
      rootClass,
      orientation === 'vertical'
        ? 'w-[5px] -mx-0.5 cursor-col-resize'
        : 'h-[5px] -my-0.5 cursor-row-resize',
      dragging ? 'after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]!' : '',
    ]"
    role="separator"
    :aria-orientation="orientation"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</template>
