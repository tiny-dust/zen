import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "@zen/shared";

const state = vi.hoisted(() => {
  type FakeClient = {
    config: { id: string; name: string; command?: string; enabled: boolean };
    connected: boolean;
    connectCalls: number;
    listToolsCalls: number;
    shutdownCalls: number;
    tools: Array<{ serverId: string; name: string; description?: string; inputSchema: Record<string, unknown> }>;
  };
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    stored: { servers: [] as unknown[] },
    written: [] as unknown[][],
    clients: [] as FakeClient[],
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
}));

vi.mock("./zen-dir", () => ({
  readMcpConfig: async () => ({ servers: state.stored.servers }),
  writeMcpConfig: async (servers: unknown[]) => {
    state.stored.servers = servers;
    state.written.push(servers);
  },
}));

vi.mock("@zen/mcp-client", () => ({
  createMcpClient: (config: { id: string; name: string; command?: string; enabled: boolean }) => {
    const fake: (typeof state.clients)[number] = {
      config,
      connected: false,
      connectCalls: 0,
      listToolsCalls: 0,
      shutdownCalls: 0,
      tools: [
        {
          serverId: config.id,
          name: `tool-of-${config.name}`,
          description: "demo",
          inputSchema: {},
        },
      ],
    };
    state.clients.push(fake);
    return {
      get isConnected() {
        return fake.connected;
      },
      connect: async () => {
        fake.connectCalls += 1;
        if (fake.config.command === "boom") {
          throw new Error("connect failed");
        }
        fake.connected = true;
      },
      listTools: async () => {
        fake.listToolsCalls += 1;
        return fake.tools;
      },
      callTool: async () => ({ ok: true, text: "ok" }),
      shutdown: () => {
        fake.shutdownCalls += 1;
        fake.connected = false;
      },
    };
  },
}));

import { callMcpTool, enabledMcpTools, registerMcpIpc, shutdownMcp } from "./mcp-ipc";

const baseConfig: McpServerConfig = {
  id: "srv-1",
  name: "demo",
  transport: "stdio",
  command: "demo-cmd",
  args: ["--a"],
  enabled: true,
};

function handler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const fn = state.handlers.get(channel);
  expect(fn, `未注册 IPC 通道 ${channel}`).toBeTruthy();
  return fn as (event: unknown, ...args: unknown[]) => unknown;
}

beforeEach(() => {
  state.handlers.clear();
  state.stored.servers = [];
  state.written.length = 0;
  state.clients.length = 0;
  registerMcpIpc();
});

afterEach(() => {
  shutdownMcp();
  vi.clearAllMocks();
});

