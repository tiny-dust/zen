<script setup lang="ts">
/**
 * 氛围层：固定在窗口最底层的缓动光斑背景，只做气氛不挡内容。
 * - 颜色/透明度全部来自主题 token（--ambient-1/2/3、--ambient-opacity），随 data-theme 即时切换
 * - 用径向渐变自身的透明衰减模拟柔光，不用 filter: blur()，避免大面积实时模糊的 GPU 开销
 * - pointer-events-none + -z-10：永不拦截鼠标；prefers-reduced-motion 时静止
 */
</script>

<template>
  <div class="zen-ambient" aria-hidden="true">
    <div class="zen-ambient__blob zen-ambient__blob--1"></div>
    <div class="zen-ambient__blob zen-ambient__blob--2"></div>
    <div class="zen-ambient__blob zen-ambient__blob--3"></div>
  </div>
</template>

<style>
.zen-ambient {
  position: fixed;
  inset: 0;
  z-index: -10;
  overflow: hidden;
  pointer-events: none;
  opacity: var(--ambient-opacity, 0);
  transition: opacity 0.6s ease;
}

.zen-ambient__blob {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
}

.zen-ambient__blob--1 {
  width: 56vw;
  height: 56vw;
  top: -18vw;
  left: -12vw;
  background: radial-gradient(circle closest-side, var(--ambient-1, transparent) 0%, transparent 100%);
  animation: zen-ambient-drift-1 52s ease-in-out infinite alternate;
}

.zen-ambient__blob--2 {
  width: 48vw;
  height: 48vw;
  top: 22%;
  right: -16vw;
  background: radial-gradient(circle closest-side, var(--ambient-2, transparent) 0%, transparent 100%);
  animation: zen-ambient-drift-2 64s ease-in-out infinite alternate;
}

.zen-ambient__blob--3 {
  width: 44vw;
  height: 44vw;
  bottom: -16vw;
  left: 28%;
  background: radial-gradient(circle closest-side, var(--ambient-3, transparent) 0%, transparent 100%);
  animation: zen-ambient-drift-3 76s ease-in-out infinite alternate;
}

@keyframes zen-ambient-drift-1 {
  from {
    transform: translate3d(0, 0, 0) scale(1);
  }
  to {
    transform: translate3d(9vw, 7vh, 0) scale(1.16);
  }
}

@keyframes zen-ambient-drift-2 {
  from {
    transform: translate3d(0, 0, 0) scale(1.1);
  }
  to {
    transform: translate3d(-8vw, -6vh, 0) scale(0.94);
  }
}

@keyframes zen-ambient-drift-3 {
  from {
    transform: translate3d(0, 0, 0) scale(0.95);
  }
  to {
    transform: translate3d(6vw, -9vh, 0) scale(1.14);
  }
}

@media (prefers-reduced-motion: reduce) {
  .zen-ambient__blob {
    animation: none;
  }
}
</style>
