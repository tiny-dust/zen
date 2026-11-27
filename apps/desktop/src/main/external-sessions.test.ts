import { describe, expect, it } from "vitest";

import {
  readBounded,
  parseClaudeSession,
  parseCodexSession,
  parseDshSession,
  parseGeminiSession,
  parseGrokSession,
  parseJsonl,
  resolveClientRoots,
} from "./external-sessions";

/**
 * 五种客户端各用一段「按真实格式手写」的样本喂解析器：
 * 只断言能从结构里稳定读出的字段，避免把猜测写进测试。
 */

const CLAUDE_SAMPLE = [
  '{"type":"summary","summary":"修复登录跳转","sessionId":"c-1","cwd":"/repo/app"}',
  '{"type":"user","sessionId":"c-1","cwd":"/repo/app","timestamp":"2026-01-02T03:04:05.000Z","message":{"role":"user","content":[{"type":"text","text":"登录后跳回首页"}]}}',
  '{"type":"assistant","sessionId":"c-1","timestamp":"2026-01-02T03:04:06.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"先看路由"},{"type":"text","text":"我来查路由表"},{"type":"tool_use","name":"Read","input":{"path":"router.ts"}}]}}',
  '{"type":"user","sessionId":"c-1","timestamp":"2026-01-02T03:04:07.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01abc","content":[{"type":"text","text":"router.ts 内容"}]}]}}',
  '{"type":"result","sessionId":"c-1","timestamp":"2026-01-02T03:04:08.000Z","result":"已修复","is_error":false}',
  "not-json-line",
].join("\n");

const CODEX_SAMPLE = [
  '{"type":"session_meta","payload":{"id":"x-1","cwd":"/repo/api","model":"gpt-5"}}',
  '{"type":"event_msg","timestamp":"2026-01-02T03:00:00.000Z","payload":{"type":"user_message","message":"给接口加限流"}}',
  '{"type":"response_item","timestamp":"2026-01-02T03:00:01.000Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"先看现有中间件"}]}}',
  '{"type":"response_item","timestamp":"2026-01-02T03:00:02.000Z","payload":{"type":"function_call","name":"shell"}}',
  '{"type":"response_item","timestamp":"2026-01-02T03:00:03.000Z","payload":{"type":"function_call_output","output":"ok"}}',
  '{"type":"event_msg","timestamp":"2026-01-02T03:00:04.000Z","payload":{"type":"task_complete","last_agent_message":"已加上限流"}}',
].join("\n");

const GEMINI_SAMPLE = JSON.stringify({
  sessionId: "g-1",
  cwd: "/repo/web",
  summary: "调整首页布局",
  messages: [
    { type: "user", content: "<session_context>环境说明</session_context>", timestamp: "2026-01-02T02:00:00.000Z" },
    { type: "user", content: "首页太挤", timestamp: "2026-01-02T02:00:01.000Z" },
    {
      type: "gemini",
      content: "我把间距调大",
      timestamp: "2026-01-02T02:00:02.000Z",
      toolCalls: [{ name: "read_file", result: "ok" }],
    },
  ],
});

const DSH_SAMPLE = [
  '{"type":"session/title","time":1767312000000,"data":{"title":"梳理发布流程"}}',
  '{"type":"user/message","time":1767312001000,"data":{"cwd":"/repo/ops","content":[{"type":"text","text":"发布步骤记一下"}]}}',
  '{"type":"assistant/message","time":1767312002000,"data":{"content":"先打包再灰度"}}',
  '{"type":"tool/run","time":1767312003000,"data":{"name":"shell"}}',
  '{"type":"turn/end","time":1767312004000,"data":{"reason":"done"}}',
].join("\n");

const GROK_SAMPLE = [
  '{"params":{"update":{"sessionUpdate":"session_info_update","title":"补单元测试","sessionId":"k-1","cwd":"/repo/lib"}}}',
  '{"params":{"update":{"sessionUpdate":"user_message_chunk","content":[{"type":"text","text":"给解析器补测试"}]}},"timestamp":1767312000000}',
  '{"params":{"update":{"sessionUpdate":"agent_thought_chunk","content":[{"type":"text","text":"先列边界"}]}},"timestamp":1767312001000}',
  '{"params":{"update":{"sessionUpdate":"tool_call","title":"Write","toolName":"write"}},"timestamp":1767312002000}',
  '{"params":{"update":{"sessionUpdate":"agent_message_chunk","content":[{"type":"text","text":"三个测试已加"}]}},"timestamp":1767312003000}',
  '{"params":{"update":{"sessionUpdate":"turn_completed"}},"timestamp":1767312004000}',
].join("\n");

describe("JSONL 容错", () => {
  it("坏行跳过、非对象行忽略", () => {
    const lines = parseJsonl('{"a":1}\n[1,2]\n{bad}\n\n{"b":2}');
    expect(lines).toHaveLength(2);
  });
});

