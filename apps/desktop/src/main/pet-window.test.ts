import { runInNewContext } from "node:vm";
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {
    private position: [number, number] = [0, 0];
    private size: [number, number] = [200, 220];
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
    __zenPetUpdate: (_next: { spriteDataUrl: string; status: string; layout: PetSpriteLayout; runningSessions: string[] }) => {},
    matchMedia: () => motion,
    zen: { pet: { hide: vi.fn() } },
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
  const update = (status: string, layout: PetSpriteLayout, runningSessions: string[] = []) => page.__zenPetUpdate({ spriteDataUrl: "data:image/png;base64,AA==", status, layout, runningSessions });
  return { markup, document, drawImage, motion, motionChange: () => motionChange(), update };
}

describe("petFrameSource", () => {
  it("maps each status to its own row of four 256px frames", () => {
    for (const [status, row] of [
      ["idle", 0],
      ["working", 1],
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
      ["done", 3, 4],
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
      expect(animation.loop).toBe(status === "idle" || status === "working");
    }
  });

  it("uses DimAgent's per-frame intervals and plays waving once", () => {
    const animations = PET_ANIMATIONS["dimagent-v2"];
    expect(animations.idle.durations).toEqual([280, 110, 110, 140, 140, 320]);
    expect(animations.working.durations).toEqual([120, 120, 120, 120, 120, 220]);
    expect(animations.done.durations).toEqual([140, 140, 140, 280]);
    expect(animations.error.durations).toEqual([140, 140, 140, 140, 140, 140, 140, 240]);
    expect(animations.idle.loop).toBe(true);
    expect(animations.working.loop).toBe(true);
    expect(animations.done.loop).toBe(false);
    expect(animations.error.loop).toBe(false);
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

  it.each(["zen-4x4", "dimagent-v2"] as const)("keeps %s idle on its first frame without scheduling", (layout) => {
    vi.useFakeTimers();
    const page = petPage();
    page.update("idle", layout);
    expect(page.drawImage).toHaveBeenCalledTimes(1);
    expect(page.drawImage.mock.lastCall?.[1]).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(page.drawImage).toHaveBeenCalledTimes(1);
  });

  it.each(["zen-4x4", "dimagent-v2"] as const)("plays %s done once after working, then stays idle", (layout) => {
    vi.useFakeTimers();
    const page = petPage();
    page.update("working", layout);
    for (const duration of PET_ANIMATIONS[layout].working.durations.slice(0, 1)) vi.advanceTimersByTime(duration);
    expect(page.drawImage.mock.lastCall?.[1]).toBe(PET_ANIMATIONS[layout].working.width);
    page.update("done", layout);
    expect(vi.getTimerCount()).toBe(1);
    const done = PET_ANIMATIONS[layout].done;
    for (const [index, duration] of done.durations.entries()) {
      vi.advanceTimersByTime(duration);
      expect(page.drawImage.mock.lastCall?.[1]).toBe(index === done.durations.length - 1 ? 0 : (index + 1) * done.width);
    }
    expect(page.drawImage.mock.lastCall?.[2]).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const calls = page.drawImage.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(page.drawImage).toHaveBeenCalledTimes(calls);
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

  it("renders running sessions as text, summarizes overflow and clears stale labels", () => {
    const page = petPage();
    const names = ["项目 <img src=x onerror=alert(1)>", "会话二", "会话三", "会话四", "会话五"];
    page.update("idle", "zen-4x4", names);
    const list = page.document.getElementById("sessions");
    expect([...list!.children].map((node) => node.textContent)).toEqual([...names.slice(0, 3), "+2"]);
    expect(page.document.body.classList.contains("has-sessions")).toBe(true);
    expect(list!.querySelector("img")).toBeNull();
    page.update("idle", "zen-4x4", ["新会话"]);
    expect(list!.textContent).toBe("新会话");
    page.update("idle", "zen-4x4", []);
    expect(list!.children).toHaveLength(0);
    expect(page.document.body.classList.contains("has-sessions")).toBe(false);
  });

  it("keeps the window anchored and clamps position after content size changes", () => {
    const pet = createPetWindow({ onHide: vi.fn() });
    pet.window.setPosition(650, 300);
    pet.resize(300);
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 320);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 280);
    pet.update("data:image/png;base64,AA==", { status: "working", runningSessions: ["会话一"] }, 300, "zen-4x4");
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 396);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 204);
    pet.update("data:image/png;base64,AA==", { status: "idle", runningSessions: [] }, 300, "zen-4x4");
    expect(pet.window.setContentSize).toHaveBeenLastCalledWith(300, 320);
    expect(pet.window.setPosition).toHaveBeenLastCalledWith(500, 280);
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
