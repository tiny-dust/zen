import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent, BrowserAgentBridge } from "@zen/shared";

import { buildToolSet } from "./agent-tools";
import type { ToolHooks } from "./agent-tools";
import type { AgentSessionConfig } from "./agent-config";
import { registerMcpRuntime } from "./mcp-runtime";
import { ResourceLock } from "./resource-lock";

/**
 * 工具集行为回归（直接驱动 tool.execute）：
 * - fs 工具在工作区内读写/编辑/列目录/搜索
 * - runTerminal 输出拼接（stdout + [stderr]）、失败退出码、超时、abort、tool_progress、servicesBridge
 * - askUser / updateTasks / webSearch / loadSkill / updateMemory 事件与结果
 * - browser.* 走 browserBridge；mcp.* 走延迟注册的 MCP 运行时
 */

type Exec = (
  input: unknown,
  options: { toolCallId: string; messages: []; abortSignal?: AbortSignal },
) => Promise<unknown>;

function execTool(
  tool: unknown,
  input: unknown,
  options: Partial<Parameters<Exec>[1]> = {},
): Promise<unknown> {
  const fn = (tool as { execute?: Exec }).execute;
  if (!fn) {
    throw new Error("tool has no execute");
  }
  return fn(input, { toolCallId: "tc-1", messages: [], ...options });
}

let workspaceRoot = "";
const events: AgentStreamEvent[] = [];
const emit = (event: AgentStreamEvent) => {
  events.push(event);
};

function config(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    sessionId: "sess-tools",
    workspaceRoot,
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:9",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
    emit,
    ...overrides,
  };
}

const noopHooks: ToolHooks = {
  waitForUserAnswer: async () => "ok",
  emitAskEvent: () => {},
  emitAskResolved: () => {},
};

function build(overrides: Partial<AgentSessionConfig> = {}, hooks: ToolHooks = noopHooks) {
  return buildToolSet(workspaceRoot, emit, "sess-tools", config(overrides), hooks);
}

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "zen-tools-"));
  writeFileSync(join(workspaceRoot, "readme.txt"), "hello workspace");
  mkdirSync(join(workspaceRoot, "sub"));
  writeFileSync(join(workspaceRoot, "sub", "a.txt"), "aaa");
});

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

afterEach(() => {
  events.length = 0;
  vi.unstubAllGlobals();
});

describe("fs 工具", () => {
  it("readFile / writeFile / editFile / listDir / searchFiles", async () => {
    const tools = build();

    await expect(execTool(tools.readFile, { path: "readme.txt" })).resolves.toBe("hello workspace");

    const written = (await execTool(tools.writeFile, {
      path: "new.txt",
      content: "content-1",
    })) as { path: string; content: string };
    expect(written.path).toContain("new.txt");
    expect(written.content).toBe("content-1");

    const edited = (await execTool(tools.editFile, {
      path: "new.txt",
      oldString: "content-1",
      newString: "content-2",
    })) as { replacements: number };
    expect(edited.replacements).toBe(1);
    await expect(execTool(tools.readFile, { path: "new.txt" })).resolves.toBe("content-2");

    const listing = (await execTool(tools.listDir, {})) as string;
    expect(listing).toContain("d sub");
    expect(listing).toContain("- new.txt");
    const subListing = (await execTool(tools.listDir, { path: "sub" })) as string;
    expect(subListing).toBe("- a.txt");

    const byName = (await execTool(tools.searchFiles, {
      query: "new.txt",
      mode: "name",
    })) as string;
    expect(byName).toContain("new.txt");
    const byContent = (await execTool(tools.searchFiles, {
      query: "content-2",
      mode: "content",
    })) as string;
    expect(byContent).toContain("new.txt:1:");
    await expect(
      execTool(tools.searchFiles, { query: "nothing-matches-xyz", mode: "content" }),
    ).resolves.toBe("no matches");
  });

  it("editFile 未命中 oldString 抛错", async () => {
    const tools = build();
    await expect(
      execTool(tools.editFile, {
        path: "readme.txt",
        oldString: "missing",
        newString: "x",
      }),
    ).rejects.toThrow(/oldString not found/);
  });
});

