import { createHash } from "node:crypto";
import { join } from "node:path";

import { BrowserWindow, screen } from "electron";

import type { PetStatus } from "@zen/shared";

const MIN_SIZE = 100;
const MAX_SIZE = 300;
const FRAME_SIZE = 256;
const FRAMES_PER_ROW = 4;

const STATUS_ROWS: Record<PetStatus, number> = {
  idle: 0,
  working: 1,
  done: 2,
  error: 3,
};

/** Source rectangle in the 1024×1024, four-by-four sprite sheet. */
export function petFrameSource(status: PetStatus, frame: number): { x: number; y: number; size: number } {
  return {
    x: ((Math.floor(frame) % FRAMES_PER_ROW) + FRAMES_PER_ROW) % FRAMES_PER_ROW * FRAME_SIZE,
    y: STATUS_ROWS[status] * FRAME_SIZE,
    size: FRAME_SIZE,
  };
}

function petSize(size: number): number {
  return Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size))) : MIN_SIZE;
}

const STYLE = `
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
canvas{display:block;width:100%;height:calc(100% - 20px);margin-top:20px}
#handle{position:absolute;top:0;left:0;width:38px;height:22px;border-radius:0 0 8px 0;background:rgba(24,24,24,.5);-webkit-app-region:drag;cursor:grab}
#hide{position:absolute;top:0;right:0;min-width:38px;height:24px;padding:0 5px;border:0;border-radius:0 0 0 8px;background:rgba(24,24,24,.72);color:#fff;font:12px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;-webkit-app-region:no-drag}
#hide:hover,#hide:focus-visible{background:rgba(24,24,24,.95)}
`;

const SCRIPT = `
const canvas = document.getElementById('sprite');
const context = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let image = null;
let status = 'idle';
let frame = 0;
let generation = 0;
const rows = { idle: 0, working: 1, done: 2, error: 3 };
function draw() {
  context.clearRect(0, 0, 256, 256);
  if (!image) return;
  context.drawImage(image, (reducedMotion.matches ? 0 : frame) * 256, rows[status] * 256, 256, 256, 0, 0, 256, 256);
}
window.__zenPetUpdate = function (next) {
  status = Object.hasOwn(rows, next.status) ? next.status : 'idle';
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
  };
  incoming.src = next.spriteDataUrl;
};
setInterval(function () {
  if (!image || reducedMotion.matches) return;
  frame = (frame + 1) % 4;
  draw();
}, 200);
reducedMotion.addEventListener('change', function () { frame = 0; draw(); });
document.getElementById('hide').addEventListener('click', function () {
  window.zen.pet.setVisible(false);
});
`;

function cspHash(content: string): string {
  return `'sha256-${createHash("sha256").update(content).digest("base64")}'`;
}

const PET_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspHash(SCRIPT)}; style-src ${cspHash(STYLE)}; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${STYLE}</style></head><body><canvas id="sprite" width="256" height="256" aria-label="桌面宠物"></canvas><div id="handle" aria-hidden="true"></div><button id="hide" type="button" aria-label="隐藏桌面宠物" title="隐藏桌面宠物">隐藏</button><script>${SCRIPT}</script></body></html>`;

const petWindows = new WeakSet<BrowserWindow>();

export function isPetWindow(window: BrowserWindow | null): boolean {
  return window !== null && petWindows.has(window);
}

/** The owner controls the window lifetime and persists its position if desired. */
export class PetWindow {
  readonly window: BrowserWindow;
  private spriteDataUrl: string | null = null;
  private status: PetStatus = "idle";
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

  update(spriteDataUrl: string | null, status: PetStatus, size: number): void {
    this.spriteDataUrl = spriteDataUrl;
    this.status = status;
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
    if (!this.window.isDestroyed()) this.window.setContentSize(petSize(size), petSize(size));
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
    const payload = JSON.stringify({ spriteDataUrl: this.spriteDataUrl, status: this.status });
    void this.window.webContents.executeJavaScript(`window.__zenPetUpdate(${payload})`).catch(() => undefined);
  }
}

export function createPetWindow(options: { onHide: () => void }): PetWindow {
  return new PetWindow(options);
}
