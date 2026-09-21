/** 延迟加载 main 侧 MCP 运行时，避免 agent-core 启动即依赖 Electron */
let mcpRuntimeLoader: (() => Promise<{
  callMcpTool(
    serverName: string,
    toolName: string,
    args: unknown,
  ): Promise<{ ok: boolean; text: string; error?: string }>;
}>) | null = null;

export function registerMcpRuntime(
  loader: () => Promise<{
    callMcpTool(
      serverName: string,
      toolName: string,
      args: unknown,
    ): Promise<{ ok: boolean; text: string; error?: string }>;
  }>,
): void {
  mcpRuntimeLoader = loader;
}

export async function importMcpRuntime() {
  if (!mcpRuntimeLoader) {
    throw new Error("MCP runtime 未注册");
  }
  return mcpRuntimeLoader();
}
