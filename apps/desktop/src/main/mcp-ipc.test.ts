import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "@zen/shared";

const state = vi.hoisted(() => {
  type FakeClient = {
    config: {
      id: string;
      name: string;
      transport?: string;
      command?: string;
      url?: string;
      headers?: Record<string, string>;
      enabled: boolean;
    };
    connected: boolean;
    connectCalls: number;
    listToolsCalls: number;
    shutdownCalls: number;
    requiresAuth: boolean;
    authChallenge: string | null;
    tools: Array<{ serverId: string; name: string; description?: string; inputSchema: Record<string, unknown> }>;
  };
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    stored: { servers: [] as unknown[] },
    written: [] as unknown[][],
    clients: [] as FakeClient[],
    /** serverId → 模拟服务端 401 时的 WWW-Authenticate 挑战；存在则 connect 抛 401 并带挑战 */
    authFailures: new Map<string, string>(),
    /** serverId → 已保存的 access token（模拟 mcp-auth-store 的可读凭据） */
    tokensForServer: new Map<string, string>(),
    authEntries: new Map<string, unknown>(),
    tokenLookups: new Set<string>(),
    clearExceptCalls: [] as string[][],
    runBrowserAuthorization: vi.fn(),
    openExternal: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
  shell: {
    openExternal: state.openExternal,
  },
}));

vi.mock("./zen-dir", () => ({
  readMcpConfig: async () => ({ servers: state.stored.servers }),
  writeMcpConfig: async (servers: unknown[]) => {
    state.stored.servers = servers;
    state.written.push(servers);
  },
}));

vi.mock("./mcp-auth-store", () => ({
  readMcpAuthEntry: async (serverId: string) => state.authEntries.get(serverId) ?? null,
  saveMcpAuthEntry: async (serverId: string, tokens: { accessToken: string }, registration: unknown) => {
    state.authEntries.set(serverId, { tokens, registration });
    state.tokensForServer.set(serverId, tokens.accessToken);
  },
  clearMcpAuthEntry: async (serverId: string) => {
    state.authEntries.delete(serverId);
    state.tokensForServer.delete(serverId);
  },
  clearMcpAuthExcept: async (ids: string[]) => {
    state.clearExceptCalls.push([...ids]);
    const keep = new Set(ids);
    for (const id of [...state.authEntries.keys()]) {
      if (!keep.has(id)) {
        state.authEntries.delete(id);
        state.tokensForServer.delete(id);
      }
    }
  },
  getValidAccessToken: async (serverId: string) => {
    state.tokenLookups.add(serverId);
    return state.tokensForServer.get(serverId) ?? null;
  },
}));

