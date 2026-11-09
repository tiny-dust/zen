// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ELEMENT_PICK_SCRIPT, ELEMENT_PICK_TEARDOWN } from "@zen/tools-browser";

const target = () => document.querySelector<HTMLElement>("#pick-target")!;
const tip = () => document.querySelector<HTMLElement>("#zen-pick-tip")!;
const box = () => document.querySelector<HTMLElement>("#zen-pick-overlay")!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  document.body.innerHTML = '<button id="pick-target">Pick</button><button id="other-target">Other</button>';
  expect(window.eval(ELEMENT_PICK_SCRIPT)).toBe("started");
});

afterEach(() => {
  window.eval(ELEMENT_PICK_TEARDOWN);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("ELEMENT_PICK_SCRIPT", () => {
  it("高亮实时更新，悬浮信息静止满 1000ms 才展示，移动立即隐藏并重新计时", () => {
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(box().style.display).toBe("block");
    expect(tip().style.display).toBe("none");
    expect(getComputedStyle(tip()).pointerEvents).toBe("none");
    vi.advanceTimersByTime(999);
    expect(tip().style.display).toBe("none");
    vi.advanceTimersByTime(1);
    expect(tip().style.display).toBe("block");
    expect(tip().textContent).toBe("#pick-target");

    document.querySelector("#other-target")!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(tip().style.display).toBe("none");
    expect(box().style.display).toBe("block");
    vi.advanceTimersByTime(500);
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    vi.advanceTimersByTime(999);
    expect(tip().style.display).toBe("none");
    vi.advanceTimersByTime(1);
    expect(tip().textContent).toBe("#pick-target");
    expect(tip().style.display).toBe("block");
  });

  it("离开视口取消计时并隐藏，高亮也收起，返回后重新计时", () => {
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    vi.advanceTimersByTime(500);
    target().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
    expect(tip().style.display).toBe("none");
    expect(box().style.display).toBe("none");
    vi.advanceTimersByTime(1500);
    expect(tip().style.display).toBe("none");
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(tip().style.display).toBe("block");
  });

  it("未等悬浮出现即可点击选择，清理定时器与标注", () => {
    const picked = vi.fn();
    vi.stubGlobal("zenElementPicked", picked);
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    target().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(JSON.parse(picked.mock.calls[0]![0] as string)).toMatchObject({ selector: "#pick-target" });
    expect(document.querySelector("#zen-pick-tip")).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["Escape", "teardown"])("%s 清理已显示的信息框和待执行的计时器", (exit) => {
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(tip().style.display).toBe("block");
    target().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    if (exit === "Escape") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else {
      expect(window.eval(ELEMENT_PICK_TEARDOWN)).toBe("ok");
    }
    expect(document.querySelector("#zen-pick-tip")).toBeNull();
    expect(document.querySelector("#zen-pick-overlay")).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(window.eval(ELEMENT_PICK_SCRIPT)).toBe("started");
  });
});
