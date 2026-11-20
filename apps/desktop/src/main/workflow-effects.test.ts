import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = { root: "" };

vi.mock("./workspace-db", () => ({ getSession: () => undefined, getWorkspace: () => undefined }));
vi.mock("./session-worktree", () => ({ resolveSessionWorktreeRoot: async () => null }));
vi.mock("./mcp-ipc", () => ({ enabledMcpTools: async () => [] }));
vi.mock("./zen-dir", () => ({
  sessionCacheDir: () => state.root,
  loadAgentSettings: async () => ({ sandboxMode: "off" }),
}));

import { createWorkflowEffectRunner, interpolateOutputs } from "./workflow-effects";

beforeAll(async () => {
  state.root = await mkdtemp(join(tmpdir(), "zen-workflow-effects-"));
  await writeFile(join(state.root, "note.txt"), "hello from workspace", "utf8");
});

afterAll(async () => {
  await rm(state.root, { recursive: true, force: true });
});

const noOutput = () => undefined;

describe("workflow effects", () => {
  it("substitutes known $nodeId outputs and leaves unknown tokens untouched", () => {
    const resolve = (id: string) => (id === "plan" ? "PLAN" : undefined);
    expect(interpolateOutputs('{"task": "$plan", "keep": "$missing"}', resolve)).toBe('{"task": "PLAN", "keep": "$missing"}');
  });

  it("runs a shell script in the chat workspace and caps failure to an error", async () => {
    const runner = await createWorkflowEffectRunner("session-effects");
    expect(runner.workspaceRoot).toBe(state.root);
    const signal = new AbortController().signal;

    await expect(runner.run({
      type: "script", setting: { script: "echo hello", runtime: "shell" }, resolve: noOutput, signal, timeoutMs: 10_000,
    })).resolves.toBe("hello");

    await expect(runner.run({
      type: "script", setting: { script: "echo boom 1>&2; exit 3", runtime: "shell" }, resolve: noOutput, signal, timeoutMs: 10_000,
    })).rejects.toThrow(/Script exited with 3/);
  });

  it("executes a built-in tool with JSON input taken from the workspace", async () => {
    const runner = await createWorkflowEffectRunner("session-effects");
    const output = await runner.run({
      type: "tool",
      setting: { toolName: "readFile", toolInput: '{ "path": "note.txt" }' },
      resolve: noOutput,
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    expect(output).toContain("hello from workspace");
    await expect(runner.run({
      type: "tool", setting: { toolName: "readFile", toolInput: "{ not json" }, resolve: noOutput, signal: new AbortController().signal, timeoutMs: 10_000,
    })).rejects.toThrow(/not valid JSON/);
    await expect(runner.run({
      type: "tool", setting: { toolName: "noSuchTool" }, resolve: noOutput, signal: new AbortController().signal, timeoutMs: 10_000,
    })).rejects.toThrow(/Unknown tool/);
  });

  it("sends HTTP requests, forwards headers and $nodeId values, and rejects non-2xx", async () => {
    let seenHeader = "";
    const server = createServer((request, response) => {
      seenHeader = String(request.headers["x-token"] ?? "");
      if (request.url === "/fail") {
        response.statusCode = 500;
        response.end("boom");
        return;
      }
      response.setHeader("content-type", "text/plain");
      response.end(request.method === "POST" ? "created" : "ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const runner = await createWorkflowEffectRunner("session-effects");
    const signal = new AbortController().signal;
    try {
      await expect(runner.run({
        type: "http",
        setting: { url: `http://127.0.0.1:${port}/ok`, method: "POST", headers: "X-Token: $plan", body: "payload" },
        resolve: (id) => (id === "plan" ? "secret" : undefined),
        signal,
        timeoutMs: 10_000,
      })).resolves.toBe("created");
      expect(seenHeader).toBe("secret");
      await expect(runner.run({
        type: "http", setting: { url: `http://127.0.0.1:${port}/fail` }, resolve: noOutput, signal, timeoutMs: 10_000,
      })).rejects.toThrow(/HTTP 500/);
      await expect(runner.run({
        type: "http", setting: { url: "file:///etc/passwd" }, resolve: noOutput, signal, timeoutMs: 10_000,
      })).rejects.toThrow(/Unsupported HTTP protocol|Invalid URL/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("lists tool names without executing anything", async () => {
    const runner = await createWorkflowEffectRunner("session-effects");
    const tools = await runner.listTools();
    expect(tools.map((tool) => tool.name)).toContain("readFile");
  });
});
