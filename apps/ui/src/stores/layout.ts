import { defineStore } from "pinia";
import { computed, ref } from "vue";

/** 常驻导航轨道（nomi 式左侧图标条）：收起会话面板后仍保留 */
export const NAV_RAIL_W = 52;

/**
 * 左栏总宽 = 导航轨道 + 会话面板：
 * 最小 232（180 面板 + 52 轨道），最宽 472（420 + 52），默认 312（260 + 52）。
 */
const LEFT_MIN = 232;
const LEFT_MAX = 472;
const LEFT_DEFAULT = 312;
/** 会话面板自身宽度（不含轨道）：布局只对总宽做钳制，面板尺寸由它反推 */
const PANEL_MIN = LEFT_MIN - NAV_RAIL_W;
const PANEL_MAX = LEFT_MAX - NAV_RAIL_W;

/** 右侧工具面板：最小 240，最宽为窗口的 75% */
const RIGHT_MIN = 240;
const RIGHT_MAX_RATIO = 0.75;
/** 默认宽度上限：按窗口 50% 开局时 1440 下右栏占 706px，消息列只剩 420 上下 */
const RIGHT_DEFAULT_MAX = 480;

/** 中央聊天列保底宽度：拖任何一侧都不允许把聊天区压到该值以下 */
const CENTER_MIN = 420;
/** 中央区里的会话信息卡列宽（宽窗且开启时占位，需一并保底） */
const SESSION_COL_W = 350;
/**
 * 信息列最小可用宽度：左 312 + 右 356 + 聊天 560 + 信息列 350 + 手柄 18 = 1596。
 * 旧值 1372 会在 1440 窗口就插进 350px 信息列，把消息列压到 350 上下；留 48px 余量到 1628，
 * 不够宽时先隐藏信息卡列，优先保证消息列可读。
 */
export const WIDE_BREAKPOINT = 1644;
/** 两条 Resizable 手柄的宽度预算：可见发丝线 1px，但命中区是 9px（见 ResizableHandle.vue） */
const HANDLE_BUDGET = 18;

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

/** 右侧面板打开时的默认宽度：窗口的 50% 且不超过 480px，并给中央区留足空间 */
function defaultSideWidth(withSession: boolean): number {
  const floor = CENTER_MIN + (withSession ? SESSION_COL_W : 0);
  const absoluteMax = Math.max(
    RIGHT_MIN,
    Math.min(
      Math.floor(viewportWidth() * RIGHT_MAX_RATIO),
      viewportWidth() - LEFT_DEFAULT - floor - HANDLE_BUDGET,
    ),
  );
  const preferred = Math.min(Math.floor(viewportWidth() / 2), RIGHT_DEFAULT_MAX);
  return clamp(preferred, RIGHT_MIN, absoluteMax);
}

export const useLayoutStore = defineStore("layout", () => {
  const leftWidth = ref(LEFT_DEFAULT);
  // 初始宽度按「窗口是否到信息列断点」算，别无条件按有信息列保底，否则窄窗开局聊天列只剩 246
  const rightWidth = ref(defaultSideWidth(viewportWidth() >= WIDE_BREAKPOINT));
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
    // 收起只隐藏会话面板，导航轨道仍在，不能按 0 计算
    const left = leftCollapsed.value ? NAV_RAIL_W : leftWidth.value;
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
      const nextLeft = Math.round(leftWidth.value * scale);
      const nextRight = Math.round(rightWidth.value * scale);
      // 只按比例放大放得下的情况：否则两边会被逐个钳制，结果反而把左栏压到最小
      const budget = w - centerFloor() - HANDLE_BUDGET;
      const spread = (leftCollapsed.value ? NAV_RAIL_W : nextLeft) +
        (rightCollapsed.value ? 0 : nextRight);
      if (spread <= budget) {
        leftWidth.value = nextLeft;
        rightWidth.value = nextRight;
      }
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

  /** Splitter 面板的像素约束：与拖拽手柄共用同一套边界，避免两处各算一遍 */
  const leftBounds = computed(() => ({ min: LEFT_MIN, max: leftMax() }));
  /** 会话面板自身宽度：为 0 表示面板收起（只剩导航轨道） */
  const panelWidth = computed(() =>
    leftCollapsed.value
      ? 0
      : clamp(leftWidth.value - NAV_RAIL_W, PANEL_MIN, Math.max(PANEL_MIN, leftMax() - NAV_RAIL_W)),
  );
  const rightBounds = computed(() => ({ min: RIGHT_MIN, max: rightMax() }));
  const bottomBounds = computed(() => ({ min: Math.min(BOTTOM_MIN, bottomMax()), max: bottomMax() }));

  return {
    leftWidth,
    rightWidth,
    bottomHeight,
    leftBounds,
    rightBounds,
    bottomBounds,
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    sessionOpen,
    infoOpen,
    NAV_RAIL_W,
    panelWidth,
    panelMin: PANEL_MIN,
    panelMax: PANEL_MAX,
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
