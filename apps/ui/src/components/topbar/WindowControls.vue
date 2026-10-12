<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

type Platform = "darwin" | "win32" | "linux";

/**
 * 窗口三键全部为系统原生 chrome：macOS 红绿灯、Windows/Linux titleBarOverlay
 * 原生叠加键（main 进程注入），点击在系统层处理，不经过渲染层。
 * 本组件只剩两件事：
 * 1) 把叠加键实际宽度写入 --titlebar-trail，头行据此给 tab/按钮留位；
 * 2) Linux 双击拖拽区最大化兜底（frameless drag region 不处理双击）。
 */
const api = window.zen?.window ?? null;
const platform: Platform | null = api?.getPlatform() ?? null;

/** 叠加键宽度兜底：Win11 三键 3×46；Linux Electron 自绘近似值，API 就绪后即校正 */
const FALLBACK_TRAIL = 138;

interface WindowControlsOverlayLike {
  visible?: boolean;
  getBoundingClientRect?: () => { width: number };
  addEventListener?: (type: "geometrychange", listener: () => void) => void;
  removeEventListener?: (type: "geometrychange", listener: () => void) => void;
}

function overlayApi(): WindowControlsOverlayLike | null {
  return (
    (navigator as unknown as { windowControlsOverlay?: WindowControlsOverlayLike })
      .windowControlsOverlay ?? null
  );
}

/** 头行右侧预留原生三键宽度（--titlebar-trail，与 macOS 交通灯的 --titlebar-lead 对称） */
function syncTrail() {
  const root = document.documentElement;
  if (platform === "darwin" || !api) {
    root.style.setProperty("--titlebar-trail", "0px");
    return;
  }
  const wco = overlayApi();
  const width =
    wco?.visible && wco.getBoundingClientRect
      ? Math.ceil(wco.getBoundingClientRect().width)
      : 0;
  root.style.setProperty("--titlebar-trail", `${width || FALLBACK_TRAIL}px`);
}

/** 双击标题栏（各头行拖拽区）最大化-还原（仅 Linux 兜底，见组件头注释） */
function onTitlebarDoubleClick(event: MouseEvent) {
  if (platform !== "linux") {
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

onMounted(() => {
  if (!api) {
    return;
  }
  document.addEventListener("dblclick", onTitlebarDoubleClick);
  syncTrail();
  // WCO 几何就绪/DPI 变化时重取实际宽度（构造期 API 可能尚未就绪）
  overlayApi()?.addEventListener?.("geometrychange", syncTrail);
  window.addEventListener("resize", syncTrail);
});

onBeforeUnmount(() => {
  document.removeEventListener("dblclick", onTitlebarDoubleClick);
  overlayApi()?.removeEventListener?.("geometrychange", syncTrail);
  window.removeEventListener("resize", syncTrail);
  document.documentElement.style.setProperty("--titlebar-trail", "0px");
});
</script>

<template>
  <!-- 逻辑组件：原生三键由系统绘制，无需 DOM -->
</template>
