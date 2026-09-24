import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LarkLoginEvent } from "@zen/shared";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("./cli", () => ({ resolveLarkCliPath: () => "/tmp/lark-cli" }));
vi.mock("./auth", () => ({
  invalidateLarkAuthCache: vi.fn(),
  readLarkAuthSnapshot: vi.fn(),
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
