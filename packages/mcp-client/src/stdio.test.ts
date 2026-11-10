import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpStdioClient } from "./stdio";

import type { McpServerConfig } from "@zen/shared";

/**
 * 本地 stdio 传输（mock child_process）：
 * - connect：spawn 命令/参数/env、行分隔 JSON-RPC 写入 stdin
 * - 入站：跨块行缓冲、坏行忽略、结果按 id 分发
 * - stderr 只留诊断缓存；进程退出拒绝挂起请求；shutdown 杀进程
 */

const { spawnMock, statMock, readdirMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  statMock: vi.fn(),
  readdirMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs/promises", () => ({ stat: statMock, readdir: readdirMock }));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (enc: string) => void };
  stderr: EventEmitter & { setEncoding: (enc: string) => void };
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "local",
    name: "local-server",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    env: { FOO: "bar" },
    enabled: true,
    ...overrides,
  };
}

/** 读出客户端写到 stdin 的请求 */
function written(child: FakeChild): Array<{ id?: number; method?: string }> {
  return child.stdin.write.mock.calls.map((call) => JSON.parse(String(call[0])) as never);
}

/** 服务端回包：按行写回 stdout（可切块） */
function reply(child: FakeChild, payload: unknown, chunks = 1): void {
  const line = `${JSON.stringify(payload)}\n`;
  const size = Math.ceil(line.length / chunks);
  for (let i = 0; i < line.length; i += size) {
    child.stdout.emit("data", line.slice(i, i + size));
  }
}

