import { runInNewContext } from "node:vm";
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {
    private position: [number, number] = [0, 0];
    private size: [number, number] = [200, 200];
    setPosition = vi.fn((x: number, y: number) => { this.position = [x, y]; });
    getPosition = () => this.position;
    getSize = () => this.size;
    setContentSize = vi.fn((width: number, height: number) => { this.size = [width, height]; });
    isDestroyed = () => false;
    setMenuBarVisibility = vi.fn();
    on = vi.fn();
    loadURL = vi.fn(async () => undefined);
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
  },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }),
  },
}));

import { createPetWindow, PET_ANIMATIONS, petFrameSource } from "./pet-window";
import type { PetActivity } from "@zen/shared";
import type { PetSpriteLayout } from "./pet-window";

function petMarkup(): string {
  const { window } = createPetWindow({ onHide: vi.fn() });
  const url = vi.mocked(window.loadURL).mock.lastCall?.[0];
  if (!url) throw new Error("Pet window did not load its HTML");
  return decodeURIComponent(url.slice(url.indexOf(",") + 1));
}

function petPage() {
  const markup = petMarkup();
  const script = markup.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Pet window script not found");
  const drawImage = vi.fn();
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  vi.spyOn(document.getElementById("sprite") as HTMLCanvasElement, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage } as never);
  let motionChange = () => {};
  const motion = { matches: false, addEventListener: vi.fn((_event: string, callback: () => void) => { motionChange = callback; }) };
  const page = {
    __zenPetUpdate: (_next: PetActivity & { spriteDataUrl: string; layout: PetSpriteLayout }) => {},
    matchMedia: () => motion,
    zen: { pet: { hide: vi.fn(), showTray: vi.fn(), toggleTray: vi.fn() } },
  };
  runInNewContext(script, {
    window: page,
    document,
    Image: class {
      onload?: () => void;
      set src(_value: string) { this.onload?.(); }
    },
    setTimeout,
    clearTimeout,
  });
  const update = (status: PetActivity["status"], layout: PetSpriteLayout, sessions: PetActivity["sessions"] = []) => page.__zenPetUpdate({ spriteDataUrl: "data:image/png;base64,AA==", status, layout, sessions });
  return { markup, document, drawImage, motion, pet: page.zen.pet, motionChange: () => motionChange(), update };
}

describe("petFrameSource", () => {
  it("maps Zen statuses to four 256px frames, with waiting falling back to idle", () => {
    for (const [status, row] of [
      ["idle", 0],
      ["working", 1],
      ["waiting", 0],
      ["done", 2],
      ["error", 3],
    ] as const) {
      for (let frame = 0; frame < 4; frame++) {
        expect(petFrameSource(status, frame)).toEqual({ x: frame * 256, y: row * 256, size: 256 });
      }
    }
  });

  it("loops to the first frame after the fourth", () => {
    expect(petFrameSource("working", 4)).toEqual(petFrameSource("working", 0));
    expect(petFrameSource("error", 7)).toEqual(petFrameSource("error", 3));
  });

  it("maps DimAgent statuses to 192×208 frames within the 8×11 sheet", () => {
    for (const [status, row, count] of [
      ["idle", 0, 6],
      ["working", 7, 6],
      ["waiting", 6, 6],
      ["done", 8, 6],
      ["error", 5, 8],
    ] as const) {
      for (let frame = 0; frame < count; frame++) {
        expect(petFrameSource(status, frame, "dimagent-v2")).toEqual({
          x: frame * 192, y: row * 208, width: 192, height: 208,
        });
      }
      expect(petFrameSource(status, count, "dimagent-v2")).toEqual(petFrameSource(status, 0, "dimagent-v2"));
    }
    expect(petFrameSource("error", 7, "dimagent-v2")).toEqual({ x: 1344, y: 1040, width: 192, height: 208 });
  });
});

