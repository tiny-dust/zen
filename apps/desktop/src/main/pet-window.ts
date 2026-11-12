import { createHash } from "node:crypto";
import { join } from "node:path";

import { BrowserWindow, screen } from "electron";

import type { PetStatus } from "@zen/shared";

const MIN_SIZE = 100;
const MAX_SIZE = 300;
export type PetSpriteLayout = "zen-4x4" | "dimagent-v2";

interface PetAnimation {
  row: number;
  width: number;
  height: number;
  durations: readonly number[];
  loop: boolean;
}

const zenAnimation = (row: number): PetAnimation => ({ row, width: 256, height: 256, durations: [200, 200, 200, 200], loop: true });

export const PET_ANIMATIONS: Record<PetSpriteLayout, Record<PetStatus, PetAnimation>> = {
  "zen-4x4": {
    idle: zenAnimation(0),
    working: zenAnimation(1),
    done: { ...zenAnimation(2), loop: false },
    error: { ...zenAnimation(3), loop: false },
  },
  "dimagent-v2": {
    idle: { row: 0, width: 192, height: 208, durations: [280, 110, 110, 140, 140, 320], loop: true },
    working: { row: 7, width: 192, height: 208, durations: [120, 120, 120, 120, 120, 220], loop: true },
    done: { row: 3, width: 192, height: 208, durations: [140, 140, 140, 280], loop: false },
    error: { row: 5, width: 192, height: 208, durations: [140, 140, 140, 140, 140, 140, 140, 240], loop: false },
  },
};

/** Source rectangle in the selected sprite sheet (Zen retains its original size field). */
export function petFrameSource(status: PetStatus, frame: number, layout: PetSpriteLayout = "zen-4x4") {
  const animation = PET_ANIMATIONS[layout][status];
  const index = ((Math.floor(frame) % animation.durations.length) + animation.durations.length) % animation.durations.length;
  const x = index * animation.width;
  const y = animation.row * animation.height;
  return layout === "zen-4x4"
    ? { x, y, size: animation.width }
    : { x, y, width: animation.width, height: animation.height };
}

function petSize(size: number): number {
  return Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size))) : MIN_SIZE;
}

const STYLE = `
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
canvas{display:block;width:100%;height:calc(100% - 20px);margin-top:20px;-webkit-app-region:drag}
#hide{position:absolute;z-index:1;top:0;right:0;min-width:38px;height:24px;padding:0 5px;border:0;border-radius:0 0 0 8px;background:rgba(24,24,24,.72);color:#fff;font:12px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;-webkit-app-region:no-drag}
#hide:hover,#hide:focus-visible{background:rgba(24,24,24,.95)}
`;

const SCRIPT = `
const canvas = document.getElementById('sprite');
const context = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const animations = ${JSON.stringify(PET_ANIMATIONS)};
let image = null;
let layout = 'zen-4x4';
let status = 'idle';
let frame = 0;
let generation = 0;
let timer = null;
function animation() { return animations[layout][status]; }
function draw() {
  context.clearRect(0, 0, 256, 256);
  if (!image) return;
  const current = animation();
  const scale = Math.min(256 / current.width, 256 / current.height);
  const width = current.width * scale;
  const height = current.height * scale;
  context.drawImage(image, frame * current.width, current.row * current.height,
    current.width, current.height, (256 - width) / 2, (256 - height) / 2, width, height);
}
function advance() {
  timer = null;
  const current = animation();
  if (frame + 1 === current.durations.length) {
    if (!current.loop) status = 'idle';
    frame = 0;
  } else frame++;
  draw();
  schedule();
}
function schedule() {
  if (!image || reducedMotion.matches || status === 'idle') return;
  timer = setTimeout(advance, animation().durations[frame]);
}
window.__zenPetUpdate = function (next) {
  clearTimeout(timer);
  timer = null;
  layout = Object.hasOwn(animations, next.layout) ? next.layout : 'zen-4x4';
  status = Object.hasOwn(animations[layout], next.status) ? next.status : 'idle';
  frame = 0;
  const current = ++generation;
  image = null;
  draw();
  if (!next.spriteDataUrl) return;
  const incoming = new Image();
  incoming.onload = function () {
    if (current !== generation) return;
    image = incoming;
    draw();
    schedule();
  };
  incoming.src = next.spriteDataUrl;
};
reducedMotion.addEventListener('change', function () {
  clearTimeout(timer);
  timer = null;
  frame = 0;
  draw();
  schedule();
});
document.getElementById('hide').addEventListener('click', function () {
  window.zen.pet.hide();
});
`;

