import { describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { buildInstructions } from "./agent-config";
import type { AgentSessionConfig } from "./agent-config";
import { buildToolSet } from "./agent-tools";

/** 记忆：memoryContext 注入系统提示词；memoryBridge 决定 updateMemory 工具是否注册 */
function baseConfig(overrides?: Partial<AgentSessionConfig>): AgentSessionConfig {
  return {
    sessionId: "s1",
    workspaceRoot: "/tmp/ws",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
    emit: (() => undefined) as (event: AgentStreamEvent) => void,
    ...overrides,
  };
}

describe("buildInstructions 记忆注入", () => {
  it("无记忆时不注入记忆段", () => {
    const text = buildInstructions(baseConfig()) ?? "";
    expect(text).not.toContain("设备环境记忆");
    expect(text).not.toContain("用户习惯记忆");
  });

  it("memoryContext 原样注入（设备 + 用户两段）", () => {
    const text = buildInstructions(
      baseConfig({
        memoryContext: "设备环境记忆（…）：\n- 系统：darwin arm64\n\n用户习惯记忆：\n- 回复用中文",
      }),
    );
    expect(text).toContain("设备环境记忆");
    expect(text).toContain("用户习惯记忆");
    expect(text).toContain("回复用中文");
  });

  it("带 memoryBridge 时提示 updateMemory 的使用边界", () => {
    const text = buildInstructions(
      baseConfig({ memoryBridge: { appendNote: async () => ({ ok: true }) } }),
    );
    expect(text).toContain("updateMemory");
  });
});

describe("updateMemory 工具注册", () => {
  it("有 memoryBridge：注册且 execute 落到 appendNote（scope+text 透传）", async () => {
    const appendNote = vi.fn(async () => ({ ok: true }));
    const toolSet = buildToolSet("/tmp/ws", () => undefined, "s1", baseConfig({ memoryBridge: { appendNote } }), {
      waitForUserAnswer: async () => "",
      emitAskEvent: () => undefined,
      emitAskResolved: () => undefined,
    });
    expect(toolSet["updateMemory"]).toBeDefined();
    const executed = await (toolSet["updateMemory"] as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    }).execute({ scope: "user", text: "偏好中文回复" });
    expect(executed).toEqual({ ok: true });
    expect(appendNote).toHaveBeenCalledWith("user", "偏好中文回复", undefined);
  });

  it("device 备注带上分类，透传给 appendNote", async () => {
    const appendNote = vi.fn(async () => ({ ok: true }));
    const toolSet = buildToolSet(
      "/tmp/ws",
      () => undefined,
      "s1",
      baseConfig({ memoryBridge: { appendNote, readNotes: async () => [] } }),
      { waitForUserAnswer: async () => "", emitAskEvent: () => undefined, emitAskResolved: () => undefined },
    );
    await (toolSet["updateMemory"] as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    }).execute({ scope: "device", text: "全局依赖用 pnpm", category: "env" });
    expect(appendNote).toHaveBeenCalledWith("device", "全局依赖用 pnpm", "env");
  });

  it("有 readNotes 才注册 readMemory，execute 按分类读取正文", async () => {
    const readNotes = vi.fn(async () => [
      { text: "全局依赖用 pnpm", category: "env" as const },
      { text: "ATS 项目在 ~/Company/tars", category: "project" as const },
    ]);
    const toolSet = buildToolSet(
      "/tmp/ws",
      () => undefined,
      "s1",
      baseConfig({ memoryBridge: { appendNote: async () => ({ ok: true }), readNotes } }),
      { waitForUserAnswer: async () => "", emitAskEvent: () => undefined, emitAskResolved: () => undefined },
    );
    expect(toolSet["readMemory"]).toBeDefined();
    const result = await (toolSet["readMemory"] as unknown as {
      execute: (input: unknown) => Promise<unknown>;
    }).execute({ scope: "device", category: "project" });
    expect(readNotes).toHaveBeenCalledWith("device", "project");
    expect(result).toEqual({
      count: 2,
      notes: [
        { text: "全局依赖用 pnpm", category: "env" },
        { text: "ATS 项目在 ~/Company/tars", category: "project" },
      ],
    });
  });

  it("没有 readNotes：不注册 readMemory（只保留 updateMemory）", () => {
    const toolSet = buildToolSet(
      "/tmp/ws",
      () => undefined,
      "s1",
      baseConfig({ memoryBridge: { appendNote: async () => ({ ok: true }) } }),
      { waitForUserAnswer: async () => "", emitAskEvent: () => undefined, emitAskResolved: () => undefined },
    );
    expect(toolSet["updateMemory"]).toBeDefined();
    expect(toolSet["readMemory"]).toBeUndefined();
  });

  it("无 memoryBridge：不注册该工具", () => {
    const toolSet = buildToolSet("/tmp/ws", () => undefined, "s1", baseConfig(), {
      waitForUserAnswer: async () => "",
      emitAskEvent: () => undefined,
      emitAskResolved: () => undefined,
    });
    expect(toolSet["updateMemory"]).toBeUndefined();
  });
});
