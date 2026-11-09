import { defineStore } from "pinia";
import { ref } from "vue";

/** 左栏（会话管理区）：最小 180，最宽 420 */
const LEFT_MIN = 180;
const LEFT_MAX = 420;
const LEFT_DEFAULT = 260;

/** 右侧工具面板：最小 240，最宽为窗口的 75% */
const RIGHT_MIN = 240;
const RIGHT_MAX_RATIO = 0.75;

/** 中央聊天列保底宽度：拖任何一侧都不允许把聊天区压到该值以下 */
const CENTER_MIN = 420;
/** 中央区里的会话信息卡列宽（≥1100px 且开启时占位，需一并保底） */
const SESSION_COL_W = 350;
const WIDE_BREAKPOINT = 1100;
/** 两条 5px 拖拽手柄的宽度预算 */
const HANDLE_BUDGET = 10;

/** 底部终端默认 42vh（至多 360px），拖动时给上方工作区留出空间 */
const BOTTOM_MIN = 180;
const BOTTOM_DEFAULT_MAX = 360;
const BOTTOM_MAX_RATIO = 0.7;
const TOP_MIN = 240;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

function viewportHeight(): number {
  return typeof window === "undefined" ? 900 : window.innerHeight;
}

function bottomMax(): number {
  const height = viewportHeight();
  return Math.max(0, Math.min(height * BOTTOM_MAX_RATIO, height - TOP_MIN));
}

/** 右侧面板打开时的默认宽度：窗口的 50%，并给中央区留足空间 */
function defaultSideWidth(withSession: boolean): number {
  const floor = CENTER_MIN + (withSession ? SESSION_COL_W : 0);
  const absoluteMax = Math.max(
    RIGHT_MIN,
    Math.min(
      Math.floor(viewportWidth() * RIGHT_MAX_RATIO),
      viewportWidth() - LEFT_DEFAULT - floor - HANDLE_BUDGET,
    ),
  );
  return clamp(Math.floor(viewportWidth() / 2), RIGHT_MIN, absoluteMax);
}

export const useLayoutStore = defineStore("layout", () => {
  const leftWidth = ref(LEFT_DEFAULT);
  const rightWidth = ref(defaultSideWidth(true));
  const bottomHeight = ref(clamp(
    Math.max(BOTTOM_MIN, Math.min(viewportHeight() * 0.42, BOTTOM_DEFAULT_MAX)),
    Math.min(BOTTOM_MIN, bottomMax()),
    bottomMax(),
  ));

  const leftCollapsed = ref(false);
  const rightCollapsed = ref(false);
  /** 终端默认关闭；展开时由调用方按项目路径定位 cwd */
  const bottomCollapsed = ref(true);
  const sessionOpen = ref(true);
  const infoOpen = ref(false);

  /** 中央区保底：聊天列 + 会话信息卡列（宽窗且开启时） */
  function centerFloor(): number {
    const withSession = sessionOpen.value && viewportWidth() >= WIDE_BREAKPOINT;
    return CENTER_MIN + (withSession ? SESSION_COL_W : 0);
  }

  /** 左栏上限：自身硬上限 + 给右栏与中央区留足空间 */
  function leftMax(): number {
    const right = rightCollapsed.value ? 0 : rightWidth.value;
    return Math.max(
      LEFT_MIN,
      Math.min(LEFT_MAX, viewportWidth() - right - centerFloor() - HANDLE_BUDGET),
    );
  }

  /** 右栏上限：窗口 75% + 给左栏与中央区留足空间 */
  function rightMax(): number {
    const left = leftCollapsed.value ? 0 : leftWidth.value;
    return Math.max(
      RIGHT_MIN,
      Math.min(
        Math.floor(viewportWidth() * RIGHT_MAX_RATIO),
        viewportWidth() - left - centerFloor() - HANDLE_BUDGET,
      ),
    );
  }

  function setLeftWidth(value: number) {
    leftWidth.value = clamp(value, LEFT_MIN, leftMax());
  }

  function setRightWidth(value: number) {
    rightWidth.value = clamp(value, RIGHT_MIN, rightMax());
  }

  function setBottomHeight(value: number) {
    const max = bottomMax();
    bottomHeight.value = clamp(value, Math.min(BOTTOM_MIN, max), max);
  }

  /** 窗口尺寸变化后：左右侧栏按比例缩放，终端高度与侧栏一并按新边界钳制 */
  let lastViewportW = typeof window === "undefined" ? 0 : window.innerWidth;

  function syncViewport() {
    const w = viewportWidth();
    const prev = lastViewportW;
    lastViewportW = w;
    // 明显的窗口缩放（含双击最大化）：左右面板宽度按同一比例变化
    if (prev >= 400 && w >= 400 && Math.abs(w - prev) >= 20) {
      const scale = w / prev;
      leftWidth.value = Math.round(leftWidth.value * scale);
      rightWidth.value = Math.round(rightWidth.value * scale);
    }
    setLeftWidth(leftWidth.value);
    setRightWidth(rightWidth.value);
    setBottomHeight(bottomHeight.value);
  }

  function toggleLeft() {
    leftCollapsed.value = !leftCollapsed.value;
  }

  function toggleRight() {
    rightCollapsed.value = !rightCollapsed.value;
    // 展开右面板时回到默认宽度（窗口 50%）
    if (!rightCollapsed.value) {
      const withSession = sessionOpen.value && viewportWidth() >= WIDE_BREAKPOINT;
      rightWidth.value = defaultSideWidth(withSession);
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
    bottomHeight,
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    sessionOpen,
    infoOpen,
    setLeftWidth,
    setRightWidth,
    setBottomHeight,
    syncViewport,
    toggleLeft,
    toggleRight,
    toggleBottom,
    toggleSession,
    toggleInfo,
  };
});
