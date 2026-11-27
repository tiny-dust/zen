import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { NAV_RAIL_W, WIDE_BREAKPOINT, useLayoutStore } from "@/stores/layout";

function setViewport(width: number, height = 900) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

beforeEach(() => {
  setViewport(1440);
  setActivePinia(createPinia());
});

describe("useLayoutStore 宽度边界", () => {
  it("默认左栏 312（52 轨道 + 260 面板），右栏按窗口 50% 且保底中央区", () => {
    const store = useLayoutStore();
    expect(store.leftWidth).toBe(312);
    expect(store.panelWidth).toBe(260);
    // 1440 窗口不到信息列断点：默认宽度按窗口 50% 但封顶 480
    expect(store.rightWidth).toBe(480);
  });

  it("setLeftWidth 钳制在 [232, 为右栏/中央留足空间的上限]", () => {
    const store = useLayoutStore();
    store.setLeftWidth(50);
    expect(store.leftWidth).toBe(232);
    store.setLeftWidth(1000);
    expect(store.leftWidth).toBe(472); // 左栏硬上限 472（1440-480-420-2 仍有余量）
    store.setLeftWidth(260);
    expect(store.leftWidth).toBe(260);
  });

  it("右栏收起后左栏上限放开到 472", () => {
    const store = useLayoutStore();
    store.toggleRight();
    store.setLeftWidth(400);
    expect(store.leftWidth).toBe(400);
  });

  it("setRightWidth 钳制在 [240, 上限]", () => {
    const store = useLayoutStore();
    store.setRightWidth(10);
    expect(store.rightWidth).toBe(240);
    store.setRightWidth(1000);
    expect(store.rightWidth).toBe(690); // 上限：1440-312-420-18
  });

  it("会话卡关闭后中央保底变小，两侧上限放宽", () => {
    const store = useLayoutStore();
    store.toggleSession();
    store.setRightWidth(600);
    expect(store.rightWidth).toBe(600); // 上限 1440-312-420-2=706，请求的 600 直接生效
  });

  it("窄窗口（<1100）不计会话卡列宽", () => {
    setViewport(1000);
    setActivePinia(createPinia());
    const store = useLayoutStore();
    // 1000 下右栏取窗口 50%（500）封顶 480 后，再被上限 250 钳住
    expect(store.rightWidth).toBe(250);
    store.setLeftWidth(400);
    // 中央保底 420 + 右栏 250：1000-250-420-18=312
    expect(store.leftWidth).toBe(312);
  });
});

describe("useLayoutStore 底部终端高度", () => {
  it("默认高度沿用 42vh 且至多 360px，终端默认关闭", () => {
    const store = useLayoutStore();
    expect(store.bottomCollapsed).toBe(true);
    expect(store.bottomHeight).toBe(360);
    setViewport(1440, 600);
    setActivePinia(createPinia());
    expect(useLayoutStore().bottomHeight).toBe(252);
  });

  it("拖拽高度限制在 180px 和为上方保留空间的上限之间", () => {
    const store = useLayoutStore();
    store.setBottomHeight(100);
    expect(store.bottomHeight).toBe(180);
    store.setBottomHeight(1000);
    expect(store.bottomHeight).toBe(630); // 900px 窗口：70% 比保留 240px 更严格
    store.setBottomHeight(320);
    expect(store.bottomHeight).toBe(320);
  });

  it("窗口缩小时钳制；极矮窗口优先给上方留空间", () => {
    const store = useLayoutStore();
    store.setBottomHeight(630);
    setViewport(1440, 500);
    store.syncViewport();
    expect(store.bottomHeight).toBe(260);
    setViewport(1440, 350);
    store.syncViewport();
    expect(store.bottomHeight).toBe(110);
    store.setBottomHeight(1);
    expect(store.bottomHeight).toBe(110);
  });

  it("收起后再次展开保留拖拽高度", () => {
    const store = useLayoutStore();
    store.setBottomHeight(420);
    store.toggleBottom();
    store.toggleBottom();
    expect(store.bottomHeight).toBe(420);
  });
});