vi.mock("@zen/mcp-client", () => ({
  createMcpClient: (config: (typeof state.clients)[number]["config"]) => {
    const fake: (typeof state.clients)[number] = {
      config,
      connected: false,
      connectCalls: 0,
      listToolsCalls: 0,
      shutdownCalls: 0,
      requiresAuth: false,
      authChallenge: null,
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
      get requiresAuth() {
        return fake.requiresAuth;
      },
      get authChallenge() {
        return fake.authChallenge;
      },
      connect: async () => {
        fake.connectCalls += 1;
        if (fake.config.command === "boom") {
          throw new Error("connect failed");
        }
        const challenge = state.authFailures.get(fake.config.id);
        if (challenge !== undefined) {
          fake.requiresAuth = true;
          fake.authChallenge = challenge;
          throw new Error("Unauthorized (401)");
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
  runBrowserAuthorization: state.runBrowserAuthorization,
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

const httpConfig: McpServerConfig = {
  id: "r1",
  name: "remote",
  transport: "http",
  url: "https://mcp.example.com",
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
  state.authFailures.clear();
  state.tokensForServer.clear();
  state.authEntries.clear();
  state.tokenLookups.clear();
  state.clearExceptCalls.length = 0;
  state.runBrowserAuthorization.mockReset();
  state.openExternal.mockReset();
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

describe("mcp-ipc OAuth 授权接线", () => {
  it("远程服务 401 挑战 → needs-auth 态，挑战留在 client 上供授权流程读取", async () => {
    state.stored.servers = [httpConfig];
    state.authFailures.set("r1", 'Bearer realm="mcp"');

    const statuses = (await handler("mcp:list")(null)) as Array<{
      state: string;
      error?: string;
      tools: unknown[];
    }>;

    expect(statuses[0]?.state).toBe("needs-auth");
    expect(statuses[0]?.error).toBe("需要浏览器授权");
    expect(statuses[0]?.tools).toEqual([]);
    expect(state.clients[0]?.authChallenge).toBe('Bearer realm="mcp"');
  });

  it("configWithAuth：已存 token 合并进 Authorization 头；stdio 不注入；注入的 token 不回传 UI", async () => {
    state.stored.servers = [httpConfig, baseConfig];
    state.tokensForServer.set("r1", "tok-123");

    await handler("mcp:list")(null);

    const remote = state.clients.find((client) => client.config.id === "r1");
    expect(remote?.config.headers).toMatchObject({ Authorization: "Bearer tok-123" });
    expect(state.tokenLookups.has("srv-1")).toBe(false);

    const statuses = (await handler("mcp:list")(null)) as Array<{ config: McpServerConfig }>;
    expect(statuses.find((item) => item.config.id === "r1")?.config.headers).toBeUndefined();
  });

  it("mcp:authorize 成功：凭据落盘、旧 client 关停、按新 token 重建并返回最新状态", async () => {
    state.stored.servers = [httpConfig];
    state.authFailures.set("r1", "challenge-x");
    await handler("mcp:list")(null);
    const oldClient = state.clients[0];

    state.runBrowserAuthorization.mockResolvedValue({
      tokens: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: 4102444800000 },
      registration: { clientId: "cid", tokenEndpoint: "https://token.example.com" },
    });
    // 模拟带上新 token 后服务端不再 401
    state.authFailures.delete("r1");

    const statuses = (await handler("mcp:authorize")(null, "r1")) as Array<{
      state: string;
      tools: Array<{ name: string }>;
    }>;

    expect(state.runBrowserAuthorization).toHaveBeenCalledWith(
      httpConfig,
      expect.objectContaining({ challenge: "challenge-x" }),
    );
    expect(state.authEntries.get("r1")).toMatchObject({
      tokens: { accessToken: "at-1", refreshToken: "rt-1" },
      registration: { clientId: "cid", tokenEndpoint: "https://token.example.com" },
    });
    expect(oldClient?.shutdownCalls).toBe(1);
    const rebuilt = state.clients[1];
    expect(rebuilt?.config.headers).toMatchObject({ Authorization: "Bearer at-1" });
    expect(statuses[0]?.state).toBe("running");
    expect(statuses[0]?.tools.map((tool) => tool.name)).toEqual(["tool-of-remote"]);

    const options = state.runBrowserAuthorization.mock.calls[0]?.[1] as {
      openExternal: (url: string) => void;
    };
    options.openExternal("https://auth.example.com/consent");
    expect(state.openExternal).toHaveBeenCalledWith("https://auth.example.com/consent");
  });

  it("mcp:authorize 并发防重入：同 serverId 复用进行中的 Promise", async () => {
    state.stored.servers = [httpConfig];
    let resolveAuth!: (value: unknown) => void;
    const pendingAuth = new Promise((resolve) => {
      resolveAuth = resolve;
    });
    state.runBrowserAuthorization.mockImplementation(() => pendingAuth);

    const first = handler("mcp:authorize")(null, "r1") as Promise<unknown>;
    const second = handler("mcp:authorize")(null, "r1") as Promise<unknown>;
    resolveAuth({
      tokens: { accessToken: "at-2" },
      registration: { clientId: "c", tokenEndpoint: "t" },
    });
    const [r1, r2] = await Promise.all([first, second]);

    expect(state.runBrowserAuthorization).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  it("mcp:set-servers 移除服务后清理其 OAuth 凭据", async () => {
    state.stored.servers = [httpConfig, baseConfig];
    state.authEntries.set("r1", { tokens: { accessToken: "at" }, registration: {} });
    state.tokensForServer.set("r1", "at");

    await handler("mcp:set-servers")(null, [baseConfig]);

    expect(state.clearExceptCalls.at(-1)).toEqual(["srv-1"]);
    expect(state.authEntries.has("r1")).toBe(false);
    expect(state.tokensForServer.has("r1")).toBe(false);
  });

  it("mcp:authorize：stdio 服务与服务不存在均抛错，不触发浏览器授权", async () => {
    state.stored.servers = [baseConfig];
    await expect(handler("mcp:authorize")(null, "srv-1")).rejects.toThrow(
      "本地 stdio 服务无需 OAuth 授权",
    );
    await expect(handler("mcp:authorize")(null, "ghost")).rejects.toThrow(
      "MCP 服务不存在: ghost",
    );
    expect(state.runBrowserAuthorization).not.toHaveBeenCalled();
  });
});
