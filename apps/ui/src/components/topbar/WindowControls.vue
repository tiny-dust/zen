<script setup lang="ts">
import { Copy, Minus, Square, X } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Platform = "darwin" | "win32" | "linux";

const { t } = useI18n();
const api = window.zen?.window ?? null;

/**
 * 平台来自 preload 的同步值（process.platform），首帧即定：三键必须在首帧
 * 渲染——Chromium 只在初始布局登记拖拽区的 no-drag 子区域，首帧后动态添加
 * 的拖拽容器只登记 drag 矩形，按钮的点击会被整块吞掉（Linux/Windows 均如此）。
 */
const platform = ref<Platform | null>(api?.getPlatform() ?? null);
const maximized = ref(false);
const rootEl = ref<HTMLElement | null>(null);
let disposeMaximized: (() => void) | null = null;

/** win32 自绘走 Windows 通栏三键；Linux 走 GNOME 风格紧凑三键 */
const variant = computed(() => (platform.value === "win32" ? "windows" : "gnome"));

/** macOS 红绿灯原生，其余平台自绘 */
const showControls = computed(() => Boolean(api && platform.value && platform.value !== "darwin"));

const rootCls = computed(() =>
  cn(
    // 固定窗口右上角（覆盖 index.html 的 #wc-region-hole 静态豁免区）。
    // 容器自身不带 app-region：动态登记的 drag 矩形没有 no-drag 洞，
    // 会把豁免区重新盖死；拖拽由下层标题栏头行提供，豁免由静态元素保证。
    "fixed right-0 top-0 z-[var(--z-toast)] flex h-[var(--titlebar-h)] select-none",
    "[&_button]:[-webkit-app-region:no-drag]",
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

function fallbackWidth() {
  return variant.value === "windows" ? 138 : 110;
}

/** 头行右侧预留三键宽度（--titlebar-trail，与 macOS 交通灯的 --titlebar-lead 对称） */
function syncTrail() {
  const root = document.documentElement;
  if (!showControls.value) {
    root.style.setProperty("--titlebar-trail", "0px");
    return;
  }
  root.style.setProperty("--titlebar-trail", `${rootEl.value?.offsetWidth || fallbackWidth()}px`);
}

onMounted(async () => {
  if (!api) {
    return;
  }
  document.addEventListener("dblclick", onTitlebarDoubleClick);
  syncTrail();
  if (showControls.value) {
    maximized.value = await api.isMaximized().catch(() => false);
    disposeMaximized = api.onMaximizedChange((value) => {
      maximized.value = value;
    });
  }
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
    :aria-label="t('shell.windowControls')"
  >
    <Button
      variant="ghost"
      :class="btnCls('default')"
      :aria-label="t('shell.minimize')"
      :title="t('shell.minimize')"
      @click="minimize"
    >
      <Minus :class="glyphCls" />
    </Button>
    <Button
      variant="ghost"
      :class="btnCls('default')"
      :aria-label="maximized ? t('shell.restore') : t('shell.maximize')"
      :title="maximized ? t('shell.restore') : t('shell.maximize')"
      @click="toggleMaximize"
    >
      <component :is="maximized ? Copy : Square" :class="glyphCls" />
    </Button>
    <Button
      variant="ghost"
      :class="btnCls('close')"
      :aria-label="t('common.close')"
      :title="t('common.close')"
      @click="closeWindow"
    >
      <X :class="glyphCls" />
    </Button>
  </div>
</template>
