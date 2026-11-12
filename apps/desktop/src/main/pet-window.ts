import { createHash } from "node:crypto";
import { join } from "node:path";

import { BrowserWindow, screen } from "electron";

import type { PetActivity, PetStatus } from "@zen/shared";

const MIN_SIZE = 100;
const MAX_SIZE = 300;
const BASE_HEADER_HEIGHT = 20;
const SESSIONS_HEADER_HEIGHT = 96;
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
#sessions{position:absolute;top:28px;left:4px;right:4px;height:68px;display:flex;flex-direction:column;align-items:center;gap:2px;overflow:hidden;-webkit-app-region:drag}
#sessions:empty{display:none}
#sessions span{display:block;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:5px;background:rgba(24,24,24,.82);color:#fff;font-size:11px;line-height:13px;pointer-events:none}
canvas{position:absolute;top:${BASE_HEADER_HEIGHT}px;left:0;display:block;width:100%;height:calc(100% - ${BASE_HEADER_HEIGHT}px);-webkit-app-region:drag}
body.has-sessions canvas{top:${SESSIONS_HEADER_HEIGHT}px;height:calc(100% - ${SESSIONS_HEADER_HEIGHT}px)}
#hide{position:absolute;z-index:1;top:0;right:0;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:0 0 0 8px;background:rgba(24,24,24,.72);color:#fff;cursor:pointer;-webkit-app-region:no-drag}
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
let requestedStatus = null;
let spriteDataUrl = null;
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
function renderSessions(names) {
  const list = document.getElementById('sessions');
  list.replaceChildren();
  document.body.classList.toggle('has-sessions', names.length > 0);
  for (const name of names.slice(0, 3)) {
    const label = document.createElement('span');
    label.textContent = name;
    list.appendChild(label);
  }
  if (names.length > 3) {
    const remaining = document.createElement('span');
    remaining.textContent = '+' + (names.length - 3);
    list.appendChild(remaining);
  }
}
window.__zenPetUpdate = function (next) {
  renderSessions(next.runningSessions);
  const nextLayout = Object.hasOwn(animations, next.layout) ? next.layout : 'zen-4x4';
  const nextStatus = Object.hasOwn(animations[nextLayout], next.status) ? next.status : 'idle';
  if (requestedStatus === nextStatus && layout === nextLayout && spriteDataUrl === next.spriteDataUrl) return;
  clearTimeout(timer);
  timer = null;
  layout = nextLayout;
  status = requestedStatus = nextStatus;
  spriteDataUrl = next.spriteDataUrl;
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

const PET_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspHash(SCRIPT)}; style-src ${cspHash(STYLE)}; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${STYLE}</style></head><body><div id="sessions" aria-label="运行中的会话"></div><canvas id="sprite" width="256" height="256" aria-label="桌面宠物"></canvas><button id="hide" type="button" aria-label="隐藏桌面宠物" title="隐藏桌面宠物"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button><script>${SCRIPT}</script></body></html>`;

const petWindows = new WeakSet<BrowserWindow>();

export function isPetWindow(window: BrowserWindow | null): boolean {
  return window !== null && petWindows.has(window);
}

/** The owner controls the window lifetime and persists its position if desired. */
export class PetWindow {
  readonly window: BrowserWindow;
  private spriteDataUrl: string | null = null;
  private activity: PetActivity = { status: "idle", runningSessions: [] };
  private headerHeight = BASE_HEADER_HEIGHT;
  private layout: PetSpriteLayout = "zen-4x4";
  private loaded = false;

  constructor(private readonly options: { onHide: () => void }) {
    const window = new BrowserWindow({
      width: 200,
      height: 200 + BASE_HEADER_HEIGHT,
      minWidth: MIN_SIZE,
      minHeight: MIN_SIZE + BASE_HEADER_HEIGHT,
      maxWidth: MAX_SIZE,
      maxHeight: MAX_SIZE + SESSIONS_HEADER_HEIGHT,
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
    window.setPosition(area.x + Math.max(0, area.width - 220), area.y + Math.max(0, area.height - 240));
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

  update(spriteDataUrl: string | null, activity: PetActivity, size: number, layout: PetSpriteLayout): void {
    this.spriteDataUrl = spriteDataUrl;
    this.activity = { status: activity.status, runningSessions: [...activity.runningSessions] };
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
    if (this.window.isDestroyed()) return;
    const position = this.getPosition();
    const headerHeight = this.activity.runningSessions.length ? SESSIONS_HEADER_HEIGHT : BASE_HEADER_HEIGHT;
    this.window.setContentSize(petSize(size), petSize(size) + headerHeight);
    this.restorePosition(position.x, position.y + this.headerHeight - headerHeight);
    this.headerHeight = headerHeight;
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
    const nextX = Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width)));
    const nextY = Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height)));
    const current = this.getPosition();
    if (nextX !== current.x || nextY !== current.y) this.window.setPosition(nextX, nextY);
  }

  private sendUpdate(): void {
    if (!this.loaded || this.window.isDestroyed()) return;
    const payload = JSON.stringify({ spriteDataUrl: this.spriteDataUrl, ...this.activity, layout: this.layout });
    void this.window.webContents.executeJavaScript(`window.__zenPetUpdate(${payload})`).catch(() => undefined);
  }
}

export function createPetWindow(options: { onHide: () => void }): PetWindow {
  return new PetWindow(options);
}
