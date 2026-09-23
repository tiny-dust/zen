<script setup lang="ts">
import { Copy, Minus, Square, X } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Platform = "darwin" | "win32" | "linux";

const api = window.zen?.window ?? null;

const platform = ref<Platform | null>(null);
const maximized = ref(false);
const rootEl = ref<HTMLElement | null>(null);
/** win32 原生 caption 叠加可用时交给系统画；不可用时回落自绘（安全降级） */
const nativeOverlay = ref(false);
let disposeMaximized: (() => void) | null = null;

/** win32 自绘走 Windows 通栏三键；Linux 走 GNOME 风格紧凑三键 */
const variant = computed(() => (platform.value === "win32" ? "windows" : "gnome"));

/** macOS 红绿灯原生；win32 原生叠加时也不自绘 */
const showControls = computed(() => {
  if (!api || !platform.value || platform.value === "darwin") {
    return false;
  }
  return platform.value === "linux" || !nativeOverlay.value;
});

const rootCls = computed(() =>
  cn(
    // 固定窗口右上角；容器保留拖拽（不吞掉标题栏拖拽区），仅按钮 no-drag
    "fixed right-0 top-0 z-[var(--z-toast)] flex h-[var(--titlebar-h)] select-none",
    "[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
    variant.value === "windows" ? "items-stretch" : "items-center gap-1 pr-1.5",
  ),
);

/**
 * 系统 chrome 按钮：hover/按下按平台惯例上底色（关闭键红底白叉），
 * 与 UI_STYLE 的「图标按钮 hover 不上底色」不同——这三键复刻系统观感。
 */
function btnCls(kind: "default" | "close") {
  return cn(
    "px-0 text-[var(--color-topbar-icon)] active:translate-y-0! active:opacity-80",
    variant.value === "windows"
      ? "h-full w-[46px] rounded-none"
      : "h-[var(--control-h)] w-8 rounded-[var(--radius-sm)]",
    kind === "close"
      ? "hover:bg-[var(--color-del)]! hover:text-[var(--destructive-foreground)]! active:bg-[var(--color-err)]! active:text-[var(--destructive-foreground)]!"
      : "hover:bg-[var(--color-menu-hover)]! hover:text-[var(--color-txt-strong)]! active:bg-[var(--color-menu-active)]!",
  );
}

const glyphCls = computed(() => (variant.value === "windows" ? "size-3" : "size-3.5"));

function minimize() {
  void api?.minimize();
}

function toggleMaximize() {
  if (!api) {
    return;
  }
  void (maximized.value ? api.restore() : api.maximize());
}

function closeWindow() {
  void api?.close();
}

/** 双击标题栏（各头行拖拽区）最大化-还原 */
function onTitlebarDoubleClick(event: MouseEvent) {
  // 仅 Linux 需要 JS 兜底：frameless 窗口的 drag region 在 Linux 上
  // 系统不处理双击（Electron 已知行为，GNOME/KDE 均如此）。
  // Windows（含原生叠加与自绘兜底）/macOS 的 drag region 是系统标题栏，
  // 双击最大化由系统处理，这里再 toggle 会一次最大化一次还原互相抵消。
  if (platform.value !== "linux") {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }
  // 按钮/交互控件（no-drag）不算标题栏
  if (target.closest("button, [role='button'], [role='tab'], input, textarea, select, a")) {
    return;
  }
  // 仅响应 [-webkit-app-region:drag] 拖拽区（侧栏/中央/工具栏头行）
  if (!target.closest("[class*='app-region:drag']")) {
    return;
  }
  void api?.toggleMaximize();
}

/** Windows 原生叠加按钮实际宽度（缺 API 时回落 Win11 标准 3×46） */
function overlayButtonsWidth(): number | null {
  const wco = (
    navigator as unknown as {
      windowControlsOverlay?: {
        visible?: boolean;
        getBoundingClientRect?: () => { width: number };
      };
    }
  ).windowControlsOverlay;
  if (!wco?.visible) {
    return null;
  }
  return wco.getBoundingClientRect?.().width ?? null;
}

function fallbackWidth() {
  return variant.value === "windows" ? 138 : 110;
}

/** 头行右侧预留三键宽度（--titlebar-trail，与 macOS 交通灯的 --titlebar-lead 对称） */
function syncTrail() {
  const root = document.documentElement;
  if (!showControls.value) {
    root.style.setProperty(
      "--titlebar-trail",
      platform.value === "win32" && nativeOverlay.value ? `${overlayButtonsWidth() ?? 138}px` : "0px",
    );
    return;
  }
  root.style.setProperty("--titlebar-trail", `${rootEl.value?.offsetWidth || fallbackWidth()}px`);
}

/** 按 styles.css token 实际值同步原生叠加配色（构造参数只是首帧近似） */
function syncNativeOverlayColors() {
  const styles = getComputedStyle(document.documentElement);
  void api?.setTitleBarOverlay({
    color: styles.getPropertyValue("--color-bg").trim() || undefined,
    symbolColor: styles.getPropertyValue("--color-topbar-icon").trim() || undefined,
    height: parseFloat(styles.getPropertyValue("--titlebar-h")) || 38,
  });
}

onMounted(async () => {
  if (!api) {
    return;
  }
  document.addEventListener("dblclick", onTitlebarDoubleClick);
  const info = await window.zen?.shell.platformInfo().catch(() => null);
  platform.value = info?.platform ?? null;
  if (platform.value === "win32") {
    nativeOverlay.value = overlayButtonsWidth() != null;
    if (nativeOverlay.value) {
      syncNativeOverlayColors();
    }
  }
  if (showControls.value) {
    maximized.value = await api.isMaximized().catch(() => false);
    disposeMaximized = api.onMaximizedChange((value) => {
      maximized.value = value;
    });
  }
  await nextTick();
  syncTrail();
});

onBeforeUnmount(() => {
  document.removeEventListener("dblclick", onTitlebarDoubleClick);
  disposeMaximized?.();
  disposeMaximized = null;
  document.documentElement.style.setProperty("--titlebar-trail", "0px");
});
</script>

<template>
  <div
    v-if="showControls"
    ref="rootEl"
    :class="rootCls"
    role="group"
    aria-label="窗口控制"
  >
    <Button
      variant="ghost"
      :class="btnCls('default')"
      aria-label="最小化"
      title="最小化"
      @click="minimize"
    >
      <Minus :class="glyphCls" />
    </Button>
    <Button
      variant="ghost"
      :class="btnCls('default')"
      :aria-label="maximized ? '还原' : '最大化'"
      :title="maximized ? '还原' : '最大化'"
      @click="toggleMaximize"
    >
      <component :is="maximized ? Copy : Square" :class="glyphCls" />
    </Button>
    <Button
      variant="ghost"
      :class="btnCls('close')"
      aria-label="关闭"
      title="关闭"
      @click="closeWindow"
    >
      <X :class="glyphCls" />
    </Button>
  </div>
</template>