describe("pet animation timing", () => {
  it("preserves Zen's four 200ms frames and plays done once", () => {
    for (const [status, animation] of Object.entries(PET_ANIMATIONS["zen-4x4"])) {
      expect(animation.durations).toEqual([200, 200, 200, 200]);
      expect(animation.loop).toBe(status === "idle" || status === "working" || status === "waiting");
    }
  });

  it("uses the V2 idle, running, waiting, review and failed row timing", () => {
    const animations = PET_ANIMATIONS["dimagent-v2"];
    expect(animations.idle.durations).toEqual([280, 110, 110, 140, 140, 320]);
    expect(animations.working.durations).toEqual([120, 120, 120, 120, 120, 220]);
    expect(animations.waiting.durations).toEqual([150, 150, 150, 150, 150, 260]);
    expect(animations.done.durations).toEqual([150, 150, 150, 150, 150, 280]);
    expect(animations.error.durations).toEqual([140, 140, 140, 140, 140, 140, 140, 240]);
    expect(animations.idle.loop).toBe(true);
    expect(animations.working.loop).toBe(true);
    expect(animations.waiting.loop).toBe(true);
    expect(animations.done.loop).toBe(true);
    expect(animations.error.loop).toBe(true);
  });
});

describe("pet window page", () => {
  afterEach(() => vi.useRealTimers());

  it("makes the entire canvas draggable without covering the clickable hide button", () => {
    const markup = petMarkup();
    expect(markup).toMatch(/canvas\{[^}]*width:100%;[^}]*-webkit-app-region:drag\}/);
    expect(markup).toMatch(/#hide\{[^}]*position:absolute;z-index:1;[^}]*-webkit-app-region:no-drag\}/);
    expect(markup).toContain('<button id="hide" type="button" aria-label="隐藏桌面宠物"');
    expect(markup).toMatch(/id="hide"[^>]*><svg[^>]*aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"\/><\/svg><\/button>/);
    expect(markup).not.toContain('id="handle"');
  });

  it("uses transparent chrome and reveals one circular close control only on hover or keyboard focus", () => {
    const markup = petMarkup();
    expect(markup).toContain("background:transparent");
    expect(markup).toMatch(/#hide\{[^}]*border-radius:50%;background:transparent;[^}]*opacity:0;pointer-events:none;/);
    expect(markup).toContain("body:hover #hide,body:focus-within #hide{opacity:1;pointer-events:auto}");
    expect(markup).toMatch(/#hide\{[^}]*top:calc\(var\(--header-height\) \+ 4px\)/);
    expect(markup).toMatch(/#sessions\{[^}]*top:4px;[^}]*height:28px;[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis;[^}]*-webkit-app-region:no-drag\}/);
    expect(markup).toContain('<button id="sessions" type="button" aria-label="查看会话状态" hidden>');
    expect(markup.match(/<button /g)).toHaveLength(2);
  });

  it("keeps Zen idle and waiting static", () => {
    vi.useFakeTimers();
    const page = petPage();
    page.update("idle", "zen-4x4");
    page.update("waiting", "zen-4x4");
    expect(page.drawImage.mock.lastCall?.[1]).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const calls = page.drawImage.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(page.drawImage).toHaveBeenCalledTimes(calls);
  });

  it("loops V2 idle, waiting, review and failed animations without restarting on an identical snapshot", () => {
    vi.useFakeTimers();
    const page = petPage();
    for (const status of ["idle", "waiting", "done", "error"] as const) {
      page.update(status, "dimagent-v2");
      const animation = PET_ANIMATIONS["dimagent-v2"][status];
      expect(page.drawImage.mock.lastCall?.[2]).toBe(animation.row * animation.height);
      vi.advanceTimersByTime(animation.durations[0]!);
      expect(page.drawImage.mock.lastCall?.[1]).toBe(animation.width);
      const calls = page.drawImage.mock.calls.length;
      page.update(status, "dimagent-v2", [{ id: "s1", name: "任务", status: "running" }]);
      expect(page.drawImage).toHaveBeenCalledTimes(calls);
      vi.advanceTimersByTime(animation.durations.slice(1).reduce((sum, duration) => sum + duration, 0));
      expect(page.drawImage.mock.lastCall?.[1]).toBe(0);
      expect(vi.getTimerCount()).toBe(1);
    }
  });

  it("plays Zen done once after working, then stays idle", () => {
    vi.useFakeTimers();
    const page = petPage();
    page.update("working", "zen-4x4");
    vi.advanceTimersByTime(PET_ANIMATIONS["zen-4x4"].working.durations[0]!);
    page.update("done", "zen-4x4");
    const done = PET_ANIMATIONS["zen-4x4"].done;
    for (const [index, duration] of done.durations.entries()) {
      vi.advanceTimersByTime(duration);
      expect(page.drawImage.mock.lastCall?.[1]).toBe(index === done.durations.length - 1 ? 0 : (index + 1) * done.width);
    }
    expect(page.drawImage.mock.lastCall?.[2]).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the old working timer when switching to idle", () => {
    vi.useFakeTimers();
    const page = petPage();
    page.update("working", "zen-4x4");
    page.update("idle", "zen-4x4");
    const calls = page.drawImage.mock.calls.length;
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(page.drawImage).toHaveBeenCalledTimes(calls);
  });

  it("renders only a safe single-line summary and opens the tray on hover or click", () => {
    const page = petPage();
    const summary = page.document.getElementById("sessions") as HTMLButtonElement;
    expect(summary.hidden).toBe(true);
    page.update("waiting", "zen-4x4", [{ id: "s1", name: "项目 <img src=x onerror=alert(1)>", status: "needs_action" }]);
    expect(summary.textContent).toBe("项目 <img src=x onerror=alert(1)> · 待处理");
    expect(summary.querySelector("img")).toBeNull();
    expect(summary.hidden).toBe(false);
    expect(page.document.body.dataset.hasSessions).toBe("true");
    summary.dispatchEvent(new page.document.defaultView!.Event("mouseenter"));
    summary.click();
    expect(page.pet.showTray).toHaveBeenCalledTimes(2);
    expect(page.pet.toggleTray).not.toHaveBeenCalled();
    page.update("waiting", "zen-4x4", [
      { id: "s1", name: "一", status: "running" },
      { id: "s2", name: "二", status: "needs_action" },
      { id: "s3", name: "三", status: "done" },
      { id: "s4", name: "四", status: "error" },
    ]);
    expect(summary.textContent).toBe("4 个会话 · 1 运行中 · 1 待处理 · 1 已完成 · 1 异常");
    expect(summary.children).toHaveLength(0);
    page.update("idle", "zen-4x4", []);
    expect(summary.hidden).toBe(true);
    expect(summary.textContent).toBe("");
    expect(page.document.body.dataset.hasSessions).toBe("false");
  });

  it("reserves a single summary line for any nonempty session count while anchoring the sprite", () => {
    const pet = createPetWindow({ onHide: vi.fn() });
    const session = (name: string): PetActivity["sessions"][number] => ({ id: name, name, status: "running" });
    pet.window.setPosition(650, 300);
    pet.resize(300);
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 300);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 300);
    pet.update(null, { status: "working", sessions: [session("一")] }, 300, "zen-4x4");
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 336);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 264);
    pet.update(null, { status: "working", sessions: [session("一"), session("二"), session("三")] }, 300, "zen-4x4");
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 336);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 264);
    pet.update(null, { status: "working", sessions: Array.from({ length: 8 }, (_, index) => session(String(index))) }, 300, "zen-4x4");
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 336);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 264);
    pet.update(null, { status: "idle", sessions: [] }, 300, "zen-4x4");
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 300);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 300);
  });

  it("respects reduced motion when a status changes", () => {
    vi.useFakeTimers();
    const page = petPage();
    page.update("working", "dimagent-v2");
    page.motion.matches = true;
    page.motionChange();
    expect(page.drawImage.mock.lastCall?.[1]).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    page.update("done", "dimagent-v2");
    expect(vi.getTimerCount()).toBe(0);
  });
});
