import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  generate: vi.fn(), create: vi.fn(), isPet: vi.fn(), fromWebContents: vi.fn(), image: vi.fn(), dialog: vi.fn(),
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
  const window = { isDestroyed: () => false, on: vi.fn((name: string, handler: () => void) => listeners.set(name, handler)) };
  return { window, listeners, sender: {}, update: vi.fn(), show: vi.fn(), hide: vi.fn(), restorePosition: vi.fn(), getPosition: () => ({ x: 300, y: 400 }) };
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
  mocks.generate.mockResolvedValue({ source, sprite: png });
  mocks.image.mockImplementation((bytes: Buffer) => ({ isEmpty: () => false,
    getSize: () => bytes.subarray(0, 4).toString("ascii") === "RIFF" ? { width: 1536, height: 2288 } : { width: 1024, height: 1024 },
    toBitmap: () => Buffer.alloc(1024 * 1024 * 4) }));
  mocks.create.mockImplementation(() => { const pet = makeWindow(); windows.push(pet); return pet; });
  mocks.fromWebContents.mockImplementation((sender: unknown) => windows.find((pet) => pet.sender === sender)?.window ?? null);
  mocks.isPet.mockImplementation((window: unknown) => windows.some((pet) => pet.window === window));
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
    expect(ipcMain.handle).toHaveBeenCalledTimes(7);
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
    await call("pet:set-status", mainEvent, "working");
    expect(existing(windows[0]).update).toHaveBeenCalledWith(expect.any(String), "working", 160, "zen-4x4");
    expect(existing(windows[1]).update).toHaveBeenCalledWith(expect.any(String), "working", 160, "zen-4x4");
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
