import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ErrorReportRecord } from "@zen/shared";

const state = vi.hoisted(() => ({
  root: "",
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  broadcasts: [] as Array<[string, unknown]>,
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0-test" },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      state.handlers.set(channel, fn);
    },
  },
}));

// 默认存储路径（~/.zen/error-reports.json）指到临时目录，保证 IPC 用例不写真实用户目录
vi.mock("./zen-dir", () => ({
  zenRoot: () => state.root,
}));

import {
  analyzeErrorReport,
  clearErrorReports,
  listErrorReports,
  recordErrorReport,
  registerErrorReportsIpc,
} from "./error-reports";

let file: string;

beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), "zen-error-reports-"));
  state.handlers.clear();
  state.broadcasts.length = 0;
  file = join(state.root, "error-reports.json");
});

const APP_STACK = [
  "Error: boom",
  "    at foo (/Applications/Zen.app/Contents/Resources/app.asar/dist/main/index.js:1:1)",
].join("\n");

function record(overrides: Partial<ErrorReportRecord> = {}): ErrorReportRecord {
  return {
    id: "r-1",
    source: "main",
    kind: "uncaught",
    message: "boom",
    firstSeenAt: 1,
    lastSeenAt: 1,
    count: 1,
    ...overrides,
  };
}

describe("recordErrorReport 存储与去重", () => {
  it("同 kind+消息+应用帧累计 count 并更新 lastSeenAt，不新增记录", async () => {
    const first = await recordErrorReport("main", "uncaught", "boom", APP_STACK, file);
    const second = await recordErrorReport("main", "uncaught", "boom", APP_STACK, file);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    const list = await listErrorReports(file);
    expect(list).toHaveLength(1);
    expect(list[0]?.count).toBe(2);
    expect(list[0]?.lastSeenAt).toBeGreaterThanOrEqual(list[0]?.firstSeenAt ?? 0);
  });

  it("不同 kind 同消息不合并；无应用帧时仍按消息去重", async () => {
    await recordErrorReport("main", "uncaught", "boom", undefined, file);
    await recordErrorReport("main", "unhandled", "boom", undefined, file);
    await recordErrorReport("main", "unhandled", "boom", undefined, file);

    const list = await listErrorReports(file);
    expect(list).toHaveLength(2);
    expect(list.find((item) => item.kind === "unhandled")?.count).toBe(2);
  });

  it("消息截断 500、堆栈截断 4000", async () => {
    const longMessage = "x".repeat(600);
    const longStack = "y".repeat(4500);
    await recordErrorReport("renderer", "window-error", longMessage, longStack, file);

    const [item] = await listErrorReports(file);
    expect(item?.message).toHaveLength(500);
    expect(item?.stack).toHaveLength(4000);
  });

  it("上限 200 条：超限淘汰 lastSeenAt 最旧记录", async () => {
    for (let i = 0; i < 202; i++) {
      await recordErrorReport("main", "uncaught", `错误 #${i}`, undefined, file);
    }
    const list = await listErrorReports(file);
    expect(list).toHaveLength(200);
    // 最新的保留、最早的（#0/#1）被淘汰
    expect(list.some((item) => item.message === "错误 #201")).toBe(true);
    expect(list.some((item) => item.message === "错误 #0")).toBe(false);
    expect(list.some((item) => item.message === "错误 #1")).toBe(false);
    // 排序：最新 lastSeenAt 在前
    const first = list[0]?.message;
    expect(first).toBe("错误 #201");
  });
});

describe("clearErrorReports", () => {
  it("无 ids 清空全部；按 ids 删除保留其余", async () => {
    const a = await recordErrorReport("main", "uncaught", "a", undefined, file);
    const b = await recordErrorReport("main", "uncaught", "b", undefined, file);

    const partial = await clearErrorReports([a.record.id], file);
    expect(partial.removed).toBe(1);
    expect((await listErrorReports(file)).map((item) => item.message)).toEqual(["b"]);

    const all = await clearErrorReports(undefined, file);
    expect(all.removed).toBe(1);
    expect(await listErrorReports(file)).toEqual([]);
  });
});

