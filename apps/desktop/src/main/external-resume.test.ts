import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  ExternalAgentClient,
  ExternalClientCapability,
  ExternalRunEvent,
  ExternalSessionSummary,
} from "@zen/shared";

import {
  buildResumeArgs,
  detectExternalCapabilities,
  sendExternalMessage,
  stopExternalRun,
  type ExternalSendResult,
} from "./external-resume";
import { attachResumability } from "./external-sessions";

/**
 * 续聊能力与运行生命周期：全部用临时目录里的假 CLI，不碰真实厂商会话文件。
 */

const root = mkdtempSync(join(tmpdir(), "zen-external-resume-"));
const binDir = join(root, "bin");
const legacyBinDir = join(root, "bin-legacy-gemini");
const emptyBinDir = join(root, "bin-empty");
const longBinDir = join(root, "bin-long");
const failBinDir = join(root, "bin-fail");
const silentBinDir = join(root, "bin-silent");
for (const dir of [binDir, legacyBinDir, emptyBinDir, longBinDir, failBinDir, silentBinDir]) {
  mkdirSync(dir, { recursive: true });
}

/** 假 CLI：把收到的参数逐行打印（用来验证配方与「不经过 shell」） */
const ECHO_SCRIPT = ["#!/bin/sh", 'for arg in "$@"; do printf "%s\\n" "$arg"; done'].join("\n");

/** gemini 的 --help 输出决定是否支持续聊 */
function geminiScript(helpSupportsResume: boolean): string {
  const help = helpSupportsResume
    ? ['  echo "  --resume <session>  Resume a session"']
    : ['  echo "  --model <name>  Pick a model"'];
  return ["#!/bin/sh", 'if [ "$1" = "--help" ]; then', '  echo "Usage: gemini [options]"', ...help, "  exit 0", "fi", ...ECHO_SCRIPT.split("\n").slice(1)].join("\n");
}

function writeCli(dir: string, name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

const callsLog = join(binDir, "calls.log");
for (const name of ["claude", "codex", "dsh", "grok"]) {
  writeCli(binDir, name, ECHO_SCRIPT);
}
writeCli(
  binDir,
  "gemini",
  geminiScript(true).replace('  exit 0', `  printf "probe\\n" >> "${callsLog}"\n  exit 0`),
);
writeCli(legacyBinDir, "gemini", geminiScript(false));

/** 长跑 CLI：先打印一行，然后一直不退出，用来测并发与停止 */
writeCli(longBinDir, "claude", ["#!/bin/sh", 'echo "running"', "sleep 30"].join("\n"));
/** 非零退出 + stderr：用来测失败事件里的错误尾巴 */
writeCli(failBinDir, "claude", ["#!/bin/sh", 'echo "boom" >&2', "exit 3"].join("\n"));
/** 完全不输出的 CLI：模拟「装上了但非交互模式没反应」（需要登录 / 只能交互用） */
writeCli(silentBinDir, "claude", ["#!/bin/sh", "sleep 30"].join("\n"));

function session(
  client: ExternalAgentClient,
  sessionId: string,
  extra: Partial<ExternalSessionSummary> = {},
): ExternalSessionSummary {
  return {
    id: `${client}:${sessionId}`,
    client,
    sessionId,
    title: `${client} 会话`,
    cwd: root,
    updatedAt: Date.now(),
    status: "unverified",
    eventCount: 0,
    path: join(root, "session.jsonl"),
    ...extra,
  };
}

function capability(
  client: ExternalAgentClient,
  path: string | null,
  resume: ExternalClientCapability["resume"] = "supported",
  note?: string,
): ExternalClientCapability {
  return { client, command: client, path, resume, ...(note ? { note } : {}) };
}

function waitForTerminal(events: ExternalRunEvent[], timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (events.some((event) => event.type === "done" || event.type === "error" || event.type === "stopped")) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`等待终止事件超时，已收到：${events.map((event) => event.type).join(",")}`));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function deltaText(events: ExternalRunEvent[]): string {
  return events
    .filter((event) => event.type === "delta")
    .map((event) => event.text ?? "")
    .join("");
}

