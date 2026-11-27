<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

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

const { t } = useI18n();
const rootRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
let lastX = 0;
let lastY = 0;
let activePointerId: number | null = null;

/**
 * 结束拖动。松手事件可能根本到不了手柄：指针在窗口外松开、捕获没拿到、
 * 或系统弹窗抢走指针（此时只会有 pointercancel / blur）。所以统一收尾，
 * 并把自己挂的 window 兜底监听一起摘掉，避免状态残留。
 */
function endDrag() {
  if (!dragging.value) return;
  dragging.value = false;
  const el = rootRef.value;
  if (el && activePointerId !== null && el.hasPointerCapture?.(activePointerId)) {
    el.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
  window.removeEventListener("pointerup", endDrag, true);
  window.removeEventListener("pointercancel", endDrag, true);
  window.removeEventListener("blur", endDrag, true);
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragging.value = true;
  activePointerId = event.pointerId;
  lastX = event.clientX;
  lastY = event.clientY;
  // 兜底监听先挂：捕获本身可能拿不到或直接抛（非活动指针、环境不支持），
  // 一旦抛在注册之前，松手事件就再没人收尾，拖动状态会一直残留
  window.addEventListener("pointerup", endDrag, true);
  window.addEventListener("pointercancel", endDrag, true);
  window.addEventListener("blur", endDrag, true);
  try {
    rootRef.value?.setPointerCapture?.(event.pointerId);
  } catch {
    // 拿不到捕获只是少了越界拖动能力，endDrag 仍会把状态收干净
  }
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) {
    return;
  }
  if (activePointerId !== null && event.pointerId !== activePointerId) {
    return;
  }
  // 松手事件丢失时，按键已经松开的那一帧就收尾（buttons 归零说明早就松开了）
  if (event.buttons === 0) {
    endDrag();
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

onUnmounted(endDrag);

function onKeydown(event: KeyboardEvent) {
  const direction = props.orientation === "vertical"
    ? event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    : event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (!direction) return;
  event.preventDefault();
  emit("drag", (props.invert ? -direction : direction) * (event.shiftKey ? 1 : 10));
}

const rootClass = computed(() =>
  [
    "group relative z-5 flex-none touch-none after:absolute after:transition-colors after:duration-[var(--motion-fast)] after:ease-[var(--ease-enter)]",
    props.line
      ? // 常显 1px 分隔线；悬停/拖拽时让位于整条高亮
        "after:inset-y-0 after:left-1/2 after:right-auto after:w-px after:bg-[var(--color-line)]"
      : "after:inset-0 after:bg-transparent",
    "hover:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] focus-visible:after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]",
  ].join(" "),
);
</script>

<template>
  <div
    ref="rootRef"
    :class="[
      rootClass,
      orientation === 'vertical'
        ? 'w-[9px] -mx-1 cursor-col-resize'
        : 'h-[9px] -my-1 cursor-row-resize',
      dragging ? 'after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]!' : '',
    ]"
    role="separator"
    tabindex="0"
    :aria-label="t('panel.resize')"
    :aria-orientation="orientation"
    @keydown="onKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
  />
</template>