describe("analyzeErrorReport 启发式判定", () => {
  it("堆栈命中应用代码帧 → 软件相关 high", () => {
    const result = analyzeErrorReport(record({ message: "boom", stack: APP_STACK }));
    expect(result.softwareRelated).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.reason).toContain("应用代码帧");
  });

  it("dev 渲染层堆栈（localhost /src/ 与 .vue 帧）→ 软件相关 high", () => {
    const devStack =
      "TypeError: Cannot read properties of undefined (reading 'items')\n" +
      "    at http://localhost:5183/src/stores/errors.ts:42:17\n" +
      "    at http://localhost:5183/src/components/right/ErrorsPanel.vue:88:9";
    const result = analyzeErrorReport(record({ message: "TypeError: Cannot read properties of undefined", stack: devStack }));
    expect(result.softwareRelated).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.reason).toContain("应用代码帧");
  });

  it("消息为典型代码缺陷（无栈）→ 软件相关 high", () => {
    const result = analyzeErrorReport(record({ message: "x.y is not a function" }));
    expect(result.softwareRelated).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("网络错误（ECONNREFUSED/fetch failed/DNS）→ 环境 high", () => {
    for (const message of [
      "connect ECONNREFUSED 127.0.0.1:5432",
      "fetch failed",
      "getaddrinfo ENOTFOUND api.example.com",
    ]) {
      const result = analyzeErrorReport(record({ message, stack: APP_STACK }));
      expect(result.softwareRelated).toBe(false);
      expect(result.confidence).toBe("high");
      expect(result.reason).toContain("网络");
    }
  });

  it("spawn ENOENT → 命令不存在；文件 ENOENT → 路径不存在", () => {
    const spawn = analyzeErrorReport(record({ message: "spawn foo ENOENT" }));
    expect(spawn.softwareRelated).toBe(false);
    expect(spawn.confidence).toBe("high");
    expect(spawn.reason).toContain("command not found");

    const file = analyzeErrorReport(record({ message: "ENOENT: no such file or directory, open '/tmp/x'" }));
    expect(file.reason).toContain("不存在");
  });

  it("EACCES/EPERM 与磁盘空间 → 环境 high", () => {
    const perm = analyzeErrorReport(record({ message: "EACCES: permission denied" }));
    expect(perm.softwareRelated).toBe(false);
    expect(perm.confidence).toBe("high");

    const space = analyzeErrorReport(record({ message: "ENOSPC: no space left on device" }));
    expect(space.softwareRelated).toBe(false);
    expect(space.reason).toContain("磁盘");
  });

  it("Electron 生命周期噪声（clean-exit/destroyed/GPU）→ 非软件 low", () => {
    for (const message of [
      "渲染进程异常退出: clean-exit (exitCode=0)",
      "Object has been destroyed",
      "GPU 进程异常退出",
    ]) {
      const result = analyzeErrorReport(record({ message }));
      expect(result.softwareRelated).toBe(false);
      expect(result.confidence).toBe("low");
      expect(result.reason).toContain("噪声");
    }
  });

  it("无栈且无特征 → unknown low", () => {
    const result = analyzeErrorReport(record({ message: "某个奇怪的错误" }));
    expect(result).toEqual({
      softwareRelated: false,
      confidence: "low",
      reason: "信息不足，无法判定是否与软件相关",
    });
  });
});

describe("registerErrorReportsIpc", () => {
  beforeEach(() => {
    registerErrorReportsIpc((channel, payload) => {
      state.broadcasts.push([channel, payload]);
    });
  });

  function handler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
    const fn = state.handlers.get(channel);
    expect(fn, `未注册 IPC 通道 ${channel}`).toBeTruthy();
    return fn as (event: unknown, ...args: unknown[]) => unknown;
  }

  it("errors:report 合法载荷 → 记录 source=renderer 并广播 changed", async () => {
    const result = await handler("errors:report")(null, {
      kind: "window-error",
      message: "渲染层炸了",
      stack: APP_STACK,
    });
    expect(result).toEqual({ ok: true });
    expect(state.broadcasts.at(-1)).toEqual(["errors:changed", null]);

    const list = (await handler("errors:list")(null)) as ErrorReportRecord[];
    expect(list[0]?.source).toBe("renderer");
    expect(list[0]?.kind).toBe("window-error");
  });

  it("errors:report 非法载荷（kind 白名单外/空消息/非对象）→ {ok:false} 不落库", async () => {
    await expect(handler("errors:report")(null, { kind: "hacker", message: "x" })).resolves.toMatchObject({ ok: false });
    await expect(handler("errors:report")(null, { kind: "uncaught", message: "  " })).resolves.toMatchObject({ ok: false });
    await expect(handler("errors:report")(null, "not-an-object")).resolves.toMatchObject({ ok: false });

    expect(await handler("errors:list")(null)).toEqual([]);
  });

  it("errors:analyze 按 id 分析；不存在返回 null", async () => {
    const created = await recordErrorReport("renderer", "vue", "x is not a function", undefined, file);
    const analysis = (await handler("errors:analyze")(null, created.record.id)) as {
      softwareRelated: boolean;
      reason: string;
    };
    expect(analysis.softwareRelated).toBe(true);
    expect(analysis.reason).toContain("代码缺陷");
    expect(await handler("errors:analyze")(null, "ghost")).toBeNull();
  });

  it("errors:clear 非法 ids 拒绝；合法清空并广播", async () => {
    const created = await recordErrorReport("main", "uncaught", "a", undefined, file);
    await expect(handler("errors:clear")(null, "not-an-array")).resolves.toMatchObject({ ok: false });
    await expect(handler("errors:clear")(null, [123])).resolves.toMatchObject({ ok: false });

    const result = await handler("errors:clear")(null, [created.record.id]);
    expect(result).toMatchObject({ ok: true, removed: 1 });
    expect(state.broadcasts.at(-1)).toEqual(["errors:changed", null]);
    expect(await handler("errors:list")(null)).toEqual([]);
  });
});
