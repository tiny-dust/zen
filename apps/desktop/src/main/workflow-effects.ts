import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { buildToolSet, ResourceLock } from "@zen/agent-core";
import { resolveDefaultShell } from "@zen/tools-terminal";

import type { AgentSessionConfig } from "@zen/agent-core";

type ToolSet = ReturnType<typeof buildToolSet>;

import { enabledMcpTools } from "./mcp-ipc";
import { resolveWorkspaceDir } from "./sandbox";
import { resolveSessionWorktreeRoot } from "./session-worktree";
import { getSession, getWorkspace } from "./workspace-db";
import { loadAgentSettings, sessionCacheDir } from "./zen-dir";

/** 节点输出与脚本输出统一上限：落库与回灌给模型都不应该无界 */
const MAX_EFFECT_OUTPUT_CHARS = 20_000;
/** 单次外部操作的等待上限（仍受运行时限约束，取二者较小值） */
export const MAX_EFFECT_TIMEOUT_MS = 120_000;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export type WorkflowEffectSetting = {
  toolName?: string;
  toolInput?: string;
  script?: string;
  runtime?: "shell" | "node";
  url?: string;
  method?: string;
  headers?: string;
  body?: string;
};

/** `$node-id` 取该节点最新输出；没有输出时保留原样，避免静默丢内容 */
export type ResolveOutput = (nodeId: string) => string | undefined;

export function interpolateOutputs(value: string, resolve: ResolveOutput): string {
  return value.replace(/\$([A-Za-z0-9_-]{1,128})/g, (token, nodeId: string) => resolve(nodeId) ?? token);
}

function capOutput(value: string): string {
  if (value.length <= MAX_EFFECT_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_EFFECT_OUTPUT_CHARS)}\n\n[输出已截断：原始 ${value.length} 字符]`;
}

function outputText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function interpolateJson(value: unknown, resolve: ResolveOutput): unknown {
  if (typeof value === "string") return interpolateOutputs(value, resolve);
  if (Array.isArray(value)) return value.map((item) => interpolateJson(item, resolve));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolateJson(item, resolve)]));
  }
  return value;
}

/** 工作区根目录与 agent run 一致：会话工作树优先，其次沙箱目录；无项目会话落会话缓存目录 */
export async function resolveWorkflowWorkspaceRoot(sessionId: string): Promise<string> {
  const workspaceId = getSession(sessionId)?.session.workspaceId;
  const projectPath = getWorkspace(workspaceId)?.path;
  if (!projectPath) {
    const dir = sessionCacheDir(sessionId);
    await mkdir(dir, { recursive: true });
    return dir;
  }
  const worktree = await resolveSessionWorktreeRoot(sessionId, projectPath);
  if (worktree) return worktree;
  const settings = await loadAgentSettings();
  return (await resolveWorkspaceDir(projectPath, settings.sandboxMode)).dir;
}

async function createToolSet(sessionId: string, workspaceRoot: string): Promise<ToolSet> {
  const mcpTools = await enabledMcpTools().catch(() => []);
  const config: AgentSessionConfig = {
    sessionId,
    workspaceRoot,
    // 工具集不读模型字段；给占位值避免把模型调用链路带进工作流
    protocol: "openai-chat",
    baseUrl: "",
    apiKey: "",
    model: "",
    permissionMode: "full",
    emit: () => undefined,
    mcpTools,
  };
  return buildToolSet(
    workspaceRoot,
    () => undefined,
    sessionId,
    config,
    {
      // 工作流是无人值守的：需要人回答的步骤请用「审批」节点，而不是工具反问
      waitForUserAnswer: async () => {
        throw new Error("Workflow runs cannot ask the user; add an Approval node instead");
      },
      emitAskEvent: () => undefined,
      emitAskResolved: () => undefined,
    },
    { resourceLock: new ResourceLock(), ownerLabel: `workflow:${sessionId}` },
  );
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index <= 0) throw new Error(`Invalid HTTP header line: ${trimmed}`);
    headers[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return headers;
}

/** 脚本在会话工作区里执行；运行时可选平台 shell 或 Electron 内置 Node */
function runScript(
  script: string,
  runtime: "shell" | "node",
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const shell = resolveDefaultShell();
  // Windows 的 cmd 需要 /d /s /c；PowerShell 用户可在脚本里自行切换
  const command = runtime === "node"
    ? { file: process.execPath, args: ["-e", script] }
    : process.platform === "win32"
      ? { file: shell.path, args: [...shell.args, "/d", "/s", "/c", script] }
      : { file: shell.path, args: [...shell.args, "-c", script] };
  const env = runtime === "node"
    ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    : process.env;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command.file, command.args, { cwd, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(capOutput(stdout.trim() || stderr.trim()));
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(new Error("Script cancelled or wall-time budget expired"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Script timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_EFFECT_OUTPUT_CHARS) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_EFFECT_OUTPUT_CHARS) stderr += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signalName) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(`Script exited with ${code ?? signalName}: ${(stderr || stdout).trim().slice(0, 2_000) || "no output"}`));
    });
  });
}

/** 边读边截断：避免超大响应先整体进内存（上限的 2 倍即停） */
async function readCappedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > MAX_EFFECT_OUTPUT_CHARS * 2) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return capOutput(text);
}

async function runHttp(
  request: { url: string; method: string; headers: string | undefined; body: string | undefined },
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const url = new URL(request.url.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported HTTP protocol: ${url.protocol}`);
  const method = (request.method ?? "GET").toUpperCase();
  if (!HTTP_METHODS.includes(method)) throw new Error(`Unsupported HTTP method: ${method}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method,
      headers: parseHeaders(request.headers),
      body: request.body && method !== "GET" && method !== "HEAD" ? request.body : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await readCappedText(response);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 2_000)}`);
    return text;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