beforeEach(() => {
  spawnMock.mockReset();
  statMock.mockReset();
  readdirMock.mockReset();
  readdirMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockFiles(...files: string[]): void {
  const available = new Set(files);
  statMock.mockImplementation(async (path: string) => {
    if (!available.has(path)) throw new Error("ENOENT");
    return { isFile: () => true };
  });
}

async function connectNpx(overrides: Partial<McpServerConfig> = {}): Promise<void> {
  const child = fakeChild();
  spawnMock.mockReturnValue(child);
  const connecting = new McpStdioClient(
    config({ command: "npx", args: ["-y", "safe-package"], ...overrides }),
  ).connect();
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
  reply(child, { jsonrpc: "2.0", id: 1, result: {} });
  await connecting;
}

describe("McpStdioClient", () => {
  it("macOS GUI PATH 缺少用户 Node 时补找 npx/node", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const dir = join(homedir(), ".local", "bin");
    mockFiles(join(dir, "npx"), join(dir, "node"));

    await connectNpx();
    expect(spawnMock).toHaveBeenCalledWith(join(dir, "npx"), ["-y", "safe-package"],
      expect.objectContaining({ env: expect.objectContaining({ PATH: `${dir}${delimiter}/usr/bin:/bin`, FOO: "bar" }) }),
    );
    expect(spawnMock.mock.calls[0]?.[2].shell).toBeUndefined();
  });

  it("npx 参数中的 ~/ 路径按用户主目录展开", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("PATH", "/usr/bin");
    const dir = join(homedir(), ".local", "bin");
    mockFiles(join(dir, "npx"), join(dir, "node"));

    await connectNpx({ args: ["-y", "safe-package", "~/docs", "--name=~user"] });
    expect(spawnMock.mock.calls[0]?.[1]).toEqual([
      "-y", "safe-package", join(homedir(), "docs"), "--name=~user",
    ]);
  });

  it("macOS GUI PATH 找不到 pnpm 时从用户安装目录补找", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("PATH", "/usr/bin");
    const pnpmDir = join(homedir(), ".vite-plus", "bin");
    const nodeDir = join(homedir(), ".local", "bin");
    mockFiles(join(pnpmDir, "pnpm"), join(nodeDir, "node"));

    await connectNpx({ command: "pnpm", args: ["dlx", "shadcn-vue@latest", "mcp"] });
    expect(spawnMock).toHaveBeenCalledWith(join(pnpmDir, "pnpm"),
      ["dlx", "shadcn-vue@latest", "mcp"],
      expect.objectContaining({ env: expect.objectContaining({ PATH: `${nodeDir}${delimiter}/usr/bin` }) }),
    );
  });

  it("Linux PNPM_HOME 下的 pnpm 可以在 GUI PATH 缺失时启动", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.stubEnv("PATH", "/usr/bin");
    const dir = join(homedir(), ".local", "share", "pnpm");
    vi.stubEnv("PNPM_HOME", dir);
    mockFiles(join(dir, "pnpm"), join(dir, "node"));

    await connectNpx({ command: "pnpm", args: ["dlx", "shadcn-vue@latest", "mcp"] });
    expect(spawnMock).toHaveBeenCalledWith(join(dir, "pnpm"),
      ["dlx", "shadcn-vue@latest", "mcp"], expect.any(Object));
  });

  it("Linux nvm 版本目录下的 node/npx 也能找到", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.stubEnv("PATH", "/usr/bin");
    const root = join(homedir(), ".nvm", "versions", "node");
    readdirMock.mockResolvedValue(["v18.2.0", "v20.11.0"]);
    const dir = join(root, "v20.11.0", "bin");
    mockFiles(join(dir, "npx"), join(dir, "node"));

    await connectNpx();
    expect(spawnMock).toHaveBeenCalledWith(join(dir, "npx"), ["-y", "safe-package"],
      expect.objectContaining({ env: expect.objectContaining({ PATH: `${dir}${delimiter}/usr/bin` }) }),
    );
  });

  it("Windows 用 node 执行 npm CLI，不将配置参数交给 shell", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("PATH", "C:/Windows/System32");
    vi.stubEnv("APPDATA", "C:/Users/test/AppData/Roaming");
    vi.stubEnv("ProgramFiles", "C:/Program Files");
    const npxDir = join("C:/Users/test/AppData/Roaming", "npm");
    const nodeDir = join("C:/Program Files", "nodejs");
    const cli = join(npxDir, "node_modules", "npm", "bin", "npx-cli.js");
    mockFiles(join(npxDir, "npx.cmd"), join(nodeDir, "node.exe"), cli);

    await connectNpx({ args: ["-y", "package; echo unsafe"] });
    expect(spawnMock).toHaveBeenCalledWith(join(nodeDir, "node.exe"),
      [cli, "-y", "package; echo unsafe"],
      expect.objectContaining({ env: expect.objectContaining({ PATH: `${nodeDir}${delimiter}C:/Windows/System32` }) }),
    );
    expect(spawnMock.mock.calls[0]?.[2].shell).toBeUndefined();
  });

  it("Windows 的 npx.cmd 在用户 npm 目录而 npm CLI 在 Node 目录时仍可启动", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("PATH", "C:/Windows/System32");
    vi.stubEnv("APPDATA", "C:/Users/test/AppData/Roaming");
    vi.stubEnv("ProgramFiles", "C:/Program Files");
    const npxDir = join("C:/Users/test/AppData/Roaming", "npm");
    const nodeDir = join("C:/Program Files", "nodejs");
    const cli = join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
    mockFiles(join(npxDir, "npx.cmd"), join(nodeDir, "node.exe"), cli);

    await connectNpx();
    expect(spawnMock).toHaveBeenCalledWith(join(nodeDir, "node.exe"),
      [cli, "-y", "safe-package"], expect.any(Object));
  });

  it("Windows pnpm.cmd 经 Node 执行 CLI，不用 shell 解释参数", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("PATH", "C:/Windows/System32");
    vi.stubEnv("APPDATA", "C:/Users/test/AppData/Roaming");
    vi.stubEnv("ProgramFiles", "C:/Program Files");
    const pnpmDir = join("C:/Users/test/AppData/Roaming", "npm");
    const nodeDir = join("C:/Program Files", "nodejs");
    const cli = join(pnpmDir, "node_modules", "pnpm", "bin", "pnpm.cjs");
    mockFiles(join(pnpmDir, "pnpm.cmd"), join(nodeDir, "node.exe"), cli);

    await connectNpx({ command: "pnpm", args: ["dlx", "safe-package; echo unsafe", "mcp"] });
    expect(spawnMock).toHaveBeenCalledWith(join(nodeDir, "node.exe"),
      [cli, "dlx", "safe-package; echo unsafe", "mcp"], expect.any(Object));
    expect(spawnMock.mock.calls[0]?.[2].shell).toBeUndefined();
  });

  it("Windows PNPM_HOME 的独立 pnpm.exe 不依赖 Node 可执行", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("PATH", "C:/Windows/System32");
    vi.stubEnv("PNPM_HOME", "C:/Users/test/AppData/Local/pnpm");
    const executable = join("C:/Users/test/AppData/Local/pnpm", "pnpm.exe");
    mockFiles(executable);

    await connectNpx({ command: "pnpm", args: ["dlx", "shadcn-vue@latest", "mcp"] });
    expect(spawnMock).toHaveBeenCalledWith(executable,
      ["dlx", "shadcn-vue@latest", "mcp"], expect.any(Object));
  });

  it("找不到 npx 时保留原命令与 env，不修改其它命令", async () => {
    vi.stubEnv("PATH", "/missing");
    mockFiles();
    await connectNpx({ env: { FOO: "override", PATH: "/custom" } });
    expect(spawnMock).toHaveBeenCalledWith("npx", ["-y", "safe-package"],
      expect.objectContaining({ env: expect.objectContaining({ PATH: "/custom", FOO: "override" }) }),
    );
    expect(statMock).toHaveBeenCalled();
    spawnMock.mockClear();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const connecting = new McpStdioClient(config({ command: "node" })).connect();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;
    expect(spawnMock).toHaveBeenCalledWith("node", ["server.js"], expect.objectContaining({
      env: expect.objectContaining({ PATH: "/missing" }),
    }));
  });

  it("connect 校验 command 并 spawn，initialize 后置 connected", async () => {
    await expect(new McpStdioClient(config({ command: undefined })).connect()).rejects.toThrow(
      "stdio server 缺少 command",
    );

    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());

    const connecting = client.connect();
    expect(spawnMock).toHaveBeenCalledWith(
      "node",
      ["server.js"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );

    // connect 仍在等 initialize 响应
    await Promise.resolve();
    const [init] = written(child);
    expect(init).toMatchObject({ method: "initialize", id: 1 });
    expect(client.isConnected).toBe(false);

    reply(child, { jsonrpc: "2.0", id: init?.id, result: { serverInfo: { name: "fake" } } });
    await connecting;
    expect(client.isConnected).toBe(true);
    // initialized 通知紧随其后
    expect(written(child).some((msg) => msg.method === "notifications/initialized")).toBe(true);
  });

  it("listTools/callTool 走行分隔 JSON-RPC，坏行与跨块行都能处理", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;

    const tools = client.listTools();
    await Promise.resolve();
    const listReq = written(child).find((msg) => msg.method === "tools/list");
    // 坏行直接忽略
    child.stdout.emit("data", "not-json\n");
    // 跨块行：响应切成 3 段再拼回
    reply(child, {
      jsonrpc: "2.0",
      id: listReq?.id,
      result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] },
    }, 3);
    await expect(tools).resolves.toMatchObject([{ name: "ping", serverId: "local" }]);

    const called = client.callTool("ping", { n: 1 });
    await Promise.resolve();
    const callReq = written(child).find((msg) => msg.method === "tools/call");
    expect(callReq).toMatchObject({ params: { name: "ping", arguments: { n: 1 } } });
    reply(child, {
      jsonrpc: "2.0",
      id: callReq?.id,
      result: { content: [{ type: "text", text: "pong" }] },
    });
    await expect(called).resolves.toEqual({ ok: true, text: "pong", error: undefined });
  });

  it("stderr 只缓存诊断；进程退出拒绝挂起请求并断开", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;

    child.stderr.emit("data", "  warn: something  ");
    expect(client.error).toBe("warn: something");

    const pending = client.callTool("ping", {});
    await Promise.resolve();
    child.emit("exit", 0);
    expect(client.isConnected).toBe(false);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MCP server 进程退出");
  });

  it("进程 error 记录错误；shutdown 杀进程，未运行时 sendRaw 抛错", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;

    child.emit("error", new Error("spawn failed"));
    expect(client.error).toBe("spawn failed");

    client.shutdown();
    expect(child.kill).toHaveBeenCalled();
    expect(client.isConnected).toBe(false);

    await expect(client.callTool("ping", {})).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("未运行"),
    });
  });

  it("重复 connect 不会二次 spawn", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const client = new McpStdioClient(config());
    const connecting = client.connect();
    await Promise.resolve();
    reply(child, { jsonrpc: "2.0", id: 1, result: {} });
    await connecting;
    await client.connect();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
