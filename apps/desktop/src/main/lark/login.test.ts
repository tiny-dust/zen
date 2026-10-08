import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LarkLoginEvent } from "@zen/shared";

const { spawnMock, cliState, authState } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  cliState: { path: "/tmp/lark-cli" as string | null },
  authState: {
    snapshot: {
      cliInstalled: true,
      available: true,
      version: null,
      appId: null,
      brand: null,
      botReady: true,
      userOpenId: "ou_1",
      userName: null,
      userAvatarUrl: null,
      error: null,
    } as unknown,
  },
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("./cli", () => ({ resolveLarkCliPath: () => cliState.path }));
vi.mock("./auth", () => ({
  invalidateLarkAuthCache: vi.fn(),
  readLarkAuthSnapshot: vi.fn(async () => authState.snapshot),
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

describe("飞书登录生命周期", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("轮询子进程启动失败时转为登录错误，不让主进程收到未处理 error", async () => {
    const init = fakeChild();
    const poller = fakeChild();
    spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);

    const events: LarkLoginEvent[] = [];
    const { isLarkLoginRunning, startLarkLogin } = await import("./login");
    const login = startLarkLogin((event) => events.push(event));

    init.stdout.emit(
      "data",
      JSON.stringify({
        verification_url: "https://accounts.example.test/device",
        device_code: "device-code",
        expires_in: 600,
      }),
    );
    init.emit("close", 0);
    await login;

    expect(events).toEqual([
      { status: "url", url: "https://accounts.example.test/device", expiresInSeconds: 600 },
    ]);
    expect(isLarkLoginRunning()).toBe(true);

    poller.emit("error", new Error("spawn ENOENT"));

    expect(events).toEqual([
      { status: "url", url: "https://accounts.example.test/device", expiresInSeconds: 600 },
      { status: "error", message: "spawn ENOENT" },
    ]);
    expect(isLarkLoginRunning()).toBe(false);
  });
});

describe("飞书登录分支覆盖", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  async function freshLogin() {
    vi.resetModules();
    return import("./login");
  }

  function okInit(init: FakeChild): void {
    init.stdout.emit(
      "data",
      JSON.stringify({
        verification_url: "https://accounts.example.test/device",
        device_code: "device-code",
        expires_in: 600,
      }),
    );
    init.emit("close", 0);
  }

  it("已有流程在跑时重复发起 → 抛错", async () => {
    const { startLarkLogin, cancelLarkLogin } = await freshLogin();
    const init = fakeChild();
    const poller = fakeChild();
    spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
    const events: LarkLoginEvent[] = [];
    const login = startLarkLogin((event) => events.push(event));
    okInit(init);
    await login;

    await expect(startLarkLogin(() => undefined)).rejects.toThrow("飞书登录已在进行中");
    cancelLarkLogin(() => undefined);
  });

  it("未找到 lark-cli → 直接 error 事件，不 spawn", async () => {
    cliState.path = null;
    try {
      const { startLarkLogin, isLarkLoginRunning } = await freshLogin();
      const events: LarkLoginEvent[] = [];
      await startLarkLogin((event) => events.push(event));
      expect(events).toEqual([
        { status: "error", message: expect.stringContaining("未找到 lark-cli") },
      ]);
      expect(spawnMock).not.toHaveBeenCalled();
      expect(isLarkLoginRunning()).toBe(false);
    } finally {
      cliState.path = "/tmp/lark-cli";
    }
  });

  it("init 失败：JSON error.message → 带原因；纯文本 → 截断提示；空输出 → 兜底文案", async () => {
    // JSON 业务错误（error.message）
    {
      const { startLarkLogin } = await freshLogin();
      const init = fakeChild();
      spawnMock.mockReturnValueOnce(init);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      init.stdout.emit("data", JSON.stringify({ error: { message: "device flow 被禁用" } }));
      init.emit("close", 1);
      await login;
      expect(events[0]).toEqual({
        status: "error",
        message: "lark-cli 登录失败：device flow 被禁用",
      });
    }
    // 纯文本输出（无 JSON）→ 原文截断
    {
      const { startLarkLogin } = await freshLogin();
      const init = fakeChild();
      spawnMock.mockReturnValueOnce(init);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      init.stderr.emit("data", "network unreachable");
      init.emit("close", 2);
      await login;
      expect(events[0]).toEqual({
        status: "error",
        message: "lark-cli 登录失败：network unreachable",
      });
    }
    // 空输出 → 兜底文案
    {
      const { startLarkLogin } = await freshLogin();
      const init = fakeChild();
      spawnMock.mockReturnValueOnce(init);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      init.emit("close", 3);
      await login;
      expect(events[0]).toEqual({
        status: "error",
        message: "lark-cli 发起授权失败，请确认 lark-cli 可用后重试",
      });
    }
  });

  it("init 输出缺 verification_url/device_code → 按失败兜底；expires_in 非数字用 600", async () => {
    {
      const { startLarkLogin } = await freshLogin();
      const init = fakeChild();
      spawnMock.mockReturnValueOnce(init);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      init.stdout.emit("data", JSON.stringify({ verification_url: "https://x/y" }));
      init.emit("close", 0);
      await login;
      expect(events[0]?.status).toBe("error");
    }
    {
      const { startLarkLogin, cancelLarkLogin } = await freshLogin();
      const init = fakeChild();
      const poller = fakeChild();
      spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      init.stdout.emit(
        "data",
        JSON.stringify({
          verification_url: "https://accounts.example.test/device",
          device_code: "device-code",
          expires_in: "soon",
        }),
      );
      init.emit("close", 0);
      await login;
      expect(events[0]).toEqual({
        status: "url",
        url: "https://accounts.example.test/device",
        expiresInSeconds: 600,
      });
      cancelLarkLogin(() => undefined);
    }
  });

  it("init 子进程 error 事件 → 捕获后转登录错误", async () => {
    const { startLarkLogin } = await freshLogin();
    const init = fakeChild();
    spawnMock.mockReturnValueOnce(init);
    const events: LarkLoginEvent[] = [];
    const login = startLarkLogin((event) => events.push(event));
    init.emit("error", new Error("spawn ENOENT"));
    await login;
    expect(events).toEqual([{ status: "error", message: "spawn ENOENT" }]);
  });

  it("轮询成功：close(0) + 取到 open_id → done，并使登录缓存失效", async () => {
    const auth = await import("./auth");
    const { startLarkLogin } = await freshLogin();
    const init = fakeChild();
    const poller = fakeChild();
    spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
    const events: LarkLoginEvent[] = [];
    const login = startLarkLogin((event) => events.push(event));
    okInit(init);
    await login;
    poller.emit("close", 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([
      { status: "url", url: "https://accounts.example.test/device", expiresInSeconds: 600 },
      { status: "done" },
    ]);
    expect(auth.invalidateLarkAuthCache).toHaveBeenCalled();
  });

  it("轮询成功但取不到 open_id → 提示稍后重检", async () => {
    authState.snapshot = {
      cliInstalled: true,
      available: true,
      version: null,
      appId: null,
      brand: null,
      botReady: true,
      userOpenId: null,
      userName: null,
      userAvatarUrl: null,
      error: null,
    };
    try {
      const { startLarkLogin } = await freshLogin();
      const init = fakeChild();
      const poller = fakeChild();
      spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      okInit(init);
      await login;
      poller.emit("close", 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events[1]).toEqual({
        status: "error",
        message: "授权已完成，但未取到飞书身份，请稍后在设置中重新检测",
      });
    } finally {
      authState.snapshot = {
        cliInstalled: true,
        available: true,
        version: null,
        appId: null,
        brand: null,
        botReady: true,
        userOpenId: "ou_1",
        userName: null,
        userAvatarUrl: null,
        error: null,
      };
    }
  });

  it("轮询非 0 退出 → error（JSON message / 兜底）；被取消后 close 静默", async () => {
    // JSON message
    {
      const { startLarkLogin } = await freshLogin();
      const init = fakeChild();
      const poller = fakeChild();
      spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
      const events: LarkLoginEvent[] = [];
      const login = startLarkLogin((event) => events.push(event));
      okInit(init);
      await login;
      poller.stdout.emit("data", JSON.stringify({ error: { message: "授权被拒绝" } }));
      poller.emit("close", 2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events[1]).toEqual({
        status: "error",
        message: "lark-cli 登录失败：授权被拒绝",
      });
    }
    // 取消后 close 静默
    {
      const { startLarkLogin, cancelLarkLogin, isLarkLoginRunning } = await freshLogin();
      const init = fakeChild();
      const poller = fakeChild();
      spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
      const events: LarkLoginEvent[] = [];
      const emit = (event: LarkLoginEvent) => events.push(event);
      const login = startLarkLogin(emit);
      okInit(init);
      await login;
      cancelLarkLogin(emit);
      expect(poller.kill).toHaveBeenCalled();
      expect(events[1]).toEqual({ status: "cancelled" });
      expect(isLarkLoginRunning()).toBe(false);
      poller.emit("close", 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // 取消后不再追加事件
      expect(events).toHaveLength(2);
    }
  });

  it("超时 → 杀掉轮询并报授权超时", async () => {
    vi.useFakeTimers();
    const { startLarkLogin } = await freshLogin();
    const init = fakeChild();
    const poller = fakeChild();
    spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
    const events: LarkLoginEvent[] = [];
    const login = startLarkLogin((event) => events.push(event));
    okInit(init);
    await login;
    // expires_in=600 → 630s 后超时
    vi.advanceTimersByTime(630_000);
    expect(poller.kill).toHaveBeenCalled();
    expect(events[1]).toEqual({ status: "error", message: "授权超时，请重新发起飞书登录" });
  });

  it("cancelLarkLogin 无流程时静默；shutdownLarkLogin 杀进程不广播", async () => {
    const { cancelLarkLogin, shutdownLarkLogin, startLarkLogin } = await freshLogin();
    cancelLarkLogin(() => {
      throw new Error("不应广播");
    });
    shutdownLarkLogin();

    const init = fakeChild();
    const poller = fakeChild();
    spawnMock.mockReturnValueOnce(init).mockReturnValueOnce(poller);
    const events: LarkLoginEvent[] = [];
    const login = startLarkLogin((event) => events.push(event));
    okInit(init);
    await login;
    shutdownLarkLogin();
    expect(poller.kill).toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });
});