export type WorkflowEffectRunner = {
  workspaceRoot: string;
  listTools: () => Promise<Array<{ name: string; description: string }>>;
  run: (options: {
    type: "tool" | "script" | "http";
    setting: WorkflowEffectSetting;
    resolve: ResolveOutput;
    signal: AbortSignal;
    timeoutMs: number;
  }) => Promise<string>;
};

/** 一次运行共用一套工具集：MCP 枚举只做一次，独占工具串行化 */
export async function createWorkflowEffectRunner(sessionId: string): Promise<WorkflowEffectRunner> {
  const workspaceRoot = await resolveWorkflowWorkspaceRoot(sessionId);
  let toolSetPromise: Promise<ToolSet> | null = null;
  const loadToolSet = () => (toolSetPromise ??= createToolSet(sessionId, workspaceRoot));
  return {
    workspaceRoot,
    async listTools() {
      const toolSet = await loadToolSet();
      return toolEntries(toolSet);
    },
    async run({ type, setting, resolve, signal, timeoutMs }) {
      const timeout = Math.max(1_000, Math.min(timeoutMs, MAX_EFFECT_TIMEOUT_MS));
      if (type === "tool") {
        const name = setting.toolName?.trim() ?? "";
        const toolSet = await loadToolSet();
        const item = toolSet[name] as { execute?: (input: unknown, options: unknown) => Promise<unknown> } | undefined;
        if (!item?.execute) throw new Error(`Unknown tool: ${name || "(none)"}`);
        const raw = setting.toolInput?.trim();
        let input: unknown = {};
        if (raw) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            throw new Error(`Tool input is not valid JSON: ${name}`);
          }
          input = interpolateJson(parsed, resolve);
        }
        return capOutput(outputText(await item.execute(input, { abortSignal: signal, toolCallId: `workflow:${name}` })));
      }
      if (type === "script") {
        const script = setting.script?.trim();
        if (!script) throw new Error("Missing script");
        return await runScript(interpolateOutputs(script, resolve), setting.runtime ?? "shell", workspaceRoot, signal, timeout);
      }
      const url = setting.url?.trim();
      if (!url) throw new Error("Missing HTTP url");
      return await runHttp(
        {
          url: interpolateOutputs(url, resolve),
          method: setting.method ?? "GET",
          headers: setting.headers ? interpolateOutputs(setting.headers, resolve) : undefined,
          body: setting.body ? interpolateOutputs(setting.body, resolve) : undefined,
        },
        signal,
        timeout,
      );
    },
  };
}

/** 工具节点可选项：内置工具 + 已启用 MCP 工具（只列举名字，不解析工作区、不执行） */
export async function listWorkflowTools(sessionId: string): Promise<Array<{ name: string; description: string }>> {
  return toolEntries(await createToolSet(sessionId, sessionCacheDir(sessionId)));
}

function toolEntries(toolSet: ToolSet): Array<{ name: string; description: string }> {
  return Object.entries(toolSet as Record<string, { description?: unknown }>).map(([name, item]) => ({
    name,
    description: typeof item.description === "string" ? item.description : "",
  }));
}
