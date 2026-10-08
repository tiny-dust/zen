import { describe, expect, it, vi } from "vitest";

/**
 * MCP 运行时延迟注册：未注册时 importMcpRuntime 抛错；
 * 注册后返回 main 侧注入的运行时实例。
 */

describe("mcp-runtime", () => {
  it("未注册时 importMcpRuntime 抛「MCP runtime 未注册」", async () => {
    vi.resetModules();
    const mod = await import("./mcp-runtime");
    await expect(mod.importMcpRuntime()).rejects.toThrow("MCP runtime 未注册");
  });

  it("registerMcpRuntime 注册后可延迟加载", async () => {
    vi.resetModules();
    const mod = await import("./mcp-runtime");
    const callMcpTool = vi.fn(
      async (_serverName: string, _toolName: string, _args: unknown) => ({ ok: true, text: "done" }),
    );
    const runtime = { callMcpTool };
    mod.registerMcpRuntime(async () => runtime);

    await expect(mod.importMcpRuntime()).resolves.toBe(runtime);
    await expect(runtime.callMcpTool("s", "t", { a: 1 })).resolves.toEqual({
      ok: true,
      text: "done",
    });
  });
});
