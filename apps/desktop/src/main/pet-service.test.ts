import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  generate: vi.fn(), create: vi.fn(), isPet: vi.fn(), fromWebContents: vi.fn(), image: vi.fn(), dialog: vi.fn(),
  trays: [] as Array<{ window: object; sender: object; update: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }>, isTray: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => globalThis.__petTestDir },
  ipcMain: { handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler)) },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  nativeImage: { createFromBuffer: mocks.image },
  dialog: { showOpenDialog: mocks.dialog },
}));
vi.mock("./pet-image", () => ({ generatePetSprite: mocks.generate }));
vi.mock("./pet-window", () => ({ createPetWindow: mocks.create, isPetWindow: mocks.isPet }));
vi.mock("./pet-tray-window", () => ({
  PetTrayWindow: class {
    window = { isDestroyed: () => false, isVisible: () => true, close: vi.fn(), on: vi.fn() };
    sender = {};
    update = vi.fn(); hide = vi.fn(); show = vi.fn();
    constructor() { mocks.trays.push(this); }
  },
  isPetTrayWindow: mocks.isTray,
}));

import { ipcMain } from "electron";
let service: typeof import("./pet-service");
declare global { var __petTestDir: string; }
const png = Buffer.from("89504e470d0a1a0a", "hex");
const webp = Buffer.from("5249464612000000574542505650384c050000002fffc53b1200", "hex");
const source = Buffer.from("ffd8ff00", "hex");
const input = { providerId: "p", modelId: "m", sourceDataUrl: `data:image/jpeg;base64,${source.toString("base64")}`, style: "pixel" };
const main = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
const mainEvent = { sender: main.webContents };
const strangerEvent = { sender: {} };
const windows: Array<ReturnType<typeof makeWindow>> = [];
function existing<T>(item: T | undefined): T {
  if (item === undefined) throw new Error("expected existing item");
  return item;
}
function makeWindow() {
  const listeners = new Map<string, () => void>();
  const window = { isDestroyed: () => false, isVisible: () => true, getSize: () => [160, 160], on: vi.fn((name: string, handler: () => void) => listeners.set(name, handler)) };
  return { window, listeners, sender: {}, update: vi.fn(), updateActivity: vi.fn(), show: vi.fn(), hide: vi.fn(), restorePosition: vi.fn(), getPosition: () => ({ x: 300, y: 400 }) };
}
function call(name: string, event: object, ...args: unknown[]): Promise<any> {
  const handler = mocks.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return Promise.resolve().then(() => handler(event, ...args));
}
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zen-pet-service-"));
  globalThis.__petTestDir = dir;
  windows.length = 0;
  mocks.trays.length = 0;
  mocks.generate.mockResolvedValue({ source, sprite: png });
  mocks.image.mockImplementation((bytes: Buffer) => ({ isEmpty: () => false,
    getSize: () => bytes.subarray(0, 4).toString("ascii") === "RIFF" ? { width: 1536, height: 2288 } : { width: 1024, height: 1024 },
    toBitmap: () => Buffer.alloc(1024 * 1024 * 4) }));
  mocks.create.mockImplementation(() => { const pet = makeWindow(); windows.push(pet); return pet; });
  mocks.fromWebContents.mockImplementation((sender: unknown) => windows.find((pet) => pet.sender === sender)?.window ?? mocks.trays.find((tray) => tray.sender === sender)?.window ?? null);
  mocks.isPet.mockImplementation((window: unknown) => windows.some((pet) => pet.window === window));
  mocks.isTray.mockImplementation((window: unknown) => mocks.trays.some((tray) => tray.window === window));
  mocks.dialog.mockResolvedValue({ canceled: true, filePaths: [] });
  vi.resetModules();
  mocks.handlers.clear();
  vi.mocked(ipcMain.handle).mockClear();
  service = await import("./pet-service");
  service.registerPetIpc(() => main as never);
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(dir, { recursive: true, force: true });
});
async function stored() { return JSON.parse(await readFile(join(dir, "pets/state.json"), "utf8")); }
async function makeImport(root: string, id: string) {
  const folder = join(root, id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "pet.json"), JSON.stringify({ id, displayName: id, spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" }));
  await writeFile(join(folder, "spritesheet.webp"), webp);
  return folder;
}

describe("pet IPC and persistence", () => {
  it("restricts all main actions and lets only a registered guest hide itself", async () => {
    service.registerPetIpc(() => main as never);
    expect(ipcMain.handle).toHaveBeenCalledTimes(13);
    for (const channel of ["pet:get", "pet:generate", "pet:import-directory", "pet:set-visible", "pet:set-size", "pet:set-status", "pet:hide"]) {
      await expect(call(channel, strangerEvent)).rejects.toThrow(/未经授权/);
    }
    const collection = await call("pet:generate", mainEvent, input);
    const id = collection.pets[0].id;
    const guest = { sender: existing(windows[0]).sender };
    await expect(call("pet:get", guest)).rejects.toThrow(/未经授权/);
    await expect(call("pet:set-visible", guest, id, false)).rejects.toThrow(/未经授权/);
    const hidden = await call("pet:hide", guest);
    expect(hidden.pets[0].enabled).toBe(false);
    await expect(call("pet:hide", mainEvent)).rejects.toThrow(/未经授权/);
  });

  it("generates two independent pets, preserves both assets, status and visibility", async () => {
    const first = await call("pet:generate", mainEvent, input);
    const second = await call("pet:generate", mainEvent, input);
    expect(second.pets).toHaveLength(2);
    expect(second.pets[0].id).toBe(first.pets[0].id);
    expect(windows).toHaveLength(2);
    expect(existing(windows[1]).restorePosition).toHaveBeenCalledWith(252, 352);
    expect((await readdir(join(dir, "pets/assets")))).toHaveLength(4);
    const activity = { status: "working", sessions: [
      { id: "a", name: "会话 A", status: "running" }, { id: "b", name: "会话 B", status: "error" },
    ] };
    await call("pet:set-status", mainEvent, activity);
    const prioritized = { status: "error", sessions: [activity.sessions[1], activity.sessions[0]] };
    expect(existing(windows[0]).update).toHaveBeenCalledWith(expect.any(String), prioritized, 160, "zen-4x4");
    expect(existing(windows[1]).update).toHaveBeenCalledWith(expect.any(String), prioritized, 160, "zen-4x4");
    const hidden = await call("pet:set-visible", mainEvent, first.pets[0].id, false);
    expect(hidden.pets.map((pet: { enabled: boolean }) => pet.enabled)).toEqual([false, true]);
    expect(existing(windows[0]).hide).toHaveBeenCalled();
    expect(existing(windows[1]).hide).not.toHaveBeenCalled();
    await call("pet:set-size", mainEvent, second.pets[1].id, 240);
    expect((await stored()).pets.map((pet: { size: number }) => pet.size)).toEqual([160, 240]);
    expect((await stored()).pets[0].spriteFile).toMatch(/\.png$/);
    expect(main.webContents.send).toHaveBeenCalledWith("pet:changed", hidden);
  });

  it("migrates old single-pet state without touching original sprite and degrades missing images", async () => {
    const pets = join(dir, "pets");
    const name = "12345678-1234-1234-1234-123456789abc.png";
    await mkdir(join(pets, "assets"), { recursive: true });
    await writeFile(join(pets, "assets", name), png);
    const legacyState = JSON.stringify({ enabled: true, size: 200, spriteFile: name, position: { x: 23, y: 42 } });
    await writeFile(join(pets, "state.json"), legacyState);
    expect(await call("pet:get", mainEvent)).toMatchObject({ pets: [{ id: name.slice(0, -4), enabled: true, size: 200, spriteLayout: "zen-4x4" }] });
    expect(await readFile(join(pets, "state.json"), "utf8")).toBe(legacyState);
    await service.restorePetWindow();
    expect(existing(windows[0]).restorePosition).toHaveBeenCalledWith(23, 42);
    await call("pet:generate", mainEvent, input);
    expect((await stored()).pets).toHaveLength(2);
    expect(await readFile(join(pets, "assets", name))).toEqual(png);
  });

  it("does not hide enabled pets when windows close during app shutdown", async () => {
    const state = await call("pet:generate", mainEvent, input);
    existing(windows[0]).listeners.get("closed")?.();
    expect((await stored()).pets[0].enabled).toBe(true);
    expect((await call("pet:get", mainEvent)).pets[0].id).toBe(state.pets[0].id);
  });

  it("keeps missing or traversal sprites disabled without creating a window", async () => {
    await mkdir(join(dir, "pets"));
    await writeFile(join(dir, "pets/state.json"), JSON.stringify({ enabled: true, size: 160, spriteFile: "../secret.png" }));
    expect(await call("pet:get", mainEvent)).toMatchObject({ pets: [{ enabled: false, spriteDataUrl: null }] });
    await service.restorePetWindow();
    expect(windows).toHaveLength(0);
  });

  it("imports valid siblings, skips bad ones and deduplicates repeated selection", async () => {
    const root = join(dir, "external");
    await mkdir(root);
    await makeImport(root, "alpha");
    await makeImport(root, "beta");
    await mkdir(join(root, "bad"));
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [root] });
    const imported = await call("pet:import-directory", mainEvent, "/ignored/arbitrary/path");
    expect(imported.pets.map((pet: { name: string }) => pet.name)).toEqual(["alpha", "beta"]);
    expect(imported.pets[0]).not.toHaveProperty("origin");
    expect(JSON.stringify(imported)).not.toContain(root);
    expect(windows).toHaveLength(2);
    const assets = await readdir(join(dir, "pets/assets"));
    expect(assets).toHaveLength(2);
    expect((await stored()).pets[0].origin).toContain(root);
    expect((await call("pet:import-directory", mainEvent)).pets).toHaveLength(2);
    expect(await readdir(join(dir, "pets/assets"))).toEqual(assets);
    expect(await readFile(join(dir, "pets/assets", existing(assets[0])))).toEqual(webp);
  });

  it("rejects symlink paths and invalid metadata or image without changing pets", async () => {
    const root = join(dir, "external");
    await mkdir(root);
    const real = await makeImport(root, "real");
    await symlink(real, join(root, "linked"));
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [join(root, "linked")] });
    await expect(call("pet:import-directory", mainEvent)).rejects.toThrow(/目录/);
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [root] });
    await writeFile(join(real, "pet.json"), JSON.stringify({ id: "real", displayName: "real", spriteVersionNumber: 2, spritesheetPath: "../outside.webp" }));
    await expect(call("pet:import-directory", mainEvent)).rejects.toThrow(/没有有效/);
    await writeFile(join(real, "pet.json"), JSON.stringify({ id: "real", displayName: "real", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" }));
    await rm(join(real, "spritesheet.webp"));
    await symlink(join(dir, "outside.webp"), join(real, "spritesheet.webp"));
    await expect(call("pet:import-directory", mainEvent)).rejects.toThrow(/没有有效/);
    expect((await call("pet:get", mainEvent)).pets).toHaveLength(0);
    mocks.dialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await call("pet:import-directory", mainEvent)).toBeNull();
  });

  it("validates image signature, dimensions, status and per-pet size", async () => {
    const root = join(dir, "external");
    const folder = await makeImport(root, "alpha");
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [folder] });
    await writeFile(join(folder, "spritesheet.webp"), png);
    await expect(call("pet:import-directory", mainEvent)).rejects.toThrow(/没有有效/);
    await writeFile(join(folder, "spritesheet.webp"), webp);
    const wrongSize = Buffer.from(webp);
    wrongSize.writeUInt32LE(0, 21);
    await writeFile(join(folder, "spritesheet.webp"), wrongSize);
    await expect(call("pet:import-directory", mainEvent)).rejects.toThrow(/没有有效/);
    await writeFile(join(folder, "spritesheet.webp"), webp);
    const result = await call("pet:import-directory", mainEvent);
    for (const size of [99, 301, 100.5, NaN, "150"]) {
      await expect(call("pet:set-size", mainEvent, result.pets[0].id, size)).rejects.toThrow();
    }
    await expect(call("pet:set-size", mainEvent, "missing", 160)).rejects.toThrow(/不存在/);
    for (const value of ["sleep", null, 1]) await expect(call("pet:set-status", mainEvent, value)).rejects.toThrow();
    expect((await stored()).pets).toHaveLength(1);
    expect((await stored())).not.toHaveProperty("status");
  });

  it("rejects malformed activity without replacing the last valid session results", async () => {
    await call("pet:generate", mainEvent, input);
    const valid = { status: "working", sessions: [
      { id: "one", name: "会话一", status: "running" }, { id: "two", name: "会话二", status: "done" },
      { id: "three", name: "会话三", status: "error" },
    ] };
    await call("pet:set-status", mainEvent, valid);
    for (const value of [
      "working", null, { status: "working" }, { status: "sleep", sessions: [] },
      { status: "working", runningSessions: ["会话"] },
      { status: "working", sessions: "会话" },
      { status: "working", sessions: [""] },
      { status: "working", sessions: [{ name: "", status: "done" }] },
      { status: "working", sessions: [{ name: "A".repeat(81), status: "error" }] },
      { status: "working", sessions: Array(21).fill({ name: "会话", status: "running" }) },
      { status: "working", sessions: [{ name: "带\n换行", status: "running" }] },
      { status: "working", sessions: [{ name: "会话", status: "idle" }] },
      { status: "working", sessions: [{ name: "会话" }] },
      { status: "working", sessions: [{ name: "会话", status: "done", extra: true }] },
      { ...valid, unexpected: "extra" },
    ]) await expect(call("pet:set-status", mainEvent, value)).rejects.toThrow(/无效的宠物活动/);
    await call("pet:set-size", mainEvent, (await call("pet:get", mainEvent)).pets[0].id, 180);
    expect(existing(windows[0]).update).toHaveBeenLastCalledWith(expect.any(String), { status: "error", sessions: [valid.sessions[2], valid.sessions[1], valid.sessions[0]] }, 180, "zen-4x4");
  });

  it("only lets its tray control a current run and rejects stale or forged actions", async () => {
    await call("pet:generate", mainEvent, input);
    const sessions = new Map();
    const session = { cancel: vi.fn().mockResolvedValue(undefined), approve: vi.fn().mockResolvedValue(undefined), resolveAsk: vi.fn().mockReturnValue(true) };
    sessions.set("one", session);
    service.registerPetIpc(() => main as never, sessions);
    await call("pet:set-status", mainEvent, { status: "waiting", sessions: [{ id: "one", name: "One", status: "needs_action" }] });
    service.registerPetRun("one", session as never, "run-1", "One");
    const trayEvent = { sender: existing(mocks.trays[0]).sender };
    await expect(call("pet:tray-get", mainEvent)).rejects.toThrow(/未经授权/);
    await expect(call("pet:tray-action", strangerEvent, { type: "stop", sessionId: "one", runId: "run-1" })).rejects.toThrow(/未经授权/);
    expect(await call("pet:tray-action", trayEvent, { type: "stop", sessionId: "one", runId: "stale" })).toMatchObject({ ok: false });
    service.recordPetRunEvent({ type: "ask_user", sessionId: "one", question: { askId: "ask-1", question: "Choose", options: ["Yes", "No"], allowFreeText: false } } as never, session as never, "run-1");
    expect((await call("pet:tray-get", trayEvent))[0].questions).toHaveLength(1);
    expect(await call("pet:tray-action", trayEvent, { type: "answer", sessionId: "one", runId: "run-1", askId: "ask-1", answer: "wrong" })).toMatchObject({ ok: false });
    expect(await call("pet:tray-action", trayEvent, { type: "answer", sessionId: "one", runId: "run-1", askId: "ask-1", answer: "Yes" })).toMatchObject({ ok: true });
    expect(session.resolveAsk).toHaveBeenCalledWith("ask-1", "Yes");
    expect(await call("pet:tray-action", trayEvent, { type: "stop", sessionId: "one", runId: "run-1" })).toMatchObject({ ok: true });
    expect(session.cancel).toHaveBeenCalledOnce();
    expect(await call("pet:tray-action", trayEvent, { type: "stop", sessionId: "one", runId: "run-1" })).toMatchObject({ ok: false });
  });

  it("shows background runs without renderer status and ignores stale snapshots and old run events", async () => {
    await call("pet:generate", mainEvent, input);
    const sessions = new Map();
    const first = { cancel: vi.fn(), approve: vi.fn(), resolveAsk: vi.fn() };
    sessions.set("one", first);
    const open = vi.fn();
    service.registerPetIpc(() => main as never, sessions, open);
    service.registerPetRun("one", first as never, "run-1", "后台任务\n标题");
    const trayEvent = { sender: existing(mocks.trays[0]).sender };
    expect(await call("pet:tray-get", trayEvent)).toMatchObject([{ id: "one", name: "后台任务 标题", status: "running", runId: "run-1" }]);
    expect(existing(windows[0]).updateActivity).toHaveBeenLastCalledWith({ status: "working", sessions: [{ id: "one", name: "后台任务 标题", status: "running" }] });
    await call("pet:tray-open-session", trayEvent, "one");
    expect(open).toHaveBeenCalledWith("one");
    await call("pet:set-status", mainEvent, { status: "idle", sessions: [] });
    expect((await call("pet:tray-get", trayEvent))[0].status).toBe("running");
    const second = { cancel: vi.fn(), approve: vi.fn(), resolveAsk: vi.fn() };
    sessions.set("one", second);
    service.registerPetRun("one", second as never, "run-2", "New run");
    service.recordPetRunEvent({ type: "done", sessionId: "one", reason: "completed" } as never, first as never, "run-1");
    expect(await call("pet:tray-get", trayEvent)).toMatchObject([{ status: "running", runId: "run-2", name: "New run" }]);
    service.recordPetRunEvent({ type: "done", sessionId: "one", reason: "completed" } as never, second as never, "run-2");
    expect(await call("pet:tray-get", trayEvent)).toMatchObject([{ status: "done", name: "New run" }]);
    expect((await call("pet:tray-get", trayEvent))[0]).not.toHaveProperty("runId");
  });

  it("does not let a completed cancel overwrite a replacement run", async () => {
    await call("pet:generate", mainEvent, input);
    let finish!: () => void;
    const first = { cancel: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })), approve: vi.fn(), resolveAsk: vi.fn() };
    const second = { cancel: vi.fn(), approve: vi.fn(), resolveAsk: vi.fn() };
    const sessions = new Map<string, typeof first | typeof second>([["one", first]]);
    service.registerPetIpc(() => main as never, sessions as never);
    service.registerPetRun("one", first as never, "run-1", "First");
    const trayEvent = { sender: existing(mocks.trays[0]).sender };
    const pending = call("pet:tray-action", trayEvent, { type: "stop", sessionId: "one", runId: "run-1" });
    await vi.waitFor(() => expect(first.cancel).toHaveBeenCalledOnce());
    sessions.set("one", second);
    service.registerPetRun("one", second as never, "run-2", "Second");
    finish();
    await pending;
    expect(sessions.get("one")).toBe(second);
    expect(await call("pet:tray-get", trayEvent)).toMatchObject([{ status: "running", runId: "run-2" }]);
  });

  it("rejects duplicate generation and preserves state on failure", async () => {
    let finish!: (value: { source: Buffer; sprite: Buffer }) => void;
    mocks.generate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = call("pet:generate", mainEvent, input);
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalled());
    await expect(call("pet:generate", mainEvent, input)).rejects.toThrow(/正在生成/);
    finish({ source, sprite: png });
    await first;
    const previous = await readFile(join(dir, "pets/state.json"), "utf8");
    mocks.generate.mockRejectedValueOnce(new Error("payment failed"));
    await expect(call("pet:generate", mainEvent, input)).rejects.toThrow("payment failed");
    expect(await readFile(join(dir, "pets/state.json"), "utf8")).toBe(previous);
  });
});