function cspHash(content: string): string {
  return `'sha256-${createHash("sha256").update(content).digest("base64")}'`;
}

const PET_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspHash(SCRIPT)}; style-src ${cspHash(STYLE)}; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${STYLE}</style></head><body><canvas id="sprite" width="256" height="256" aria-label="桌面宠物"></canvas><button id="hide" type="button" aria-label="隐藏桌面宠物" title="隐藏桌面宠物">隐藏</button><script>${SCRIPT}</script></body></html>`;

const petWindows = new WeakSet<BrowserWindow>();

export function isPetWindow(window: BrowserWindow | null): boolean {
  return window !== null && petWindows.has(window);
}

/** The owner controls the window lifetime and persists its position if desired. */
export class PetWindow {
  readonly window: BrowserWindow;
  private spriteDataUrl: string | null = null;
  private status: PetStatus = "idle";
  private layout: PetSpriteLayout = "zen-4x4";
  private loaded = false;

  constructor(private readonly options: { onHide: () => void }) {
    const window = new BrowserWindow({
      width: 200,
      height: 220,
      minWidth: MIN_SIZE,
      minHeight: MIN_SIZE + 20,
      maxWidth: MAX_SIZE,
      maxHeight: MAX_SIZE + 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      resizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, "../preload/pet-guest.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.window = window;
    petWindows.add(window);
    const area = screen.getPrimaryDisplay().workArea;
    window.setPosition(area.x + area.width - 220, area.y + area.height - 240);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("did-finish-load", () => {
      this.loaded = true;
      this.sendUpdate();
    });
    window.on("closed", () => {
      this.loaded = false;
      petWindows.delete(window);
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PET_HTML)}`).catch(() => undefined);
  }

  update(spriteDataUrl: string | null, status: PetStatus, size: number, layout: PetSpriteLayout): void {
    this.spriteDataUrl = spriteDataUrl;
    this.status = status;
    this.layout = layout;
    this.resize(size);
    this.sendUpdate();
  }

  show(): void {
    if (!this.window.isDestroyed()) this.window.showInactive();
  }

  hide(): void {
    if (this.window.isDestroyed() || !this.window.isVisible()) return;
    this.window.hide();
    this.options.onHide();
  }

  resize(size: number): void {
    if (!this.window.isDestroyed()) this.window.setContentSize(petSize(size), petSize(size) + 20);
  }

  getPosition(): { x: number; y: number } {
    const [x = 0, y = 0] = this.window.getPosition();
    return { x, y };
  }

  /** Keep a saved position reachable when displays or work areas have changed. */
  restorePosition(x: number, y: number): void {
    if (this.window.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const [width = MIN_SIZE, height = MIN_SIZE] = this.window.getSize();
    const area = screen.getDisplayNearestPoint({ x, y }).workArea;
    this.window.setPosition(
      Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    );
  }

  private sendUpdate(): void {
    if (!this.loaded || this.window.isDestroyed()) return;
    const payload = JSON.stringify({ spriteDataUrl: this.spriteDataUrl, status: this.status, layout: this.layout });
    void this.window.webContents.executeJavaScript(`window.__zenPetUpdate(${payload})`).catch(() => undefined);
  }
}

export function createPetWindow(options: { onHide: () => void }): PetWindow {
  return new PetWindow(options);
}
