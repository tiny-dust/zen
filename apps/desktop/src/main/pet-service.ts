import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { app, BrowserWindow, ipcMain, nativeImage } from "electron";

import type { PetGenerateInput, PetState, PetStatus } from "@zen/shared";
import { generatePetSprite } from "./pet-image";
import { createPetWindow, isPetWindow, type PetWindow } from "./pet-window";

interface StoredPetState {
  enabled: boolean;
  size: number;
  sourceFile: string | null;
  spriteFile: string | null;
  position: { x: number; y: number } | null;
}

const DEFAULT_STATE: StoredPetState = { enabled: false, size: 160, sourceFile: null, spriteFile: null, position: null };
const ASSET_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
let statePromise: Promise<StoredPetState> | null = null;
let pendingWrite: Promise<unknown> = Promise.resolve();
let petWindow: PetWindow | null = null;
let status: PetStatus = "idle";
let generating = false;
let registered = false;
let positionTimer: ReturnType<typeof setTimeout> | null = null;
let mainWindowGetter: (() => BrowserWindow | null) | null = null;
let hidingByService = false;

function petDir(): string { return join(app.getPath("userData"), "pets"); }
function assetPath(name: unknown): string | null {
  if (typeof name !== "string" || basename(name) !== name || !ASSET_NAME.test(name)) return null;
  const root = resolve(petDir(), "assets");
  const file = resolve(root, name);
  return dirname(file) === root ? file : null;
}
function validSize(size: unknown): size is number {
  return typeof size === "number" && Number.isInteger(size) && size >= 100 && size <= 300;
}
function validStatus(value: unknown): value is PetStatus {
  return value === "idle" || value === "working" || value === "done" || value === "error";
}
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function loadState(): Promise<StoredPetState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(petDir(), "state.json"), "utf8"));
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_STATE };
    const data = parsed as Partial<StoredPetState>;
    const position = data.position;
    return {
      enabled: data.enabled === true,
      size: validSize(data.size) ? data.size : DEFAULT_STATE.size,
      sourceFile: typeof data.sourceFile === "string" && assetPath(data.sourceFile) ? data.sourceFile : null,
      spriteFile: typeof data.spriteFile === "string" && assetPath(data.spriteFile) && data.spriteFile.endsWith(".png") ? data.spriteFile : null,
      position: position && typeof position === "object" && Number.isInteger(position.x) && Number.isInteger(position.y) ? { x: position.x, y: position.y } : null,
    };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return { ...DEFAULT_STATE };
    throw error;
  }
}
function currentState(): Promise<StoredPetState> {
  return statePromise ??= loadState();
}
async function persist(next: StoredPetState): Promise<void> {
  const directory = petDir();
  await mkdir(directory, { recursive: true });
  const tmp = join(directory, `${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(next), { flag: "wx" });
  await rename(tmp, join(directory, "state.json"));
}
function changeState(change: (previous: StoredPetState) => StoredPetState): Promise<StoredPetState> {
  const operation = pendingWrite.then(async () => {
    const previous = await currentState();
    const next = change(previous);
    await persist(next);
    statePromise = Promise.resolve(next);
    return next;
  });
  pendingWrite = operation.catch(() => undefined);
  return operation;
}
async function readAsset(name: string | null, mime: string): Promise<string | null> {
  const file = assetPath(name);
  if (!file) return null;
  try {
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function publicState(state: StoredPetState): Promise<PetState> {
  const [spriteDataUrl, sourceDataUrl] = await Promise.all([
    readAsset(state.spriteFile, "image/png"),
    readAsset(state.sourceFile, state.sourceFile?.endsWith(".jpg") ? "image/jpeg" : state.sourceFile?.endsWith(".webp") ? "image/webp" : "image/png"),
  ]);
  return { enabled: state.enabled && spriteDataUrl !== null, size: state.size, spriteDataUrl, sourceDataUrl };
}
function broadcast(state: PetState): void {
  const main = mainWindowGetter?.();
  if (main && !main.isDestroyed() && !main.webContents.isDestroyed()) main.webContents.send("pet:changed", state);
}
function ensureWindow(state: StoredPetState, spriteDataUrl: string): void {
  if (!petWindow || petWindow.window.isDestroyed()) {
    petWindow = createPetWindow({ onHide: () => {
      if (hidingByService) return;
      void changeState((previous) => ({ ...previous, enabled: false }))
        .then(publicState).then(broadcast).catch((error: unknown) => console.warn("[zen] 保存宠物可见状态失败:", error));
    } });
    const window = petWindow;
    window.window.on("moved", () => {
      if (positionTimer) clearTimeout(positionTimer);
      positionTimer = setTimeout(() => {
        positionTimer = null;
        if (window.window.isDestroyed()) return;
        const position = window.getPosition();
        void changeState((previous) => ({ ...previous, position })).catch((error: unknown) => console.warn("[zen] 保存宠物位置失败:", error));
      }, 300);
    });
    if (state.position) window.restorePosition(state.position.x, state.position.y);
  }
  petWindow.update(spriteDataUrl, status, state.size);
  petWindow.show();
}
function checkSender(event: Electron.IpcMainInvokeEvent, allowPet = false): void {
  const main = mainWindowGetter?.();
  if (main && !main.isDestroyed() && event.sender === main.webContents) return;
  if (allowPet && isPetWindow(BrowserWindow.fromWebContents(event.sender))) return;
  throw new Error("未经授权的宠物 IPC 请求");
}
function validateSprite(sprite: Buffer): void {
  if (!sprite.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("生成图片必须是 PNG");
  const image = nativeImage.createFromBuffer(sprite);
  const { width, height } = image.getSize();
  if (image.isEmpty() || width !== 1024 || height !== 1024) throw new Error("生成图片必须是 1024×1024 PNG");
  const bitmap = image.toBitmap();
  if (bitmap.length !== width * height * 4) throw new Error("生成图片像素数据无效");
  let transparent = false;
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] !== 255) { transparent = true; break; }
  }
  if (!transparent) throw new Error("生成图片必须包含透明区域");
}

/** IPC 仅注册一次；activate 重建主窗时更新 getter 即可。 */
export function registerPetIpc(getMainWindow: () => BrowserWindow | null): void {
  mainWindowGetter = getMainWindow;
  if (registered) return;
  registered = true;
  ipcMain.handle("pet:get", async (event) => {
    checkSender(event, true);
    return publicState(await currentState());
  });
  ipcMain.handle("pet:generate", async (event, input: PetGenerateInput) => {
    checkSender(event);
    if (generating) throw new Error("宠物图片正在生成，请勿重复提交");
    generating = true;
    try {
      const { source, sprite } = await generatePetSprite(input);
      validateSprite(sprite);
      const sourceMime = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(input.sourceDataUrl)?.[1]?.toLowerCase();
      if (!sourceMime) throw new Error("原图格式无效");
      const sourceName = `${randomUUID()}.${sourceMime === "image/jpeg" ? "jpg" : sourceMime.split("/")[1]}`;
      const spriteName = `${randomUUID()}.png`;
      await mkdir(join(petDir(), "assets"), { recursive: true });
      await writeFile(join(petDir(), "assets", sourceName), source, { flag: "wx" });
      await writeFile(join(petDir(), "assets", spriteName), sprite, { flag: "wx" });
      const next = await changeState((previous) => ({ ...previous, sourceFile: sourceName, spriteFile: spriteName, enabled: true }));
      const result = await publicState(next);
      if (result.spriteDataUrl) ensureWindow(next, result.spriteDataUrl);
      broadcast(result);
      return result;
    } finally {
      generating = false;
    }
  });
  ipcMain.handle("pet:set-visible", async (event, visible: unknown) => {
    checkSender(event, visible === false);
    if (typeof visible !== "boolean") throw new Error("无效的可见状态");
    if (visible && !(await publicState(await currentState())).spriteDataUrl) throw new Error("宠物图片不存在");
    const next = await changeState((previous) => ({ ...previous, enabled: visible }));
    const result = await publicState(next);
    if (result.enabled && result.spriteDataUrl) ensureWindow(next, result.spriteDataUrl);
    else {
      hidingByService = true;
      try { petWindow?.hide(); } finally { hidingByService = false; }
    }
    broadcast(result);
    return result;
  });
  ipcMain.handle("pet:set-size", async (event, size: unknown) => {
    checkSender(event);
    if (!validSize(size)) throw new Error("宠物大小必须是 100–300 的整数");
    const next = await changeState((previous) => ({ ...previous, size }));
    const result = await publicState(next);
    if (result.enabled && result.spriteDataUrl) petWindow?.update(result.spriteDataUrl, status, size);
    broadcast(result);
    return result;
  });
  ipcMain.handle("pet:set-status", (event, value: unknown): void => {
    checkSender(event);
    if (!validStatus(value)) throw new Error("无效的宠物状态");
    status = value;
    void currentState().then(publicState).then((state) => {
      if (state.enabled) petWindow?.update(state.spriteDataUrl, status, state.size);
    }).catch((error: unknown) => console.warn("[zen] 更新宠物状态失败:", error));
  });
}

/** 启动时只恢复存在有效图片且曾被用户启用的宠物。 */
export async function restorePetWindow(): Promise<void> {
  const state = await currentState();
  if (!state.enabled) return;
  const spriteDataUrl = await readAsset(state.spriteFile, "image/png");
  if (spriteDataUrl) ensureWindow(state, spriteDataUrl);
}
