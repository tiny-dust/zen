import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, session: { defaultSession: { clearCache: vi.fn() } } }));
vi.mock("./zen-dir", () => ({ zenCacheRoot: () => state.root }));
vi.mock("./favicons", () => ({
  faviconCacheDir: () => join(state.root, "favicons"),
  clearFaviconMemory: vi.fn(),
}));

import { clearTemporaryCache } from "./cache-ipc";
import { clearFaviconMemory } from "./favicons";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zen-cache-test-"));
  state.root = root;
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("clearTemporaryCache", () => {
  it("removes site icon cache while keeping files referenced by sessions", async () => {
    for (const name of ["screenshots", "favicons", "sessions", "paste"]) {
      const dir = join(root, name);
      await mkdir(dir);
      await writeFile(join(dir, "saved-file"), name);
    }

    await clearTemporaryCache();

    expect(await readdir(root)).toEqual(["paste", "screenshots", "sessions"]);
    expect(await readdir(join(root, "sessions"))).toEqual(["saved-file"]);
    expect(await readdir(join(root, "paste"))).toEqual(["saved-file"]);
    expect(await readdir(join(root, "screenshots"))).toEqual(["saved-file"]);
    expect(clearFaviconMemory).toHaveBeenCalledOnce();
  });

  it("succeeds when there are no cache directories yet", async () => {
    await expect(clearTemporaryCache()).resolves.toBeUndefined();
  });
});
