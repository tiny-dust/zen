import { defineStore } from "pinia";
import { ref } from "vue";

/** 侧栏约束：最小 220；最宽到窗口的 75%（窄窗口至少保留 480） */
const SIDE_MIN = 220;
const SIDE_MAX_RATIO = 0.75;
const SIDE_MAX_FLOOR = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

function sideMax(): number {
  return Math.max(SIDE_MAX_FLOOR, Math.floor(viewportWidth() * SIDE_MAX_RATIO));
}

/** 右侧面板打开时的默认宽度：窗口的 50% */
function defaultSideWidth(): number {
  return clamp(Math.floor(viewportWidth() / 2), SIDE_MIN, sideMax());
}

export const useLayoutStore = defineStore("layout", () => {
  const leftWidth = ref(260);
  const rightWidth = ref(defaultSideWidth());

  const leftCollapsed = ref(false);
  const rightCollapsed = ref(false);
  const bottomCollapsed = ref(false);
  const sessionOpen = ref(true);
  const infoOpen = ref(false);

  function setLeftWidth(value: number) {
    leftWidth.value = clamp(value, SIDE_MIN, sideMax());
  }

  function setRightWidth(value: number) {
    rightWidth.value = clamp(value, SIDE_MIN, sideMax());
  }

  function toggleLeft() {
    leftCollapsed.value = !leftCollapsed.value;
  }

  function toggleRight() {
    rightCollapsed.value = !rightCollapsed.value;
    // 展开右面板时回到默认宽度（窗口 50%）
    if (!rightCollapsed.value) {
      rightWidth.value = defaultSideWidth();
    }
  }

  function toggleBottom() {
    bottomCollapsed.value = !bottomCollapsed.value;
  }

  function toggleSession() {
    sessionOpen.value = !sessionOpen.value;
  }

  function toggleInfo() {
    infoOpen.value = !infoOpen.value;
  }

  return {
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    sessionOpen,
    infoOpen,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    toggleBottom,
    toggleSession,
    toggleInfo,
  };
});