describe("Claude Code 会话", () => {
  const parsed = parseClaudeSession(CLAUDE_SAMPLE);

  it("读出会话 id / 目录 / 标题（优先客户端标题）", () => {
    expect(parsed.sessionId).toBe("c-1");
    expect(parsed.cwd).toBe("/repo/app");
    expect(parsed.title).toBe("修复登录跳转");
  });

  it("区分用户、助手、思考、工具、结果", () => {
    // 同一条 assistant 消息里思考/工具先出、正文后出（解析按块类型分两轮，不改变整体时序）
    expect(parsed.events.map((e) => e.kind)).toEqual([
      "user",
      "thinking",
      "tool",
      "assistant",
      "result",
      "result",
    ]);
    expect(parsed.events.find((e) => e.kind === "tool")?.toolName).toBe("Read");
    expect(parsed.events.at(-1)?.text).toBe("已修复");
  });
});

describe("Codex 会话", () => {
  const parsed = parseCodexSession(CODEX_SAMPLE);

  it("从 session_meta / user_message 取元信息", () => {
    expect(parsed.sessionId).toBe("x-1");
    expect(parsed.cwd).toBe("/repo/api");
    expect(parsed.title).toBe("给接口加限流");
  });

  it("事件按类型落到对应行", () => {
    expect(parsed.events.map((e) => e.kind)).toEqual(["user", "assistant", "tool", "result", "result"]);
  });
});

describe("Gemini CLI 会话", () => {
  const parsed = parseGeminiSession(GEMINI_SAMPLE);

  it("跳过 <session_context> 占位，取真实首条用户消息", () => {
    expect(parsed.sessionId).toBe("g-1");
    expect(parsed.title).toBe("调整首页布局");
    expect(parsed.events.filter((e) => e.kind === "user")).toHaveLength(1);
  });

  it("toolCalls 展开成工具行 + 结果行", () => {
    const kinds = parsed.events.map((e) => e.kind);
    expect(kinds).toContain("assistant");
    expect(kinds).toContain("tool");
    expect(kinds).toContain("result");
  });
});

describe("DSH 会话", () => {
  const parsed = parseDshSession(DSH_SAMPLE);

  it("读标题与目录，识别一轮结束", () => {
    expect(parsed.sessionId).toBe("");
    expect(parsed.title).toBe("梳理发布流程");
    expect(parsed.cwd).toBe("/repo/ops");
    expect(parsed.events.map((e) => e.kind)).toEqual(["user", "assistant", "tool", "result"]);
  });
});

describe("Grok 会话", () => {
  const parsed = parseGrokSession(GROK_SAMPLE);

  it("按 sessionUpdate 分流", () => {
    expect(parsed.sessionId).toBe("k-1");
    expect(parsed.title).toBe("补单元测试");
    expect(parsed.events.map((e) => e.kind)).toEqual([
      "user",
      "thinking",
      "tool",
      "assistant",
      "result",
    ]);
  });
});

describe("会话目录解析（三平台）", () => {
  it("macOS / Linux 用 HOME，尊重 DSH_HOME 与 GROK_HOME", () => {
    const roots = resolveClientRoots("/Users/me", { DSH_HOME: "/opt/dsh" }, "darwin");
    expect(roots.claude).toBe("/Users/me/.claude/projects");
    expect(roots.codex).toBe("/Users/me/.codex/sessions");
    expect(roots.gemini).toBe("/Users/me/.gemini/tmp");
    expect(roots.dsh).toBe("/opt/dsh/sessions");
    expect(roots.grok).toBe("/Users/me/.grok/sessions");
  });

  it("Windows 用 USERPROFILE，路径分段为反斜杠", () => {
    const roots = resolveClientRoots("C:/Users/me", { USERPROFILE: "C:\\Users\\me" }, "win32");
    expect(roots.claude).toContain("Users");
    expect(roots.claude).toContain("projects");
    expect(roots.codex).toContain("sessions");
  });
});

describe("读取上限", () => {
  it("超过上限只读前 N 字节，退回整行并标截断", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "zen-ext-"));
    const file = join(dir, "big.jsonl");
    const line = '{"type":"user","message":{"content":"x"}}';
    await writeFile(file, Array.from({ length: 500 }, () => line).join("\n"));
    try {
      const { text, truncated } = await readBounded(file, 200);
      expect(truncated).toBe(true);
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(200);
      // 截断后退回最后一个换行，不留半截 JSON 行
      expect(text.endsWith(line)).toBe(true);
      const lines = text.split("\n");
      expect(lines.every((item) => item === line)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("未超限时完整读，不标截断", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "zen-ext-"));
    const file = join(dir, "small.jsonl");
    await writeFile(file, '{"a":1}\n{"b":2}');
    try {
      const { text, truncated } = await readBounded(file, 1024);
      expect(truncated).toBe(false);
      expect(text).toBe('{"a":1}\n{"b":2}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