describe("runTerminal", () => {
  it("成功执行返回 stdout，失败拼接 [stderr] 并标记 ok=false", async () => {
    const tools = build();
    const ok = (await execTool(tools.runTerminal, { command: "echo hi" })) as {
      ok: boolean;
      output: string;
    };
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain("hi");

    const failed = (await execTool(tools.runTerminal, {
      command: "printf failure >&2; exit 7",
    })) as { ok: boolean; exitCode: number; output: string };
    expect(failed.ok).toBe(false);
    expect(failed.exitCode).toBe(7);
    expect(failed.output).toContain("[stderr]");
    expect(failed.output).toContain("failure");
  });

  it("超时杀进程返回失败，abort 立即中断", async () => {
    const tools = build();
    const timedOut = (await execTool(tools.runTerminal, {
      command: "sleep 5",
      timeoutMs: 50,
    })) as { ok: boolean };
    expect(timedOut.ok).toBe(false);

    const controller = new AbortController();
    const running = execTool(
      tools.runTerminal,
      { command: "sleep 5" },
      { abortSignal: controller.signal },
    );
    setTimeout(() => controller.abort(), 30);
    const aborted = (await running) as { ok: boolean; output: string };
    expect(aborted.ok).toBe(false);
    expect(aborted.output).toBe("已中断（暂停或取消）");
  });

  it("推送 tool_progress 并登记 servicesBridge", async () => {
    const tracked: Array<{ pid: number }> = [];
    const settled: number[] = [];
    const tools = build({
      servicesBridge: {
        track: (request) => tracked.push({ pid: request.pid }),
        settle: (pid) => settled.push(pid),
      },
    });

    const result = (await execTool(tools.runTerminal, { command: "echo progress" })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(true);
    const progress = events.find((event) => event.type === "tool_progress");
    expect(progress).toBeTruthy();
    expect(tracked).toHaveLength(1);
    expect(settled).toEqual(tracked.map((item) => item.pid));
  });
});

describe("askUser / updateTasks / webSearch / loadSkill / updateMemory", () => {
  it("askUser 挂起等待并回发 ask_resolved", async () => {
    const asked: string[] = [];
    const resolved: string[] = [];
    const hooks: ToolHooks = {
      waitForUserAnswer: async () => "用户答复",
      // 与 AgentSession 的接线一致：ask 事件经 emit 上抛 UI
      emitAskEvent: (question) => {
        asked.push(question.question);
        emit({ type: "ask_user", sessionId: "sess-tools", question });
      },
      emitAskResolved: (askId, toolCallId, answer) => resolved.push(`${askId}:${answer}`),
    };
    const tools = build({}, hooks);

    const result = (await execTool(tools.askUser, {
      question: "选哪个？",
      options: ["A", "B", "C", "D", "E", "F", "G"],
      multiSelect: true,
      allowFreeText: false,
    })) as { answer: string };

    expect(result.answer).toBe("用户答复");
    expect(asked).toEqual(["选哪个？"]);
    expect(resolved[0]).toContain(":用户答复");
    const askEvent = events.find((event) => event.type === "ask_user");
    expect(askEvent).toBeTruthy();
    if (askEvent?.type === "ask_user") {
      // 超过 6 个的预设选项被裁剪
      expect(askEvent.question.options).toHaveLength(6);
      expect(askEvent.question.multiSelect).toBe(true);
      expect(askEvent.question.allowFreeText).toBe(false);
    }
  });

  it("updateTasks 用 version 哨兵表达开新版/更新当前版", async () => {
    const tools = build();
    await execTool(tools.updateTasks, {
      startNew: true,
      tasks: [{ id: "t1", label: "a", done: false }],
    });
    await execTool(tools.updateTasks, {
      tasks: [{ id: "t1", label: "a", done: true }],
    });

    const updates = events.filter((event) => event.type === "tasks_updated");
    expect(updates.map((event) => (event.type === "tasks_updated" ? event.version : null))).toEqual([
      -1, 0,
    ]);
  });

  it("webSearch 发出 reference_found 并返回结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          '<a class="result__a" href="https://ref.test/1">Ref One</a>',
      })),
    );
    const tools = build();

    const result = (await execTool(tools.webSearch, { query: "ref" })) as {
      results: Array<{ title: string; url: string }>;
    };
    expect(result.results).toEqual([{ title: "Ref One", url: "https://ref.test/1" }]);
    const found = events.find((event) => event.type === "reference_found");
    expect(found).toBeTruthy();
    if (found?.type === "reference_found") {
      expect(found.reference.source).toBe("web");
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => "<html></html>" })),
    );
    await expect(execTool(tools.webSearch, { query: "none" })).resolves.toEqual({
      query: "none",
      results: [],
      note: "no results",
    });
  });

  it("loadSkill 读取技能全文，未找到抛错", async () => {
    const skillRoot = mkdtempSync(join(tmpdir(), "zen-skills-"));
    const skillDir = join(skillRoot, "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: demo\ndescription: demo skill\n---\n\n技能正文",
    );
    const tools = build({ skillExtraPaths: [skillRoot] });

    try {
      await expect(execTool(tools.loadSkill, { skillId: skillDir })).resolves.toEqual({
        name: "demo",
        body: "技能正文",
      });
      await expect(execTool(tools.loadSkill, { skillId: "no-such-skill-xyz" })).rejects.toThrow(
        /skill not found or not allowed/,
      );
    } finally {
      rmSync(skillRoot, { recursive: true, force: true });
    }
  });

  it("updateMemory 落盘成功返回 ok，失败抛错", async () => {
    const notes: string[] = [];
    const okTools = build({
      memoryBridge: {
        appendNote: async (scope, text) => {
          notes.push(`${scope}:${text}`);
          return { ok: true };
        },
      },
    });
    await expect(
      execTool(okTools.updateMemory, { scope: "device", text: "记住这个" }),
    ).resolves.toEqual({ ok: true });
    expect(notes).toEqual(["device:记住这个"]);

    const failTools = build({
      memoryBridge: { appendNote: async () => ({ ok: false, error: "磁盘只读" }) },
    });
    await expect(
      execTool(failTools.updateMemory, { scope: "user", text: "x" }),
    ).rejects.toThrow("磁盘只读");
  });
});

