import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";

import type { AgentSession } from "@zen/agent-core";
import type { AgentStreamEvent, PetActivity, PetCollectionState, PetGenerateInput, PetState } from "@zen/shared";
import { generatePetSprite } from "./pet-image";
import { createPetWindow, isPetWindow, type PetWindow } from "./pet-window";
import { isPetTrayWindow, PetTrayWindow, type PetTrayAction, type PetTraySession } from "./pet-tray-window";

interface StoredPet {
  id: string;
  name: string;
  enabled: boolean;
  size: number;
  sourceFile: string | null;
  spriteFile: string | null;
  spriteLayout: PetState["spriteLayout"];
  position: { x: number; y: number } | null;
  origin?: string;
}
interface StoredCollection { pets: StoredPet[] }

const ASSET_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
let statePromise: Promise<StoredCollection> | null = null;
let pendingWrite: Promise<unknown> = Promise.resolve();
const petWindows = new Map<string, PetWindow>();
const trayWindows = new Map<string, PetTrayWindow>();
interface RunControl { session: AgentSession; runId: string; name: string; status: PetActivity["sessions"][number]["status"]; approval?: PetTraySession["approval"]; questions: NonNullable<PetTraySession["questions"]>; busy: Set<string>; finished: boolean }
const runControls = new Map<string, RunControl>();
let agentSessions: Map<string, AgentSession> | null = null;
const positionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const hidingByService = new Set<string>();
let activity: PetActivity = { status: "idle", sessions: [] };
let generating = false;
let registered = false;
let mainWindowGetter: (() => BrowserWindow | null) | null = null;
let openSession: ((sessionId: string) => void) | null = null;

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
function validActivity(value: unknown): value is PetActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("status") || !keys.includes("sessions")
    || Reflect.ownKeys(value).length !== 2) return false;
  const { status, sessions } = value as Record<string, unknown>;
  return (status === "idle" || status === "working" || status === "waiting" || status === "done" || status === "error")
    && Array.isArray(sessions) && Object.getPrototypeOf(sessions) === Array.prototype
    && sessions.length <= 20 && Reflect.ownKeys(sessions).length === sessions.length + 1
    && sessions.every((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)
        || Object.getPrototypeOf(item) !== Object.prototype) return false;
      const keys = Object.keys(item);
      if (keys.length !== 3 || !keys.includes("id") || !keys.includes("name") || !keys.includes("status")
        || Reflect.ownKeys(item).length !== 3) return false;
      const { id, name, status } = item as Record<string, unknown>;
      return typeof id === "string" && id.trim().length > 0 && id.length <= 200
        && typeof name === "string" && name.trim().length > 0 && name.length <= 80
        && !/[\x00-\x1f\x7f]/.test(name)
        && (status === "running" || status === "needs_action" || status === "done" || status === "error");
    });
}
const statusPriority = { needs_action: 0, error: 1, done: 2, running: 3 } as const;
function traySessions(): PetTraySession[] {
  const sessions = new Map<string, PetTraySession>(activity.sessions.map((item) => [item.id, { ...item }]));
  for (const [id, control] of runControls) {
    if (agentSessions?.get(id) !== control.session) continue;
    const status = !control.finished && (control.approval || control.questions.length) ? "needs_action" : control.status;
    sessions.set(id, {
      id, name: control.name, status,
      ...(!control.finished ? { runId: control.runId, approval: control.approval, questions: control.questions } : {}),
    });
  }
  return [...sessions.values()].sort((a, b) => statusPriority[a.status] - statusPriority[b.status]).slice(0, 20);
}
function currentActivity(): PetActivity {
  const sessions = traySessions();
  const status = sessions[0]?.status;
  return { status: status === "needs_action" ? "waiting" : status === "running" ? "working" : status ?? "idle",
    sessions: sessions.map(({ id, name, status }) => ({ id, name, status })) };
}
function updateTrays(): void {
  const sessions = traySessions();
  for (const tray of trayWindows.values()) tray.update(sessions);
  const snapshot = currentActivity();
  for (const pet of petWindows.values()) pet.updateActivity(snapshot);
}
export function registerPetRun(sessionId: string, session: AgentSession, runId: string, title: string): void {
  const name = title.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, 80).trim() || "会话";
  runControls.set(sessionId, { session, runId, name, status: "running", questions: [], busy: new Set(), finished: false });
  updateTrays();
}
export function recordPetRunEvent(event: AgentStreamEvent, session: AgentSession, runId: string): void {
  const control = runControls.get(event.sessionId);
  if (!control || control.finished || control.session !== session || control.runId !== runId || agentSessions?.get(event.sessionId) !== session) return;
  if (event.type === "approval_request") {
    control.approval = { approvalId: event.request.approvalId, toolName: event.request.toolName,
      prompt: event.request.reason ?? event.request.toolName, input: event.request.input };
  } else if (event.type === "ask_user") {
    const { askId, question, options, multiSelect, allowFreeText, agentName } = event.question;
    control.questions = [...control.questions.filter((item) => item.askId !== askId),
      { askId, question, options: options.map((option) => typeof option === "string" ? option :
        option.priority ? { label: option.label, priority: option.priority } : option.label),
        multiSelect, allowFreeText, agentName }];
  } else if (event.type === "approval_resolved" && control.approval?.approvalId === event.approvalId) {
    control.approval = undefined;
  } else if (event.type === "ask_resolved") {
    control.questions = control.questions.filter((item) => item.askId !== event.askId);
  } else if (event.type === "error") {
    control.status = "error";
  } else if (event.type === "done") {
    control.finished = true;
    control.status = event.reason === "error" || control.status === "error" ? "error" : "done";
    control.approval = undefined;
    control.questions = [];
  } else return;
  updateTrays();
}
function senderTray(event: Electron.IpcMainInvokeEvent): PetTrayWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (isPetTrayWindow(window)) {
    for (const [id, tray] of trayWindows) {
      if (tray.window === window && !window?.isDestroyed() && petWindows.get(id)?.window.isVisible()) return tray;
    }
  }
  throw new Error("未经授权的宠物 IPC 请求");
}
function anchorOf(pet: PetWindow): { x: number; y: number; width: number; height: number } {
  const { x, y } = pet.getPosition();
  const [width, height] = pet.window.getSize();
  return { x, y, width: width ?? 0, height: height ?? 0 };
}
function isTrayAction(value: unknown): value is PetTrayAction {
  const data = record(value);
  if (!data || typeof data.sessionId !== "string" || !data.sessionId || typeof data.runId !== "string" || !data.runId) return false;
  if (data.type === "stop") return Object.keys(data).length === 3;
  if (data.type === "approval") return Object.keys(data).every((key) => ["type", "sessionId", "runId", "approvalId", "approved", "always"].includes(key))
    && typeof data.approvalId === "string" && !!data.approvalId && typeof data.approved === "boolean"
    && (data.always === undefined || typeof data.always === "boolean");
  if (data.type === "answer") return Object.keys(data).length === 5 && typeof data.askId === "string" && !!data.askId
    && typeof data.answer === "string" && !!data.answer.trim() && data.answer.length <= 10_000;
  return false;
}
async function performTrayAction(action: PetTrayAction): Promise<{ ok: boolean; error?: string }> {
  const control = runControls.get(action.sessionId);
  if (!control || control.runId !== action.runId || control.finished || agentSessions?.get(action.sessionId) !== control.session)
    return { ok: false, error: "操作已过期" };
  const id = action.type === "stop" ? "stop" : action.type === "approval" ? `approval:${action.approvalId}` : `ask:${action.askId}`;
  if (control.busy.has(id)) return { ok: false, error: "操作正在处理" };
  if (action.type === "approval" && control.approval?.approvalId !== action.approvalId
    || action.type === "answer" && !control.questions.some((item) => item.askId === action.askId))
    return { ok: false, error: "操作已过期" };
  if (action.type === "answer") {
    const question = control.questions.find((item) => item.askId === action.askId);
    if (!question) return { ok: false, error: "操作已过期" };
    const answer = action.answer.trim();
    const labels = question.options.map((option) => typeof option === "string" ? option : option.label);
    const choices = question.multiSelect ? answer.split("、") : [answer];
    if (!question.allowFreeText && (!choices.length || choices.some((choice) => !labels.includes(choice))))
      return { ok: false, error: "答案不在可选项中" };
  }
  control.busy.add(id);
  try {
    if (action.type === "stop") {
      await control.session.cancel();
      if (agentSessions?.get(action.sessionId) === control.session) agentSessions.delete(action.sessionId);
      control.finished = true;
      control.status = "done";
      control.approval = undefined;
      control.questions = [];
      updateTrays();
    } else if (action.type === "approval") {
      await control.session.approve({ approvalId: action.approvalId, approved: action.approved, always: action.always });
    } else if (!control.session.resolveAsk(action.askId, action.answer.trim())) {
      return { ok: false, error: "操作已过期" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败" };
  } finally {
    control.busy.delete(id);
  }
}
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function parsePet(value: unknown, legacy = false): StoredPet | null {
  const data = record(value);
  if (!data) return null;
  const position = record(data.position);
  const spriteLayout = data.spriteLayout === "dimagent-v2" ? "dimagent-v2" : "zen-4x4";
  const spriteFile = assetPath(data.spriteFile) && typeof data.spriteFile === "string"
    && data.spriteFile.endsWith(spriteLayout === "dimagent-v2" ? ".webp" : ".png") ? data.spriteFile : null;
  const sourceFile = assetPath(data.sourceFile) ? data.sourceFile as string : null;
  return {
    id: !legacy && typeof data.id === "string" && data.id.length > 0 ? data.id
      : legacy && spriteFile ? spriteFile.slice(0, spriteFile.lastIndexOf(".")) : randomUUID(),
    name: !legacy && typeof data.name === "string" && data.name.trim() ? data.name : "桌面宠物",
    enabled: data.enabled === true,
    size: validSize(data.size) ? data.size : 160,
    sourceFile,
    spriteFile,
    spriteLayout,
    position: position && Number.isInteger(position.x) && Number.isInteger(position.y)
      ? { x: position.x as number, y: position.y as number } : null,
    ...(typeof data.origin === "string" ? { origin: data.origin } : {}),
  };
}
async function loadState(): Promise<StoredCollection> {
  try {
    const parsed = record(JSON.parse(await readFile(join(petDir(), "state.json"), "utf8")));
    if (!parsed) return { pets: [] };
    if (Array.isArray(parsed.pets)) {
      const ids = new Set<string>();
      const pets = parsed.pets.flatMap((value: unknown) => {
        const pet = parsePet(value);
        if (!pet || ids.has(pet.id)) return [];
        ids.add(pet.id);
        return [pet];
      });
      return { pets };
    }
    if ("enabled" in parsed || "spriteFile" in parsed) {
      const legacy = parsePet(parsed, true);
      return { pets: legacy ? [legacy] : [] };
    }
    return { pets: [] };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return { pets: [] };
    throw error;
  }
}
function currentState(): Promise<StoredCollection> { return statePromise ??= loadState(); }
async function persist(next: StoredCollection): Promise<void> {
  const directory = petDir();
  await mkdir(directory, { recursive: true });
  const tmp = join(directory, `${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(next), { flag: "wx" });
  await rename(tmp, join(directory, "state.json"));
}
function changeState(change: (previous: StoredCollection) => StoredCollection): Promise<StoredCollection> {
  const operation = pendingWrite.then(async () => {
    const previous = await currentState();
    const next = change(previous);
    if (next !== previous) {
      await persist(next);
      statePromise = Promise.resolve(next);
    }
    return next;
  });
  pendingWrite = operation.catch(() => undefined);
  return operation;
}
async function readAsset(name: string | null, mime: string): Promise<string | null> {
  const file = assetPath(name);
  if (!file) return null;
  try {
    if (!(await lstat(file)).isFile()) return null;
    return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function publicState(state: StoredCollection): Promise<PetCollectionState> {
  return { pets: await Promise.all(state.pets.map(async (pet): Promise<PetState> => {
    const [spriteDataUrl, sourceDataUrl] = await Promise.all([
      readAsset(pet.spriteFile, pet.spriteLayout === "dimagent-v2" ? "image/webp" : "image/png"),
      readAsset(pet.sourceFile, pet.sourceFile?.endsWith(".jpg") ? "image/jpeg" : pet.sourceFile?.endsWith(".webp") ? "image/webp" : "image/png"),
    ]);
    return { id: pet.id, name: pet.name, enabled: pet.enabled && spriteDataUrl !== null, size: pet.size, spriteDataUrl, sourceDataUrl, spriteLayout: pet.spriteLayout };
  })) };
}
function broadcast(state: PetCollectionState): void {
  const main = mainWindowGetter?.();
  if (main && !main.isDestroyed() && !main.webContents.isDestroyed()) main.webContents.send("pet:changed", state);
}
async function syncWindows(state: StoredCollection, view: PetCollectionState): Promise<void> {
  for (const [index, pet] of state.pets.entries()) {
    const publicPet = view.pets[index];
    let window = petWindows.get(pet.id);
    if (!publicPet?.enabled || !publicPet.spriteDataUrl) {
      trayWindows.get(pet.id)?.hide();
      if (window && !window.window.isDestroyed()) {
        hidingByService.add(pet.id);
        try { window.hide(); } finally { hidingByService.delete(pet.id); }
      }
      continue;
    }
    if (!window || window.window.isDestroyed()) {
      window = createPetWindow({ onHide: () => {
        if (hidingByService.has(pet.id)) return;
        void updatePet(pet.id, (previous) => ({ ...previous, enabled: false }))
          .catch((error: unknown) => console.warn("[zen] 保存宠物可见状态失败:", error));
      } });
      petWindows.set(pet.id, window);
      const tray = new PetTrayWindow();
      trayWindows.set(pet.id, tray);
      tray.update(traySessions());
      tray.window.on("closed", () => { if (trayWindows.get(pet.id) === tray) trayWindows.delete(pet.id); });
      const owned = window;
      const repositionTray = () => {
        if (tray.window.isVisible() && !owned.window.isDestroyed()) tray.show(anchorOf(owned));
      };
      owned.window.on("resized", repositionTray);
      owned.window.on("moved", () => {
        repositionTray();
        const timer = positionTimers.get(pet.id);
        if (timer) clearTimeout(timer);
        positionTimers.set(pet.id, setTimeout(() => {
          positionTimers.delete(pet.id);
          if (owned.window.isDestroyed()) return;
          const position = owned.getPosition();
          void changeState((previous) => ({ pets: previous.pets.map((item) => item.id === pet.id ? { ...item, position } : item) }))
            .catch((error: unknown) => console.warn("[zen] 保存宠物位置失败:", error));
        }, 300));
      });
      owned.window.on("closed", () => {
        if (petWindows.get(pet.id) !== owned) return;
        petWindows.delete(pet.id);
        if (!tray.window.isDestroyed()) tray.window.close();
        trayWindows.delete(pet.id);
        const timer = positionTimers.get(pet.id);
        if (timer) clearTimeout(timer);
        positionTimers.delete(pet.id);
      });
      if (pet.position) owned.restorePosition(pet.position.x, pet.position.y);
      else if (index > 0) {
        const initial = owned.getPosition();
        owned.restorePosition(initial.x - index * 48, initial.y - index * 48);
      }
    }
    window.update(publicPet.spriteDataUrl, currentActivity(), pet.size, pet.spriteLayout);
    window.show();
  }
}
async function publish(state: StoredCollection): Promise<PetCollectionState> {
  const view = await publicState(state);
  await syncWindows(state, view);
  broadcast(view);
  return view;
}
async function updatePet(id: string, change: (pet: StoredPet) => StoredPet): Promise<PetCollectionState> {
  const next = await changeState((previous) => {
    if (!previous.pets.some((pet) => pet.id === id)) throw new Error("宠物不存在");
    return { pets: previous.pets.map((pet) => pet.id === id ? change(pet) : pet) };
  });
  return publish(next);
}
function checkSender(event: Electron.IpcMainInvokeEvent): void {
  const main = mainWindowGetter?.();
  if (main && !main.isDestroyed() && event.sender === main.webContents) return;
  throw new Error("未经授权的宠物 IPC 请求");
}
function senderPetId(event: Electron.IpcMainInvokeEvent): string {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (isPetWindow(window)) {
    for (const [id, pet] of petWindows) if (pet.window === window && !window?.isDestroyed()) return id;
  }
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
function validDimagentSprite(sprite: Buffer): boolean {
  if (sprite.length < 26 || sprite.length > MAX_IMPORT_BYTES
    || sprite.toString("ascii", 0, 4) !== "RIFF" || sprite.toString("ascii", 8, 16) !== "WEBPVP8L"
    || sprite.readUInt32LE(4) + 8 !== sprite.length || sprite.readUInt32LE(16) < 5
    || sprite.readUInt32LE(16) + 20 > sprite.length || sprite[20] !== 0x2f) return false;
  // WebP lossless (VP8L) stores width/height minus one in four packed bytes.
  const bits = sprite.readUInt32LE(21);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  return width === 1536 && height === 2288;
}
interface ImportCandidate { origin: string; name: string; sprite: Buffer }
async function importCandidate(directory: string): Promise<ImportCandidate | null> {
  if (!(await lstat(directory)).isDirectory()) return null;
  const metadataFile = join(directory, "pet.json");
  const metadataInfo = await lstat(metadataFile);
  if (!metadataInfo.isFile() || metadataInfo.size > 1024 * 1024) return null;
  const metadata = record(JSON.parse(await readFile(metadataFile, "utf8")));
  if (!metadata || typeof metadata.id !== "string" || !metadata.id.trim() || typeof metadata.displayName !== "string"
    || !metadata.displayName.trim() || metadata.spriteVersionNumber !== 2 || metadata.spritesheetPath !== "spritesheet.webp") return null;
  const spriteFile = resolve(directory, metadata.spritesheetPath);
  if (dirname(spriteFile) !== resolve(directory)) return null;
  const info = await lstat(spriteFile);
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES || info.size < 12) return null;
  const sprite = await readFile(spriteFile);
  if (!validDimagentSprite(sprite)) return null;
  return { origin: `${resolve(directory)}::${metadata.id}`, name: metadata.displayName, sprite };
}
async function findCandidates(directory: string): Promise<ImportCandidate[]> {
  if (!(await lstat(directory)).isDirectory()) throw new Error("请选择有效的宠物目录");
  const candidates: ImportCandidate[] = [];
  const entries = [directory, ...(await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => join(directory, entry.name))];
  for (const entry of entries) {
    try {
      const candidate = await importCandidate(entry);
      if (candidate) candidates.push(candidate);
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) console.warn("[zen] 跳过无法读取的宠物目录");
    }
  }
  if (!candidates.length) throw new Error("所选目录没有有效的 DimAgent 宠物");
  return candidates;
}

/** IPC 仅注册一次；activate 重建主窗时更新 getter 即可。 */
export function registerPetIpc(getMainWindow: () => BrowserWindow | null, sessions?: Map<string, AgentSession>, onOpenSession?: (id: string) => void): void {
  mainWindowGetter = getMainWindow;
  if (sessions) agentSessions = sessions;
  if (onOpenSession) openSession = onOpenSession;
  if (registered) return;
  registered = true;
  function showTray(event: Electron.IpcMainInvokeEvent): void {
    const id = senderPetId(event);
    const pet = petWindows.get(id);
    const tray = trayWindows.get(id);
    if (!pet || !tray || !pet.window.isVisible()) throw new Error("宠物窗口不可用");
    tray.update(traySessions());
    tray.show(anchorOf(pet));
  }
  ipcMain.handle("pet:tray-show", async (event) => { showTray(event); });
  ipcMain.handle("pet:tray-toggle", async (event) => {
    const id = senderPetId(event);
    const tray = trayWindows.get(id);
    if (tray?.window.isVisible()) tray.hide();
    else showTray(event);
  });
  ipcMain.handle("pet:tray-close", async (event) => { senderTray(event).hide(); });
  ipcMain.handle("pet:tray-open-session", async (event, id: unknown) => {
    senderTray(event);
    if (typeof id !== "string" || !traySessions().some((item) => item.id === id)) throw new Error("会话不存在");
    openSession?.(id);
  });
  ipcMain.handle("pet:tray-get", async (event) => { senderTray(event); return traySessions(); });
  ipcMain.handle("pet:tray-action", async (event, value: unknown) => {
    senderTray(event);
    if (!isTrayAction(value)) throw new Error("无效的宠物操作");
    return performTrayAction(value);
  });
  ipcMain.handle("pet:get", async (event) => {
    checkSender(event);
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
      const next = await changeState((previous) => ({ pets: [...previous.pets, {
        id: randomUUID(), name: `宠物 ${previous.pets.length + 1}`, enabled: true, size: 160,
        sourceFile: sourceName, spriteFile: spriteName, spriteLayout: "zen-4x4", position: null,
      }] }));
      return publish(next);
    } finally { generating = false; }
  });
  ipcMain.handle("pet:import-directory", async (event) => {
    checkSender(event);
    const main = mainWindowGetter?.();
    if (!main || main.isDestroyed()) throw new Error("主窗口不可用");
    const selected = await dialog.showOpenDialog(main, { properties: ["openDirectory"] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const candidates = await findCandidates(selected.filePaths[0]);
    const next = await changeState((previous) => previous);
    const existing = new Set(next.pets.map((pet) => pet.origin));
    const additions: StoredPet[] = [];
    for (const candidate of candidates) {
      if (existing.has(candidate.origin)) continue;
      const name = `${randomUUID()}.webp`;
      await mkdir(join(petDir(), "assets"), { recursive: true });
      await writeFile(join(petDir(), "assets", name), candidate.sprite, { flag: "wx" });
      additions.push({ id: randomUUID(), name: candidate.name, enabled: true, size: 160,
        sourceFile: null, spriteFile: name, spriteLayout: "dimagent-v2", position: null, origin: candidate.origin });
      existing.add(candidate.origin);
    }
    const updated = additions.length ? await changeState((previous) => ({ pets: [
      ...previous.pets, ...additions.filter((pet) => !previous.pets.some((item) => item.origin === pet.origin)),
    ] })) : next;
    return publish(updated);
  });
  ipcMain.handle("pet:set-visible", async (event, id: unknown, visible: unknown) => {
    checkSender(event);
    if (typeof id !== "string" || typeof visible !== "boolean") throw new Error("无效的可见状态");
    const current = (await publicState(await currentState())).pets.find((pet) => pet.id === id);
    if (!current) throw new Error("宠物不存在");
    if (visible && !current.spriteDataUrl) throw new Error("宠物图片不存在");
    return updatePet(id, (pet) => ({ ...pet, enabled: visible }));
  });
  ipcMain.handle("pet:hide", async (event) => updatePet(senderPetId(event), (pet) => ({ ...pet, enabled: false })));
  ipcMain.handle("pet:set-size", async (event, id: unknown, size: unknown) => {
    checkSender(event);
    if (typeof id !== "string" || !validSize(size)) throw new Error("宠物大小必须是 100–300 的整数");
    return updatePet(id, (pet) => ({ ...pet, size }));
  });
  ipcMain.handle("pet:set-status", async (event, value: unknown): Promise<void> => {
    checkSender(event);
    if (!validActivity(value)) throw new Error("无效的宠物活动");
    activity = { status: value.status, sessions: value.sessions.map((session) => ({ id: session.id, name: session.name, status: session.status })) };
    updateTrays();
    const state = await currentState();
    const view = await publicState(state);
    for (const pet of view.pets) if (pet.enabled && pet.spriteDataUrl) petWindows.get(pet.id)?.update(pet.spriteDataUrl, currentActivity(), pet.size, pet.spriteLayout);
  });
}

/** 启动时只恢复存在有效图片且曾被用户启用的宠物。 */
export async function restorePetWindow(): Promise<void> {
  const state = await currentState();
  await syncWindows(state, await publicState(state));
}
