import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  generate: vi.fn(), create: vi.fn(), isPet: vi.fn(), fromWebContents: vi.fn(), image: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => globalThis.__petTestDir },
  ipcMain: { handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler)) },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  nativeImage: { createFromBuffer: mocks.image },
}));
vi.mock("./pet-image", () => ({ generatePetSprite: mocks.generate }));
vi.mock("./pet-window", () => ({ createPetWindow: mocks.create, isPetWindow: mocks.isPet }));

import { ipcMain } from "electron";
let service: typeof import("./pet-service");

declare global { var __petTestDir: string; }
const png = Buffer.from("89504e470d0a1a0a", "hex");
const source = Buffer.from("ffd8ff00", "hex");
const input = { providerId: "p", modelId: "m", sourceDataUrl: `data:image/jpeg;base64,${source.toString("base64")}`, style: "pixel" };
const main = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
const pet = { window: { isDestroyed: () => false, on: vi.fn() }, update: vi.fn(), show: vi.fn(), hide: vi.fn(), restorePosition: vi.fn(), getPosition: () => ({ x: 3, y: 4 }) };
const mainEvent = { sender: main.webContents };
const petEvent = { sender: {} };
const strangerEvent = { sender: {} };
function call(name: string, event: object, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(name);
  if (!handler) throw new Error(`missing handler ${name}`);
  return Promise.resolve().then(() => handler(event, ...args));
}
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zen-pet-service-"));
  globalThis.__petTestDir = dir;
  mocks.generate.mockResolvedValue({ source, sprite: png });
  mocks.image.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 1024, height: 1024 }), toBitmap: () => Buffer.alloc(1024 * 1024 * 4) });
  mocks.create.mockReturnValue(pet);
  mocks.fromWebContents.mockImplementation((sender: unknown) => sender === petEvent.sender ? pet.window : null);
  mocks.isPet.mockImplementation((window: unknown) => window === pet.window);
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

describe("pet IPC and persistence", () => {
  it("registers once and rejects unknown senders; pet may read and hide only", async () => {
    service.registerPetIpc(() => main as never);
    expect(ipcMain.handle).toHaveBeenCalledTimes(5);
    expect(await call("pet:get", petEvent)).toMatchObject({ enabled: false, size: 160 });
    await expect(call("pet:get", strangerEvent)).rejects.toThrow(/未经授权/);
    await expect(call("pet:set-size", petEvent, 150)).rejects.toThrow(/未经授权/);
    await expect(call("pet:generate", petEvent, input)).rejects.toThrow(/未经授权/);
    await expect(call("pet:set-status", petEvent, "idle")).rejects.toThrow(/未经授权/);
    await expect(call("pet:set-visible", petEvent, true)).rejects.toThrow(/未经授权/);
    expect(await call("pet:set-visible", petEvent, false)).toMatchObject({ enabled: false });
  });

  it("stores fresh assets without overwriting old ones and broadcasts only after success", async () => {
    const result = await call("pet:generate", mainEvent, input);
    expect(result).toMatchObject({ enabled: true, sourceDataUrl: `data:image/jpeg;base64,${source.toString("base64")}` });
    const state = JSON.parse(await readFile(join(dir, "pets/state.json"), "utf8"));
    expect(state).toMatchObject({ enabled: true, size: 160 });
    expect(state.sourceFile).toMatch(/\.jpg$/);
    expect(state.spriteFile).toMatch(/\.png$/);
    const assets = join(dir, "pets/assets");
    expect(await readFile(join(assets, state.sourceFile))).toEqual(source);
    expect(await readFile(join(assets, state.spriteFile))).toEqual(png);
    expect(main.webContents.send).toHaveBeenCalledWith("pet:changed", result);
    await call("pet:generate", mainEvent, input);
    expect((await readdir(assets)).length).toBe(4);
    expect(await readFile(join(assets, state.spriteFile))).toEqual(png);
  });

  it("rejects duplicate generation and preserves state after failure", async () => {
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

  it("validates sprite, size, status and keeps runtime status out of state", async () => {
    mocks.image.mockReturnValueOnce({ isEmpty: () => false, getSize: () => ({ width: 512, height: 512 }) });
    await expect(call("pet:generate", mainEvent, input)).rejects.toThrow(/1024/);
    await expect(readFile(join(dir, "pets/state.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await call("pet:generate", mainEvent, input);
    for (const size of [99, 301, 100.5, NaN, "150"]) await expect(call("pet:set-size", mainEvent, size)).rejects.toThrow();
    for (const value of ["sleep", null, 1]) await expect(call("pet:set-status", mainEvent, value)).rejects.toThrow();
    await call("pet:set-status", mainEvent, "working");
    await call("pet:set-size", mainEvent, 300);
    expect(JSON.parse(await readFile(join(dir, "pets/state.json"), "utf8"))).not.toHaveProperty("status");
    expect(pet.update).toHaveBeenCalledWith(expect.any(String), "working", 300);
  });

  it("rejects opaque sprites without changing state", async () => {
    mocks.image.mockReturnValueOnce({ isEmpty: () => false, getSize: () => ({ width: 1024, height: 1024 }), toBitmap: () => Buffer.alloc(1024 * 1024 * 4, 255) });
    await expect(call("pet:generate", mainEvent, input)).rejects.toThrow(/透明/);
    expect(main.webContents.send).not.toHaveBeenCalled();
  });

  it("ignores traversal paths and missing images on restore", async () => {
    const pets = join(dir, "pets");
    await mkdir(pets);
    await writeFile(join(pets, "state.json"), JSON.stringify({ enabled: true, size: 160, spriteFile: "../secret.png", sourceFile: "../secret.png" }));
    expect(await call("pet:get", mainEvent)).toMatchObject({ enabled: false, spriteDataUrl: null, sourceDataUrl: null });
    await service.restorePetWindow();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("restores enabled window and saved position only when sprite exists", async () => {
    const pets = join(dir, "pets");
    const name = "12345678-1234-1234-1234-123456789abc.png";
    await mkdir(join(pets, "assets"), { recursive: true });
    await writeFile(join(pets, "state.json"), JSON.stringify({ enabled: true, size: 200, spriteFile: name, position: { x: 23, y: 42 } }));
    expect(await call("pet:get", mainEvent)).toMatchObject({ enabled: false, spriteDataUrl: null });
    await service.restorePetWindow();
    expect(mocks.create).not.toHaveBeenCalled();
    await writeFile(join(pets, "assets", name), png);
    await service.restorePetWindow();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(pet.restorePosition).toHaveBeenCalledWith(23, 42);
    expect(pet.update).toHaveBeenCalledWith(`data:image/png;base64,${png.toString("base64")}`, "idle", 200);
  });
});
