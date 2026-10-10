import { describe, expect, it } from "vitest";

import { buildInstructions } from "./agent-config";

import type { AgentSessionConfig } from "./agent-config";

/**
 * buildInstructions 组装分支：
 * - MCP 清单的「主动调用规则」文案（默认要主动调用而非反问用户）
 * - multiAgent=false 不注入多 Agent 约定；memoryBridge / browserBridge 各自附加说明
 */

function baseConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    sessionId: "sess-1",
    workspaceRoot: "/tmp/zen-workspace",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:9999",
    apiKey: "key",
    model: "m",
    permissionMode: "smart",
    emit: () => {},
    ...overrides,
  };
}

describe("buildInstructions", () => {
  it("MCP 清单含工具列表与主动调用规则", () => {
    const text =
      buildInstructions(
        baseConfig({
          mcpTools: [
            {
              serverName: "lark",
              name: "send",
              description: "发消息",
              inputSchema: { type: "object", properties: {} },
            },
            { serverName: "lark", name: "bare", inputSchema: { type: "object", properties: {} } },
          ],
        }),
      ) ?? "";

    expect(text).toContain("- mcp.lark.send: 发消息");
    expect(text).toContain("- mcp.lark.bare:");
    expect(text).toContain("主动调用规则");
    expect(text).toContain("优先调用对应的 mcp.<server>.<tool> 完成");
    expect(text).toContain("不要静默吞掉");
    expect(text).toContain("「MCP 服务」弹窗");
    // 输入框 # 菜单插入的引用 token：Agent 要把 #mcp: 引用当成用户指名调用
    expect(text).toContain("#mcp:<server>.<tool>");
    expect(text).toContain("明确指名该工具");
  });

  it("无 MCP 工具时不注入主动调用规则", () => {
    const text = buildInstructions(baseConfig()) ?? "";
    expect(text).not.toContain("主动调用规则");
  });

  it("技能清单逐条列出，multiAgent=false 不注入多 Agent 约定", () => {
    const withAgent = buildInstructions(baseConfig()) ?? "";
    expect(withAgent).toContain("【多 Agent 协作】");

    const text =
      buildInstructions(
        baseConfig({
          multiAgent: false,
          skills: [
            { id: "/x/coder", name: "coder", description: "编码入口" },
            { id: "/x/bare", name: "bare", description: "" },
          ],
        }),
      ) ?? "";
    expect(text).toContain("- coder（id: /x/coder）：编码入口");
    expect(text).toContain("- bare（id: /x/bare）：无描述");
    expect(text).not.toContain("【多 Agent 协作】");
  });

  it("memoryContext / memoryBridge / browserBridge 各自附加说明", () => {
    const text =
      buildInstructions(
        baseConfig({
          systemPrompt: "  系统提示  ",
          memoryContext: "  记忆上下文  ",
          memoryBridge: { appendNote: async () => ({ ok: true }) },
          browserBridge: {} as never,
        }),
      ) ?? "";
    expect(text.startsWith("系统提示")).toBe(true);
    expect(text).toContain("记忆上下文");
    expect(text).toContain("用 updateMemory 工具追加一条简洁备注");
    expect(text).toContain("内置浏览器已接入");
    expect(text).toContain("当前工作目录：/tmp/zen-workspace");
    expect(text).toContain("今天的日期：");
  });
});
