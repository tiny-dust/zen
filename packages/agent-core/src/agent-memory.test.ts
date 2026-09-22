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
    expect(appendNote).toHaveBeenCalledWith("user", "偏好中文回复");
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