describe("useLayoutStore 开关", () => {
  it("toggle 翻转各面板状态", () => {
    const store = useLayoutStore();
    expect(store.bottomCollapsed).toBe(true);
    store.toggleLeft();
    expect(store.leftCollapsed).toBe(true);
    store.toggleRight();
    expect(store.rightCollapsed).toBe(true);
    store.toggleBottom();
    expect(store.bottomCollapsed).toBe(false);
    store.toggleSession();
    expect(store.sessionOpen).toBe(false);
    store.toggleInfo();
    expect(store.infoOpen).toBe(true);
  });

  it("展开右栏时回到默认宽度", () => {
    const store = useLayoutStore();
    store.setRightWidth(240);
    store.toggleRight();
    expect(store.rightCollapsed).toBe(true);
    // 收起状态下展开：宽度重置为默认 480
    store.toggleRight();
    expect(store.rightCollapsed).toBe(false);
    expect(store.rightWidth).toBe(480);
  });
});

describe("useLayoutStore syncViewport", () => {
  it("明显缩放（≥20px）按比例同步缩放并钳制", () => {
    const store = useLayoutStore();
    setViewport(1640);
    store.syncViewport();
    // scale = 1640/1440 ≈ 1.1389 → 312→355、480→547，均在新边界内
    expect(store.leftWidth).toBe(355);
    expect(store.rightWidth).toBe(547);
  });

  it("微小变化只钳制不缩放", () => {
    const store = useLayoutStore();
    setViewport(1450);
    store.syncViewport();
    expect(store.leftWidth).toBe(312);
    expect(store.rightWidth).toBe(480);
  });

  it("新宽度低于 400 不缩放，但按新边界钳制", () => {
    const store = useLayoutStore();
    setViewport(200);
    store.syncViewport();
    // 左栏上限退化为最小 232（52 轨道 + 180 面板）
    expect(store.leftWidth).toBe(232);
    expect(store.rightWidth).toBeGreaterThanOrEqual(240);
  });

  it("旧宽度低于 400（首次校准）不缩放", () => {
    setViewport(300);
    setActivePinia(createPinia());
    const store = useLayoutStore();
    // init：rightWidth 兜底钳到 240
    expect(store.rightWidth).toBe(240);
    setViewport(950);
    store.syncViewport();
    // 无比例放大（prev<400）：312/240 只按新边界钳制（950-240-420-18=272）
    expect(store.leftWidth).toBe(272);
    expect(store.rightWidth).toBe(240);
  });
});

describe("常驻导航轨道与信息列预算", () => {
  it("收起会话面板后，右栏上限仍把轨道算作已占用", () => {
    const store = useLayoutStore();
    store.toggleLeft();
    expect(store.leftCollapsed).toBe(true);
    store.setRightWidth(1000);
    // 1440 - 52（轨道）- 420（中央保底）- 18（手柄）
    expect(store.rightWidth).toBe(950);
  });

  it("信息列按同一个断点开合：断点以下不计 350px 保底", () => {
    setViewport(1300);
    setActivePinia(createPinia());
    const narrow = useLayoutStore();
    narrow.setRightWidth(1000);
    // 1300 - 312（左）- 420（聊天）- 18，且未超窗口 75%
    expect(narrow.rightWidth).toBe(550);

    setViewport(1700);
    setActivePinia(createPinia());
    const wide = useLayoutStore();
    wide.setRightWidth(1000);
    // 宽窗把信息列 350 一起保底：1700 - 312 - 420 - 350 - 18
    expect(wide.rightWidth).toBe(600);
  });

  it("渲染层与 store 共用同一个断点常量", () => {
    expect(WIDE_BREAKPOINT).toBe(1644);
  });
});
