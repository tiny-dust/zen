import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./zen-dir", () => ({ zenMemoryDir: () => state.dir }));
vi.mock("./model-api", () => ({ completeOnce: vi.fn() }));

import { candidateNames, collectDeviceMemory, findToolOnPath, initDeviceMemory } from "./memory";

const originalPath = process.env["PATH"];

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), "zen-memory-scan-"));
  process.env["PATH"] = state.dir;
});

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = originalPath;
  }
  rmSync(state.dir, { recursive: true, force: true });
});

function tool(name: string): string {
  const path = join(state.dir, name);
  writeFileSync(path, "tool", { mode: 0o755 });
  return path;
}

function savedDevice(): {
  collectedAt: number;
  toolScanVersion?: number;
  tools: Record<string, string>;
  notes: Array<{ id: string; text: string; createdAt: number; category?: string }>;
} {
  return JSON.parse(readFileSync(join(state.dir, "device.json"), "utf8"));
}

describe("设备 PATH 工具扫描", () => {
  it.skipIf(process.platform === "win32")("macOS/Linux 仅记录可执行的 runtime、编译器、包管理和框架 CLI", async () => {
    const names = ["node", "npx", "vite", "java", "javac", "mvn", "go", "rustc", "cargo", "pip3", "dotnet"];
    for (const name of names) {
      tool(name);
    }
    const unavailable = tool("gradle");
    chmodSync(unavailable, 0o644);

    const snapshot = await collectDeviceMemory();

    for (const name of names) {
      expect(snapshot.tools[name]).toBe(join(state.dir, name));
    }
    expect(snapshot.tools["gradle"]).not.toBe(unavailable);
    expect(snapshot.tools["missing"]).toBeUndefined();
    expect(snapshot.toolScanVersion).toBe(3);
  });

  it("Windows 用分号分隔 PATH，支持 cmd/exe/bat；不可用路径降级为 null", async () => {
    const second = join(state.dir, "other");
    const java = tool("java.exe");
    const next = tool("next.cmd");
    expect(candidateNames("cargo", "win32")).toContain("cargo.exe");
    expect(await findToolOnPath("java", `${second};${state.dir}`, "win32")).toBe(java);
    expect(await findToolOnPath("next", `${second};${state.dir}`, "win32")).toBe(next);
    expect(await findToolOnPath("cargo", `${second};${state.dir}`, "win32")).toBeNull();
    expect(await findToolOnPath("go", "", "linux")).toBeNull();
  });

  it("旧快照首次启动升级扫描且保留备注，后续启动不重扫", async () => {
    const node = tool("node");
    const go = tool("go");
    const notes = [{ id: "n1", text: "保留设备备注", createdAt: 123, category: "tool" }];
    writeFileSync(join(state.dir, "device.json"), JSON.stringify({
      collectedAt: 111,
      platform: process.platform,
      tools: { node },
      notes,
    }));

    await initDeviceMemory();
    expect(savedDevice().tools["go"]).toBe(go);
    expect(savedDevice().notes).toEqual(notes);
    expect(savedDevice().toolScanVersion).toBe(3);

    rmSync(go);
    await initDeviceMemory();
    expect(savedDevice().tools["go"]).toBe(go);
    expect(savedDevice().notes).toEqual(notes);
  });

  it("空 PATH 的快照也标记扫描完成，不在每次启动重扫", async () => {
    process.env["PATH"] = "";
    await initDeviceMemory();
    const first = readFileSync(join(state.dir, "device.json"), "utf8");
    expect(savedDevice().toolScanVersion).toBe(3);
    await initDeviceMemory();
    expect(readFileSync(join(state.dir, "device.json"), "utf8")).toBe(first);
  });
});
