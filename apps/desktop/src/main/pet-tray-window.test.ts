import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

const { JSDOM } = require("jsdom") as { JSDOM: new (html: string) => { window: Window & typeof globalThis } };
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {
    options: Record<string, unknown>;
    position: [number, number] = [0, 0];
    size: [number, number];
    visible = false;
    destroyed = false;
    listeners = new Map<string, () => void>();
    webContents = {
      on: vi.fn(), setWindowOpenHandler: vi.fn(), executeJavaScript: vi.fn(async () => undefined),
    };
    constructor(options: { width: number; height: number }) {
      this.options = options;
      this.size = [options.width, options.height];
    }
    on = vi.fn((name: string, callback: () => void) => this.listeners.set(name, callback));
    setMenuBarVisibility = vi.fn();
    loadURL = vi.fn(async () => undefined);
    getSize = () => this.size;
    setContentSize = vi.fn((width: number, height: number) => { this.size = [width, height]; });
    setPosition = vi.fn((x: number, y: number) => { this.position = [x, y]; });
    showInactive = vi.fn(() => { this.visible = true; });
    hide = vi.fn(() => { this.visible = false; });
    isVisible = () => this.visible;
    isDestroyed = () => this.destroyed;
  },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 100, y: 50, width: 800, height: 700 } })),
  },
}));

import { screen } from "electron";
import { isPetTrayWindow, PetTrayWindow } from "./pet-tray-window";
import type { PetTraySession } from "./pet-tray-window";

const session = (id: string): PetTraySession => ({ id, name: id, status: "running", runId: "run-1" });