describe("browser / mcp 工具桥接", () => {
  it("browser.* 走 browserBridge，独占类经资源锁", async () => {
    const calls: string[] = [];
    const bridge: BrowserAgentBridge = {
      status: async () => {
        calls.push("status");
        return { url: "https://x.test", title: "t" } as never;
      },
      ensureRunning: async () => ({}) as never,
      open: async (url) => {
        calls.push(`open:${url}`);
        return { ok: true, url, title: "t" };
      },
      snapshot: async () => ({
        url: "https://x.test",
        title: "Page",
        text: "body text",
        links: [{ text: "L", href: "https://x.test/l" }],
        a11y: null,
        outline: "main",
      }),
      extract: async () => ({
        url: "https://x.test",
        title: "Page",
        text: "body text",
        links: [],
        inputs: [
          { selector: "#i", tag: "input", type: "text", name: "n", placeholder: "p", label: "" },
        ],
        buttons: [{ selector: "#b", text: "Go", disabled: false }],
      }),
      click: async (selector) => {
        calls.push(`click:${selector}`);
        return { ok: true };
      },
      type: async (selector, text) => {
        calls.push(`type:${selector}:${text}`);
        return { ok: true };
      },
      console: async () => ({ entries: [{ level: "error", text: "boom", url: "u", line: 3, ts: 1 }] }),
      performance: async () => ({ metrics: { Nodes: 5 } }),
      screenshot: async () => ({ ok: true, path: "/tmp/shot.png" }),
      evaluate: async (expression) => ({ ok: true, value: expression }),
    };
    const tools = build({ browserBridge: bridge });

    expect(await execTool(tools.browserStatus, {})).toMatchObject({ url: "https://x.test" });
    await execTool(tools.browserOpen, { url: "https://open.test" });
    expect(await execTool(tools.browserSnapshot, {})).toContain("body text");
    expect(await execTool(tools.browserExtract, {})).toContain("#b :: Go");
    await execTool(tools.browserClick, { selector: "#b" });
    await execTool(tools.browserType, { selector: "#i", text: "hi", submit: true });
    expect(await execTool(tools.browserConsole, { limit: 5 })).toContain("[error] boom");
    expect(await execTool(tools.browserPerformance, {})).toContain("Nodes=5");
    expect(await execTool(tools.browserScreenshot, {})).toEqual({
      ok: true,
      path: "/tmp/shot.png",
    });
    expect(await execTool(tools.browserEvaluate, { expression: "1+1" })).toEqual({
      ok: true,
      value: "1+1",
    });
    expect(calls).toEqual([
      "status",
      "open:https://open.test",
      "click:#b",
      "type:#i:hi",
    ]);
  });

  it("未注入 browserBridge 时没有 browser.* 工具", () => {
    const tools = build();
    expect(tools.browserStatus).toBeUndefined();
    expect(tools.browserOpen).toBeUndefined();
  });

  it("mcp.<server>.<tool> 延迟调用 MCP 运行时，失败抛错", async () => {
    registerMcpRuntime(async () => ({
      callMcpTool: async (serverName, toolName) =>
        serverName === "lark" && toolName === "ok"
          ? { ok: true, text: "mcp-done" }
          : { ok: false, text: "", error: "mcp 失败" },
    }));
    const tools = build({
      mcpTools: [
        { serverName: "lark", name: "ok", inputSchema: { type: "object", properties: {} } },
        { serverName: "lark", name: "bad", inputSchema: { type: "object", properties: {} } },
      ],
    });

    expect(tools["mcp.lark.ok"]).toBeTruthy();
    await expect(execTool(tools["mcp.lark.ok"], { a: 1 })).resolves.toBe("mcp-done");
    await expect(execTool(tools["mcp.lark.bad"], {})).rejects.toThrow("mcp 失败");
  });

  it("multiAgentTools 并入工具集", () => {
    const lock = new ResourceLock();
    const tools = buildToolSet(
      workspaceRoot,
      emit,
      "sess-tools",
      config(),
      noopHooks,
      {
        resourceLock: lock,
        ownerLabel: "agent-1",
        multiAgentTools: {
          spawnAgent: { description: "d", inputSchema: {}, execute: async () => "spawned" },
        } as never,
      },
    );
    expect(tools.spawnAgent).toBeTruthy();
  });
});