describe("能力探测", () => {
  it("五个客户端各一条，只有 claude / codex / gemini 标注 supported", async () => {
    const capabilities = await detectExternalCapabilities({ pathEnv: binDir, fresh: true });
    expect(capabilities.map((item) => item.client)).toEqual(["claude", "codex", "gemini", "dsh", "grok"]);

    const byClient = new Map(capabilities.map((item) => [item.client, item]));
    expect(byClient.get("claude")?.resume).toBe("supported");
    expect(byClient.get("claude")?.path).toBe(join(binDir, "claude"));
    expect(byClient.get("codex")?.resume).toBe("supported");
    // gemini 靠 --help 里出现 --resume 才认
    expect(byClient.get("gemini")?.resume).toBe("supported");
    expect(byClient.get("dsh")?.resume).toBe("unsupported");
    expect(byClient.get("dsh")?.note).toContain("暂不支持用会话 ID 续聊");
    expect(byClient.get("grok")?.resume).toBe("unsupported");
  });

  it("gemini --help 没有 --resume 时按不支持处理", async () => {
    const capabilities = await detectExternalCapabilities({ pathEnv: legacyBinDir, fresh: true });
    const gemini = capabilities.find((item) => item.client === "gemini");
    expect(gemini?.resume).toBe("unsupported");
    expect(gemini?.note).toContain("--resume");
  });

  it("PATH 里找不到命令时标 missing-cli 并说明未安装", async () => {
    const capabilities = await detectExternalCapabilities({ pathEnv: emptyBinDir, fresh: true });
    expect(capabilities.every((item) => item.resume === "missing-cli")).toBe(true);
    expect(capabilities.every((item) => item.path === null)).toBe(true);
    expect(capabilities.find((item) => item.client === "codex")?.note).toContain("codex");
  });

  it("同一 PATH 的探测结果有缓存，不重复起子进程", async () => {
    const calls = () => {
      try {
        return readFileSync(callsLog, "utf8").split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    };
    await detectExternalCapabilities({ pathEnv: binDir, fresh: true });
    const afterFirst = calls();
    await detectExternalCapabilities({ pathEnv: binDir });
    expect(calls()).toBe(afterFirst);
    await detectExternalCapabilities({ pathEnv: binDir, fresh: true });
    expect(calls()).toBe(afterFirst + 1);
  });
});

describe("续聊配方", () => {
  it("只有三条已核实的配方，其余客户端不给参数", () => {
    expect(buildResumeArgs("claude", "c-1", "hi")).toEqual([
      "--resume",
      "c-1",
      "-p",
      "hi",
      "--output-format",
      "text",
    ]);
    expect(buildResumeArgs("codex", "x-1", "hi")).toEqual(["exec", "resume", "x-1", "hi"]);
    expect(buildResumeArgs("gemini", "g-1", "hi")).toEqual(["--resume", "g-1", "-p", "hi"]);
    expect(buildResumeArgs("dsh", "d-1", "hi")).toBeNull();
    expect(buildResumeArgs("grok", "k-1", "hi")).toBeNull();
  });

  it.each([
    ["claude", "c-1", ["--resume", "c-1", "-p", 'hi there "quoted" ; rm -rf /', "--output-format", "text"]],
    ["codex", "x-1", ["exec", "resume", "x-1", 'hi there "quoted" ; rm -rf /']],
    ["gemini", "g-1", ["--resume", "g-1", "-p", 'hi there "quoted" ; rm -rf /']],
  ] as const)("%s 按配方原样传参（不经 shell，消息保持单个参数）", async (client, sessionId, args) => {
    const events: ExternalRunEvent[] = [];
    const message = 'hi there "quoted" ; rm -rf /';
    const result = await sendExternalMessage({ id: `${client}:${sessionId}`, message }, (event) => events.push(event), {
      capabilities: [capability(client, join(binDir, client))],
      findSession: async () => session(client, sessionId),
    });
    expect("runId" in result).toBe(true);

    await waitForTerminal(events);
    expect(events[0]?.type).toBe("started");
    expect(events.at(-1)?.type).toBe("done");
    // 假 CLI 逐行回显收到的 argv：顺序一致、消息没被拆成多段
    expect(deltaText(events).split("\n").filter(Boolean)).toEqual([...args]);
  });
});

describe("send 的拦截", () => {
  const deps = { findSession: async () => session("claude", "c-1") };

  it("缺 CLI 时返回 blocked=missing-cli，不起进程", async () => {
    const events: ExternalRunEvent[] = [];
    const result = await sendExternalMessage(
      { id: "claude:c-1", message: "hi" },
      (event) => events.push(event),
      { pathEnv: emptyBinDir, ...deps },
    );
    expect(result).toMatchObject({ blocked: "missing-cli" });
    expect(events).toHaveLength(0);
  });

  it("未核实续聊参数的客户端返回 blocked=unsupported", async () => {
    const result = await sendExternalMessage(
      { id: "dsh:d-1", message: "hi" },
      () => undefined,
      {
        capabilities: [capability("dsh", join(binDir, "dsh"), "unsupported", "暂不支持用会话 ID 续聊")],
        findSession: async () => session("dsh", "d-1"),
      },
    );
    expect(result).toMatchObject({ blocked: "unsupported" });
  });

  it("会话不在本地扫描结果里、sessionId 格式非法都返回 blocked=unknown-session", async () => {
    const missing = await sendExternalMessage({ id: "claude:nope", message: "hi" }, () => undefined, {
      capabilities: [capability("claude", join(binDir, "claude"))],
      findSession: async () => null,
    });
    expect(missing).toMatchObject({ blocked: "unknown-session" });

    const unsafe = await sendExternalMessage({ id: "claude:c-1", message: "hi" }, () => undefined, {
      capabilities: [capability("claude", join(binDir, "claude"))],
      findSession: async () => session("claude", "../../etc/passwd"),
    });
    expect(unsafe).toMatchObject({ blocked: "unknown-session" });
  });

  it("空消息与超长消息被拒，且不起进程", async () => {
    const empty = await sendExternalMessage({ id: "claude:c-1", message: "   " }, () => undefined, deps);
    expect(empty).toHaveProperty("error");

    const tooLong = await sendExternalMessage({ id: "claude:c-1", message: "x".repeat(20001) }, () => undefined, deps);
    expect(tooLong).toHaveProperty("error");
  });

  it("入参不是对象也不抛错", async () => {
    const result = await sendExternalMessage("nonsense", () => undefined, deps);
    expect(result).toMatchObject({ blocked: "unknown-session" });
  });
});

describe("运行生命周期", () => {
  it.skipIf(process.platform === "win32")("同一会话并发 send 被拒，stop 后广播 stopped 且不再补 error", async () => {
    const events: ExternalRunEvent[] = [];
    const broadcast = (event: ExternalRunEvent) => events.push(event);
    const deps = {
      capabilities: [capability("claude", join(longBinDir, "claude"))],
      findSession: async () => session("claude", "long-1"),
    };

    const first = await sendExternalMessage({ id: "claude:long-1", message: "hi" }, broadcast, deps);
    expect("runId" in first).toBe(true);

    const second = await sendExternalMessage({ id: "claude:long-1", message: "hi" }, broadcast, deps);
    expect(second).toMatchObject({ error: "该会话正在运行" });

    const runId = "runId" in first ? first.runId : "";
    expect(stopExternalRun(runId, broadcast)).toBe(true);
    expect(events.some((event) => event.type === "stopped" && event.runId === runId)).toBe(true);

    await waitForTerminal(events);
    // 停止是用户主动行为，不再补一条 error
    expect(events.some((event) => event.type === "error")).toBe(false);

    // 进程真正退出后登记表被清理：同一会话可以再次发起
    const deadline = Date.now() + 5000;
    let again: ExternalSendResult | null = null;
    while (!again && Date.now() < deadline) {
      const attempt = await sendExternalMessage({ id: "claude:long-1", message: "hi" }, () => undefined, deps);
      if ("runId" in attempt) {
        again = attempt;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(again).not.toBeNull();
    if (again && "runId" in again) {
      stopExternalRun(again.runId, () => undefined);
    }
  });

  it("重复 stop / 未知 runId 都是 no-op", () => {
    expect(stopExternalRun("not-a-run", () => undefined)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("没有输出时看门狗报错并停掉进程，不无限转圈", async () => {
    const events: ExternalRunEvent[] = [];
    const deps = {
      capabilities: [capability("claude", join(silentBinDir, "claude"))],
      findSession: async () => session("claude", "silent-1"),
      firstOutputMs: 150,
    };

    const started = await sendExternalMessage(
      { id: "claude:silent-1", message: "hi" },
      (event) => events.push(event),
      deps,
    );
    expect("runId" in started).toBe(true);

    await waitForTerminal(events);
    const error = events.find((event) => event.type === "error");
    expect(error?.error).toContain("没有响应");

    // 登记表已清理：同一会话可以再次发起（说明进程被真正停掉）。
    // 进程被 kill 到退出事件之间有几毫秒，最多等 1s 再判失败。
    let again: Awaited<ReturnType<typeof sendExternalMessage>> | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      again = await sendExternalMessage(
        { id: "claude:silent-1", message: "hi" },
        () => undefined,
        deps,
      );
      if ("runId" in again) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(again && "runId" in again).toBe(true);
    if (again && "runId" in again) {
      stopExternalRun(again.runId, () => undefined);
    }
  });

  it("非零退出广播 error，并带上 stderr 尾巴", async () => {
    const events: ExternalRunEvent[] = [];
    const result = await sendExternalMessage({ id: "claude:fail-1", message: "hi" }, (event) => events.push(event), {
      capabilities: [capability("claude", join(failBinDir, "claude"))],
      findSession: async () => session("claude", "fail-1"),
    });
    expect("runId" in result).toBe(true);

    await waitForTerminal(events);
    const failure = events.find((event) => event.type === "error");
    expect(failure?.error).toContain("boom");
  });

  it("cwd 解析不出时回落到用户主目录（不会因 cwd 失败）", async () => {
    const events: ExternalRunEvent[] = [];
    const result = await sendExternalMessage({ id: "codex:x-9", message: "hi" }, (event) => events.push(event), {
      capabilities: [capability("codex", join(binDir, "codex"))],
      findSession: async () => session("codex", "x-9", { cwd: undefined }),
    });
    expect("runId" in result).toBe(true);
    await waitForTerminal(events);
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("列表续聊标记", () => {
  it("按客户端能力标注 resumable，并给出被拦原因", () => {
    const items = attachResumability(
      [session("claude", "c-1"), session("dsh", "d-1"), session("codex", "bad/id")],
      [
        capability("claude", "/bin/claude"),
        capability("dsh", "/bin/dsh", "unsupported"),
        capability("codex", "/bin/codex"),
        capability("gemini", null, "missing-cli"),
      ],
    );
    expect(items[0]).toMatchObject({ resumable: true });
    expect(items[1]).toMatchObject({ resumable: false, resumeBlocked: "unsupported" });
    // 支持的客户端但会话 id 不安全：当作不可续聊
    expect(items[2]).toMatchObject({ resumable: false, resumeBlocked: "unknown-session" });
  });
});
