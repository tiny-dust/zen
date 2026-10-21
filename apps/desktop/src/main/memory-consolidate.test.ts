// 记忆整固契约：
// 1. 预览（consolidateMemory）只算 diff 不落盘——模型失败 / JSON 解析失败 / 模型清空全部条目
//    都返回 {ok:false, error}，绝不修改原始 JSON 文件；
// 2. 应用（applyMemoryConsolidation）原子写回（临时文件 + rename），device 域只替换 notes；
// 3. IPC 边界（memory:consolidate-preview / memory:apply）非法参数不落盘。
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dir: "",
  completeOnce: vi.fn(),
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
}));

vi.mock("./zen-dir", () => ({
  zenMemoryDir: () => state.dir,
}));

vi.mock("./model-api", () => ({
  completeOnce: state.completeOnce,
}));

import { applyMemoryConsolidation, consolidateMemory } from "./memory";
import { registerMemoryIpc } from "./memory-ipc";

type Note = { id: string; text: string; createdAt: number };

function writeUserNotes(notes: Note[]): void {
  writeFileSync(join(state.dir, "user.json"), JSON.stringify({ notes }, null, 2), "utf8");
}

function readUserNotes(): Note[] {
  return (JSON.parse(readFileSync(join(state.dir, "user.json"), "utf8")) as { notes: Note[] }).notes;
}

const NOTES: Note[] = [
  { id: "n1", text: "全局依赖用 pnpm", createdAt: 1000 },
  { id: "n2", text: "全局依赖使用 pnpm（重复）", createdAt: 2000 },
  { id: "n3", text: "shell 是 /bin/zsh", createdAt: 3000 },
];

const MERGED: Note[] = [
  { id: "n1", text: "全局依赖用 pnpm", createdAt: 1000 },
  { id: "n3", text: "默认 shell 是 /bin/zsh", createdAt: 3000 },
];

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), "zen-memory-test-"));
  state.completeOnce.mockReset();
  state.handlers.clear();
});

afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true });
});

describe("consolidateMemory 预览与失败安全", () => {
  it("模型返回合并结果：返回 before/after/changedCount，且不落盘", async () => {
    writeUserNotes(NOTES);
    // 模型输出带 Markdown 围栏也应可解析
    state.completeOnce.mockResolvedValue(`\`\`\`json\n${JSON.stringify(MERGED)}\n\`\`\``);

    const result = await consolidateMemory("user");

    expect(result.ok).toBe(true);
    expect(result.scope).toBe("user");
    expect(result.before).toHaveLength(3);
    expect(result.after.map((note) => note.text)).toEqual([
      "全局依赖用 pnpm",
      "默认 shell 是 /bin/zsh",
    ]);
    // before 中 2 条被移除/改写 + after 中 1 条改写
    expect(result.changedCount).toBe(3);
    // 落盘文件保持原样
    expect(readUserNotes()).toHaveLength(3);
  });

  it("模型调用失败：返回 {ok:false, error}，原始数据不动", async () => {
    writeUserNotes(NOTES);
    state.completeOnce.mockRejectedValue(new Error("模型未返回文本内容"));

    const result = await consolidateMemory("user");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("模型未返回文本内容");
    expect(readUserNotes()).toHaveLength(3);
  });

  it("模型输出非法 JSON：返回 {ok:false, error}，原始数据不动", async () => {
    writeUserNotes(NOTES);
    state.completeOnce.mockResolvedValue("这不是 JSON");

    const result = await consolidateMemory("user");

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(readUserNotes()).toHaveLength(3);
  });

  it("模型清空了全部条目：视为失败，不允许误删", async () => {
    writeUserNotes(NOTES);
    state.completeOnce.mockResolvedValue("[]");

    const result = await consolidateMemory("user");

    expect(result.ok).toBe(false);
    expect(readUserNotes()).toHaveLength(3);
  });

  it("该域无备注：直接返回无变化，不调用模型", async () => {
    const result = await consolidateMemory("user");

    expect(result.ok).toBe(true);
    expect(result.changedCount).toBe(0);
    expect(state.completeOnce).not.toHaveBeenCalled();
  });
});

describe("applyMemoryConsolidation 原子写回", () => {
  it("user 域写回合并结果，且不残留临时文件", async () => {
    writeUserNotes(NOTES);

    const snapshot = await applyMemoryConsolidation("user", MERGED);

    expect(snapshot.user.notes.map((note) => note.text)).toEqual([
      "全局依赖用 pnpm",
      "默认 shell 是 /bin/zsh",
    ]);
    expect(readdirSync(state.dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("device 域只替换 notes，快照其余字段保持不变", async () => {
    writeFileSync(
      join(state.dir, "device.json"),
      JSON.stringify({
        collectedAt: 123,
        platform: "darwin",
        arch: "arm64",
        home: "/Users/t",
        shell: "/bin/zsh",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        tools: { node: "/usr/bin/node" },
        notes: NOTES,
      }),
      "utf8",
    );

    const snapshot = await applyMemoryConsolidation("device", MERGED);

    expect(snapshot.device?.notes).toHaveLength(2);
    expect(snapshot.device?.collectedAt).toBe(123);
    expect(snapshot.device?.tools).toEqual({ node: "/usr/bin/node" });
    expect(readdirSync(state.dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("非法条目（空文本）在写回前被清洗掉", async () => {
    writeUserNotes(NOTES);

    const snapshot = await applyMemoryConsolidation("user", [
      ...MERGED,
      { id: "bad", text: "   ", createdAt: 1 },
    ]);

    expect(snapshot.user.notes).toHaveLength(2);
  });
});

describe("记忆整固 IPC 边界", () => {
  it("memory:consolidate-preview 非法 scope 返回 {ok:false}，不 reject", async () => {
    registerMemoryIpc();
    const handler = state.handlers.get("memory:consolidate-preview");
    expect(handler).toBeTruthy();

    const result = (await handler?.(null, "workspace")) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid scope");
  });

  it("memory:apply 非法 notes（非数组）不落盘，返回当前快照", async () => {
    writeUserNotes(NOTES);
    registerMemoryIpc();
    const handler = state.handlers.get("memory:apply");
    expect(handler).toBeTruthy();

    const snapshot = (await handler?.(null, "user", "not-an-array")) as {
      user: { notes: Note[] };
    };
    expect(snapshot.user.notes).toHaveLength(3);
    expect(readUserNotes()).toHaveLength(3);
  });

  it("IPC 正常链路：consolidate-preview → apply 完成整固", async () => {
    writeUserNotes(NOTES);
    state.completeOnce.mockResolvedValue(JSON.stringify(MERGED));
    registerMemoryIpc();

    const preview = (await state.handlers.get("memory:consolidate-preview")?.(null, "user")) as {
      ok: boolean;
      after: Note[];
    };
    expect(preview.ok).toBe(true);

    const snapshot = (await state.handlers.get("memory:apply")?.(null, "user", preview.after)) as {
      user: { notes: Note[] };
    };
    expect(snapshot.user.notes.map((note) => note.text)).toEqual([
      "全局依赖用 pnpm",
      "默认 shell 是 /bin/zsh",
    ]);
  });
});