describe("mcp-ipc 配置签名", () => {
  it("mcp:list 惰性连接并缓存工具清单", async () => {
    state.stored.servers = [baseConfig];

    const first = (await handler("mcp:list")(null)) as Array<{ tools: Array<{ name: string }> }>;
    const second = (await handler("mcp:list")(null)) as Array<{ tools: Array<{ name: string }> }>;

    expect(first[0]?.tools.map((tool) => tool.name)).toEqual(["tool-of-demo"]);
    expect(second[0]?.tools.map((tool) => tool.name)).toEqual(["tool-of-demo"]);
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.listToolsCalls).toBe(1);
    expect(state.clients[0]?.shutdownCalls).toBe(0);
  });

  it("同 id 配置编辑后关停旧 client、作废缓存并按新配置重建", async () => {
    state.stored.servers = [baseConfig];
    await handler("mcp:list")(null);
    const oldClient = state.clients[0];
    expect(oldClient?.listToolsCalls).toBe(1);

    const edited: McpServerConfig = { ...baseConfig, command: "new-cmd", args: ["--b"] };
    const statuses = (await handler("mcp:set-servers")(null, [edited])) as Array<{
      config: McpServerConfig;
      state: string;
      tools: Array<{ name: string }>;
    }>;

    expect(oldClient?.shutdownCalls).toBe(1);
    expect(state.clients).toHaveLength(2);
    const rebuilt = state.clients[1];
    expect(rebuilt?.config).toMatchObject({ id: "srv-1", command: "new-cmd", args: ["--b"] });
    expect(rebuilt?.listToolsCalls).toBe(1);
    expect(statuses[0]?.state).toBe("running");
    expect(statuses[0]?.tools.map((tool) => tool.name)).toEqual(["tool-of-demo"]);
  });

  it("同 id 配置未变化时不重建 client", async () => {
    state.stored.servers = [baseConfig];
    await handler("mcp:list")(null);

    // 字段顺序不同但值相同：签名一致，不应重启
    const same: McpServerConfig = {
      enabled: true,
      args: ["--a"],
      command: "demo-cmd",
      transport: "stdio",
      name: "demo",
      id: "srv-1",
    };
    await handler("mcp:set-servers")(null, [same]);

    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.shutdownCalls).toBe(0);
    expect(state.clients[0]?.listToolsCalls).toBe(1);
  });

  it("禁用或移除服务时关停 client 并清缓存", async () => {
    state.stored.servers = [baseConfig];
    await handler("mcp:list")(null);
    const client = state.clients[0];

    await handler("mcp:set-servers")(null, [{ ...baseConfig, enabled: false }]);
    expect(client?.shutdownCalls).toBe(1);

    // 重新启用后再移除
    await handler("mcp:set-servers")(null, [baseConfig]);
    expect(state.clients).toHaveLength(2);
    await handler("mcp:set-servers")(null, []);
    expect(state.clients[1]?.shutdownCalls).toBe(1);
  });
});

describe("mcp-ipc 工具桥接与调用", () => {
  it("enabledMcpTools：跳过禁用 server，缓存后不重复 listTools，标注 serverName", async () => {
    state.stored.servers = [baseConfig, { ...baseConfig, id: "srv-2", name: "off", enabled: false }];
    const tools = await enabledMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(["tool-of-demo"]);
    expect(tools[0]?.serverName).toBe("demo");
    // 再次调用走缓存
    await enabledMcpTools();
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.listToolsCalls).toBe(1);
  });

  it("enabledMcpTools：单个 server 连接失败不影响其他 server", async () => {
    state.stored.servers = [
      { ...baseConfig, id: "bad", name: "bad", command: "boom" },
      baseConfig,
    ];
    const tools = await enabledMcpTools();
    expect(tools.map((tool) => tool.serverName)).toEqual(["demo"]);
    expect(state.clients).toHaveLength(2);
  });

  it("callMcpTool：未启用/不存在 → 错误文本；命中 → 透传 callTool", async () => {
    await expect(callMcpTool("ghost", "t", {})).resolves.toEqual({
      ok: false,
      text: "",
      error: "MCP server 不存在或未启用: ghost",
    });

    state.stored.servers = [baseConfig];
    await expect(callMcpTool("demo", "run", { a: 1 })).resolves.toEqual({ ok: true, text: "ok" });
    expect(state.clients).toHaveLength(1);
  });

  it("mcp:scan 透传 workspaceRoot；mcp:set-servers 非数组 → 空数组", async () => {
    state.stored.servers = [baseConfig];
    const scan = await handler("mcp:scan")(null, "/tmp/ws");
    expect(Array.isArray(scan)).toBe(true);
    expect(await handler("mcp:set-servers")(null, "not-an-array")).toEqual([]);
  });

  it("连接失败的 server 在 mcp:list 标 error 态；禁用标 stopped", async () => {
    state.stored.servers = [
      { ...baseConfig, id: "bad", name: "bad", command: "boom" },
      { ...baseConfig, id: "off", name: "off", enabled: false },
    ];
    const statuses = (await handler("mcp:list")(null)) as Array<{
      state: string;
      error?: string;
      tools: unknown[];
    }>;
    expect(statuses.map((item) => item.state)).toEqual(["error", "stopped"]);
    expect(statuses[0]?.error).toBeTruthy();
    expect(statuses[0]?.tools).toEqual([]);
    expect(state.clients).toHaveLength(1);
  });
});
