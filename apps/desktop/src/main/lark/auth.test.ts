import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cliPath: "/tmp/lark-cli" as string | null,
  /** 按 execFile 参数路由的返回值 */
  handlers: [] as Array<(args: string[]) => { stdout?: string; stderr?: string } | Error>,
  calls: [] as string[][],
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    callback: (err: Error | null, value?: { stdout: string; stderr: string }) => void,
  ) => {
    state.calls.push(args);
    // 按调用顺序路由（探测顺序固定：auth status → --version → contact）
    const key = args.slice(0, 2).join(" ");
    const route = state.handlers.shift();
    if (!route) {
      callback(new Error(`未预期的 execFile 调用：${key}`));
      return;
    }
    const result = route(args);
    if (result instanceof Error) {
      callback(result);
      return;
    }
    callback(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  },
}));

vi.mock("./cli", () => ({
  resolveLarkCliPath: () => state.cliPath,
}));

type AuthModule = typeof import("./auth");

async function freshAuth(): Promise<AuthModule> {
  vi.resetModules();
  return import("./auth");
}

function ok(stdout: string): (args: string[]) => { stdout: string } {
  return () => ({ stdout });
}

beforeEach(() => {
  state.cliPath = "/tmp/lark-cli";
  state.handlers = [];
  state.calls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("readLarkAuthSnapshot 基础探测", () => {
  it("未找到 lark-cli → available:false + 安装提示，不发起子进程", async () => {
    state.cliPath = null;
    const auth = await freshAuth();
    const snapshot = await auth.readLarkAuthSnapshot();
    expect(snapshot.available).toBe(false);
    expect(snapshot.cliInstalled).toBe(false);
    expect(snapshot.error).toContain("npm install -g @larksuite/cli");
    expect(state.calls).toHaveLength(0);
  });

  it("auth status 执行失败 → cliInstalled:true + 失败原因", async () => {
    state.handlers = [() => new Error("spawn ENOENT")];
    const auth = await freshAuth();
    const snapshot = await auth.readLarkAuthSnapshot();
    expect(snapshot.available).toBe(false);
    expect(snapshot.cliInstalled).toBe(true);
    expect(snapshot.error).toContain("lark-cli auth status 失败");
    expect(snapshot.error).toContain("spawn ENOENT");
  });

  it("auth status 输出非 JSON → 同样按失败兜底", async () => {
    state.handlers = [ok("not-json-at-all")];
    const auth = await freshAuth();
    const snapshot = await auth.readLarkAuthSnapshot();
    expect(snapshot.available).toBe(false);
    expect(snapshot.error).toContain("lark-cli auth status 失败");
  });

  it("已登录：botReady 只认显式 true，字段宽松解析，userName 用资料兜底", async () => {
    state.handlers = [
      ok(
        JSON.stringify({
          appId: 123,
          brand: "lark",
          identities: {
            bot: { status: "ready", available: "true" },
            user: { status: "active", available: true, openId: "ou_1", userName: "兜底名" },
          },
        }),
      ),
      ok("lark-cli 1.2.3\n"),
      ok(JSON.stringify({ data: { user: { name: "张三", avatar_url: "https://a/x.png" } } })),
    ];
    const auth = await freshAuth();
    const snapshot = await auth.readLarkAuthSnapshot();
    expect(snapshot).toMatchObject({
      cliInstalled: true,
      available: true,
      version: "lark-cli 1.2.3",
      appId: null,
      brand: "lark",
      botReady: false,
      userOpenId: "ou_1",
      userName: "张三",
      userAvatarUrl: "https://a/x.png",
      error: null,
    });
  });

  it("bot.available 显式 true → botReady；未登录时不探资料", async () => {
    state.handlers = [
      ok(JSON.stringify({ appId: "app", identities: { bot: { available: true }, user: {} } })),
      ok(""),
    ];
    const auth = await freshAuth();
    const snapshot = await auth.readLarkAuthSnapshot();
    expect(snapshot.botReady).toBe(true);
    expect(snapshot.userOpenId).toBeNull();
    expect(snapshot.userName).toBeNull();
    // 仅 auth status + --version 两次
    expect(state.calls.map((args) => args[0])).toEqual(["auth", "--version"]);
  });

  it("资料探测失败 → 姓名/头像降级 null 且不阻塞；失败不缓存，下次重试", async () => {
    state.handlers = [
      ok(JSON.stringify({ identities: { user: { openId: "ou_2", userName: "兜底" } } })),
      ok(""),
      () => new Error("contact 失败"),
    ];
    const auth = await freshAuth();
    const first = await auth.readLarkAuthSnapshot();
    expect(first.userName).toBe("兜底");
    expect(first.userAvatarUrl).toBeNull();

    // invalidate 后重探：资料失败未缓存，会再打 contact
    state.handlers = [
      ok(JSON.stringify({ identities: { user: { openId: "ou_2", userName: "兜底" } } })),
      ok(""),
      ok(JSON.stringify({ data: { user: { name: "新名字" } } })),
    ];
    auth.invalidateLarkAuthCache();
    const second = await auth.readLarkAuthSnapshot();
    expect(second.userName).toBe("新名字");
  });

  it("资料缓存按 open_id 复用：短时间内同 open_id 不再拉 contact", async () => {
    state.handlers = [
      ok(JSON.stringify({ identities: { user: { openId: "ou_3" } } })),
      ok(""),
      ok(JSON.stringify({ data: { user: { name: "N", avatar_url: "u" } } })),
    ];
    const auth = await freshAuth();
    await auth.readLarkAuthSnapshot();
    const contactCalls = state.calls.filter((args) => args[0] === "contact");
    expect(contactCalls).toHaveLength(1);

    state.handlers = [
      ok(JSON.stringify({ identities: { user: { openId: "ou_3" } } })),
      ok(""),
    ];
    auth.invalidateLarkAuthCache();
    const again = await auth.readLarkAuthSnapshot();
    expect(again.userName).toBe("N");
    // 没有多余的 contact 调用
    expect(state.calls.filter((args) => args[0] === "contact")).toHaveLength(1);
  });
});

describe("readLarkAuthSnapshot 缓存与去重", () => {
  it("TTL 内二次读取直接走缓存，不重复探测", async () => {
    state.handlers = [ok(JSON.stringify({})), ok("")];
    const auth = await freshAuth();
    await auth.readLarkAuthSnapshot();
    const before = state.calls.length;
    await auth.readLarkAuthSnapshot();
    expect(state.calls.length).toBe(before);
  });

  it("invalidateLarkAuthCache 后强制重新探测", async () => {
    state.handlers = [ok(JSON.stringify({})), ok("")];
    const auth = await freshAuth();
    await auth.readLarkAuthSnapshot();
    const before = state.calls.length;
    state.handlers = [ok(JSON.stringify({})), ok("")];
    auth.invalidateLarkAuthCache();
    await auth.readLarkAuthSnapshot();
    expect(state.calls.length).toBeGreaterThan(before);
  });

  it("并发调用共享同一 inflight 探测（只拉一次子进程）", async () => {
    state.handlers = [ok(JSON.stringify({})), ok("")];
    const auth = await freshAuth();
    const [a, b] = await Promise.all([auth.readLarkAuthSnapshot(), auth.readLarkAuthSnapshot()]);
    expect(a).toEqual(b);
    expect(state.calls).toHaveLength(2);
  });
});

describe("peekLarkAuthSnapshot", () => {
  it("未探测过 → unavailable + 尚未探测提示", async () => {
    const auth = await freshAuth();
    const peeked = auth.peekLarkAuthSnapshot();
    expect(peeked.available).toBe(false);
    expect(peeked.error).toBe("尚未探测 lark-cli 登录态");
  });

  it("探测后返回最近一次快照，不触发子进程", async () => {
    state.handlers = [ok(JSON.stringify({})), ok("")];
    const auth = await freshAuth();
    const snapshot = await auth.readLarkAuthSnapshot();
    const before = state.calls.length;
    expect(auth.peekLarkAuthSnapshot()).toEqual(snapshot);
    expect(state.calls.length).toBe(before);
  });
});