function page(tray: PetTrayWindow) {
  const url = vi.mocked(tray.window.loadURL).mock.lastCall?.[0];
  if (!url) throw new Error("missing page");
  const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  if (!script || !style) throw new Error("missing inline source");
  const dom = new JSDOM(html);
  const control = vi.fn(async () => undefined);
  const openSession = vi.fn();
  const hide = vi.fn();
  const guest = { zen: { petTray: { control, openSession, hide } }, __zenPetTrayUpdate: (_next: PetTraySession[]) => {} };
  runInNewContext(script, { document: dom.window.document, window: guest, Map, Set, Error, String, Array });
  return { html, script, style, document: dom.window.document, guest, control, openSession, hide };
}

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("PetTrayWindow", () => {
  it("uses isolated secure chrome, hashed CSP, and refuses navigation", () => {
    const tray = new PetTrayWindow();
    const options = tray.window as unknown as { options: { frame: boolean; transparent: boolean; webPreferences: Record<string, unknown> }; webContents: { on: ReturnType<typeof vi.fn>; setWindowOpenHandler: ReturnType<typeof vi.fn> } };
    expect(options.options).toMatchObject({ frame: false, transparent: true });
    expect(options.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(options.options.webPreferences.preload).toMatch(/preload[/\\]pet-tray-guest\.js$/);
    const view = page(tray);
    const hash = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
    expect(view.html).toContain(`script-src ${hash(view.script)}`);
    expect(view.html).toContain(`style-src ${hash(view.style)}`);
    expect(view.html).toContain("default-src 'none'");
    expect(view.html).toContain("connect-src 'none'");
    expect(options.webContents.setWindowOpenHandler.mock.lastCall?.[0]()).toEqual({ action: "deny" });
    const event = { preventDefault: vi.fn() };
    options.webContents.on.mock.calls.find(([name]) => name === "will-navigate")?.[1](event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(isPetTrayWindow(tray.window)).toBe(true);
    (tray.window as unknown as { listeners: Map<string, () => void> }).listeners.get("closed")?.();
    expect(isPetTrayWindow(tray.window)).toBe(false);
    expect(isPetTrayWindow(null)).toBe(false);
  });

  it("anchors above or below on the nearest display and clamps at edges", () => {
    const tray = new PetTrayWindow();
    tray.show({ x: 120, y: 500, width: 100, height: 100 });
    expect(tray.window.showInactive).not.toHaveBeenCalled();
    tray.update([session("one")]);
    tray.show({ x: 840, y: 650, width: 100, height: 100 });
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 890, y: 700 });
    expect(tray.window.setContentSize).toHaveBeenLastCalledWith(360, 106);
    expect(tray.window.setPosition).toHaveBeenLastCalledWith(540, 534);
    tray.show({ x: 110, y: 70, width: 50, height: 50 });
    expect(tray.window.setPosition).toHaveBeenLastCalledWith(100, 130);
    tray.show({ x: 110, y: 380, width: 50, height: 50 });
    expect(tray.window.setPosition).toHaveBeenLastCalledWith(100, 264);
    tray.update([session("one"), session("two")]);
    expect(tray.window.setContentSize).toHaveBeenLastCalledWith(360, 158);
    expect(tray.window.setPosition).toHaveBeenLastCalledWith(100, 212);
    tray.update([]);
    expect(tray.window.hide).toHaveBeenCalledOnce();
  });

  it("pushes only twenty sessions after load and safely renders untrusted text", () => {
    const tray = new PetTrayWindow();
    const view = page(tray);
    const sessions = Array.from({ length: 22 }, (_, index) => session(String(index)));
    const first = sessions[0];
    if (!first) throw new Error("missing first session");
    first.name = `<img src=x onerror=alert(1)>`;
    first.approval = { approvalId: "a", toolName: "<svg/onload=alert(1)>", prompt: "<script>alert(1)</script>", input: { cmd: "<img>" } };
    tray.update(sessions);
    const callbacks = (tray.window.webContents.on as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, () => void]>;
    const loaded = callbacks.find(([name]) => name === "did-finish-load")?.[1];
    if (!loaded) throw new Error("missing load listener");
    loaded();
    const code = vi.mocked(tray.window.webContents.executeJavaScript).mock.lastCall?.[0] as string;
    expect(code).toContain("window.__zenPetTrayUpdate(");
    expect(code).not.toContain("window.__zenPetTrayUpdate([object Object]");
    view.guest.__zenPetTrayUpdate(sessions);
    const rows = view.document.querySelectorAll("article");
    expect(rows).toHaveLength(20);
    expect(rows.item(0)?.textContent).toContain(first.name);
    expect(view.document.querySelector("article img, article svg, article script")).toBeNull();
    expect(view.style).toContain("overflow-y:auto");
    expect(view.document.querySelectorAll("[aria-label]").length).toBeGreaterThan(1);
  });

  it("opens a session and sends stop, approval, deny and always decisions", async () => {
    const tray = new PetTrayWindow();
    const view = page(tray);
    const item = session("s1");
    item.approval = { approvalId: "a1", toolName: "terminal", prompt: "run?" };
    view.guest.__zenPetTrayUpdate([item]);
    (view.document.querySelector("button.name") as HTMLButtonElement).click();
    expect(view.openSession).toHaveBeenCalledWith("s1");
    (view.document.querySelector("button.stop") as HTMLButtonElement).click();
    await tick();
    expect(view.control).toHaveBeenCalledWith({ type: "stop", sessionId: "s1", runId: "run-1" });
    for (const [label, approved, always] of [["批准", true, false], ["拒绝", false, false], ["本会话全部允许", true, true]] as const) {
      view.guest.__zenPetTrayUpdate([{ ...item, approval: { ...item.approval!, approvalId: label } }]);
      const button = [...view.document.querySelectorAll(".actions button")].find(node => node.textContent === label) as HTMLButtonElement;
      button.click();
      await tick();
      expect(view.control).toHaveBeenLastCalledWith({ type: "approval", sessionId: "s1", runId: "run-1", approvalId: label, approved, always });
    }
    (view.document.getElementById("close") as HTMLButtonElement).click();
    expect(view.hide).toHaveBeenCalledOnce();
  });

  it("submits a single option immediately", async () => {
    const view = page(new PetTrayWindow());
    view.guest.__zenPetTrayUpdate([{ ...session("s1"), questions: [{ askId: "one", question: "Which?", options: ["yes", "no"], allowFreeText: false }] }]);
    view.document.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
    await tick();
    expect(view.control).toHaveBeenCalledWith({ type: "answer", sessionId: "s1", runId: "run-1", askId: "one", answer: "yes" });
  });

  it("preserves multi-select/free-text drafts and errors until a successful retry", async () => {
    const tray = new PetTrayWindow();
    const view = page(tray);
    const item = session("s1");
    item.questions = [
      { askId: "multi", question: "Choose", options: ["alpha", { label: "beta", priority: "strong" }], multiSelect: true, allowFreeText: false },
      { askId: "free", question: "Why?", options: [], allowFreeText: true },
    ];
    view.guest.__zenPetTrayUpdate([item]);
    const choices = view.document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    choices.item(0)?.click(); choices.item(1)?.click();
    view.guest.__zenPetTrayUpdate([item]);
    expect([...view.document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(node => node.checked)).toEqual([true, true]);
    view.control.mockRejectedValueOnce(new Error("network failed"));
    (view.document.querySelector('section[data-action-id="ask:multi"] button') as HTMLButtonElement).click();
    await tick();
    expect(view.control).toHaveBeenLastCalledWith({ type: "answer", sessionId: "s1", runId: "run-1", askId: "multi", answer: "alpha、beta" });
    expect(view.document.querySelector('section[data-action-id="ask:multi"] .feedback')?.textContent).toContain("network failed");
    expect([...view.document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(node => node.checked)).toEqual([true, true]);
    (view.document.querySelector('section[data-action-id="ask:multi"] button') as HTMLButtonElement).click();
    await tick();
    expect(view.document.querySelector('section[data-action-id="ask:multi"] button')?.hasAttribute("disabled")).toBe(true);
    const free = view.document.querySelector("textarea")!;
    free.value = "  explanation  "; free.dispatchEvent(new view.document.defaultView!.Event("input", { bubbles: true }));
    (view.document.querySelector('section[data-action-id="ask:free"] button') as HTMLButtonElement).click();
    await tick();
    expect(view.control).toHaveBeenLastCalledWith({ type: "answer", sessionId: "s1", runId: "run-1", askId: "free", answer: "explanation" });
  });
});
