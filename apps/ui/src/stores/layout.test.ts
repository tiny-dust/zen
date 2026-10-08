import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useLayoutStore } from "@/stores/layout";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

beforeEach(() => {
  setViewport(1440);
  setActivePinia(createPinia());
});

describe("useLayoutStore 宽度边界", () => {
  it("默认左栏 260，右栏按窗口 50% 且保底中央区", () => {
    const store = useLayoutStore();
    expect(store.leftWidth).toBe(260);
    // 1440 窗口：中央 420+会话卡 350+手柄 10 保底，右栏被钳到 400
    expect(store.rightWidth).toBe(400);
  });

  it("setLeftWidth 钳制在 [180, 为右栏/中央留足空间的上限]", () => {
    const store = useLayoutStore();
    store.setLeftWidth(50);
    expect(store.leftWidth).toBe(180);
    store.setLeftWidth(1000);
    expect(store.leftWidth).toBe(260); // 上限：1440-400-770-10
    store.setLeftWidth(200);
    expect(store.leftWidth).toBe(200);
  });

  it("右栏收起后左栏上限放开到 420", () => {
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
    expect(store.rightWidth).toBe(400); // 上限：1440-260-770-10
  });

  it("会话卡关闭后中央保底变小，两侧上限放宽", () => {
    const store = useLayoutStore();
    store.toggleSession();
    store.setRightWidth(600);
    expect(store.rightWidth).toBe(600); // 上限：1440-260-420-10=750，取 600
  });

  it("窄窗口（<1100）不计会话卡列宽", () => {
    setViewport(1000);
    setActivePinia(createPinia());
    const store = useLayoutStore();
    // init 仍按 withSession=true 兜底：1000 下右栏被钳到 240
    expect(store.rightWidth).toBe(240);
    store.setLeftWidth(400);
    // 中央保底只按 420：1000-240-420-10=330
    expect(store.leftWidth).toBe(330);
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
    // 收起状态下展开：宽度重置为默认 400
    store.toggleRight();
    expect(store.rightCollapsed).toBe(false);
    expect(store.rightWidth).toBe(400);
  });
});

describe("useLayoutStore syncViewport", () => {
  it("明显缩放（≥20px）按比例同步缩放并钳制", () => {
    const store = useLayoutStore();
    setViewport(1640);
    store.syncViewport();
    // scale = 1640/1440 ≈ 1.1389 → 260→296、400→456，均在新边界内
    expect(store.leftWidth).toBe(296);
    expect(store.rightWidth).toBe(456);
  });

  it("微小变化只钳制不缩放", () => {
    const store = useLayoutStore();
    setViewport(1450);
    store.syncViewport();
    expect(store.leftWidth).toBe(260);
    expect(store.rightWidth).toBe(400);
  });

  it("新宽度低于 400 不缩放，但按新边界钳制", () => {
    const store = useLayoutStore();
    setViewport(200);
    store.syncViewport();
    // 左栏上限退化为最小 180
    expect(store.leftWidth).toBe(180);
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
    // 无比例放大（prev<400）：260/240 保持，只按新边界钳制
    // （若按比例放大会被钳到 280/260，可区分）
    expect(store.leftWidth).toBe(260);
    expect(store.rightWidth).toBe(240);
  });
});
