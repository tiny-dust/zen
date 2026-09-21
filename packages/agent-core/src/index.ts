import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isStepCount, jsonSchema, tool, ToolLoopAgent } from "ai";
import { exec } from "node:child_process";
import { z } from "zod";

import { readSkillById } from "@zen/skills";
import {
  formatConsoleForPrompt,
  formatExtractForPrompt,
  formatPerformanceForPrompt,
  formatSnapshotForPrompt,
} from "@zen/tools-browser";
import {
  editWorkspaceFile,
  listWorkspaceDir,
  readWorkspaceFile,
  searchWorkspaceFiles,
  writeWorkspaceFile,
} from "@zen/tools-fs";

import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type {
  AgentDoneReason,
  AgentStreamEvent,
  AskUserQuestionEvent,
  BrowserAgentBridge,
  ChatTurn,
  PermissionMode,
  ProviderProtocol,
  ReasoningEffort,
  ReferenceItem,
  TaskItem,
  ToolApprovalDecision,
  ToolCallState,
  ToolRisk,
} from "@zen/shared";

import {
  MultiAgentOrchestrator,
  ResourceLock,
  multiAgentInstructions,
  subAgentInstructions,
} from "./multi-agent";

export * from "./multi-agent";

const MOCK_REPLY_PREFIX =
  "【Mock Agent】已收到你的消息。后续将接入 AI SDK ToolLoopAgent，完成「改文件 → 跑测试 → commit」闭环。\n\n你刚才说：";

export async function runMockAgent(
  sessionId: string,
  userMessage: string,
  signal: AbortSignal,
  emit: (event: AgentStreamEvent) => void,
): Promise<void> {
  if (signal.aborted) {
    emit({ type: "done", sessionId, reason: "cancelled" });
    return;
  }

  emit({ type: "status", sessionId, status: "thinking" });
  const text = `${MOCK_REPLY_PREFIX}${userMessage}`;
  for (const char of text) {
    if (signal.aborted) {
      emit({ type: "done", sessionId, reason: "cancelled" });
      return;
    }
    emit({ type: "delta", sessionId, text: char });
    await delayMs(16);
  }

  emit({ type: "done", sessionId, reason: "stop" });
}

async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentSkillHint {
  id: string;
  name: string;
  description: string;
}

/** MCP 工具桥接描述（main 侧由 McpToolInfo + server 配置转换而来） */
export interface McpToolBridge {
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentSessionConfig {
  sessionId: string;
  workspaceRoot: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  /** 权限模式（ADR-004）：default / smart / full */
  permissionMode: PermissionMode;
  /** 系统提示词全文（设置页选择的预设或自定义） */
  systemPrompt?: string;
  /** 技能清单提示（loadSkill 可取全文） */
  skills?: AgentSkillHint[];
  /** loadSkill 校验用：与设置页一致的技能搜索路径 */
  skillExtraPaths?: string[];
  /** 已启用 MCP server 的工具（动态桥接为 mcp.<server>.<tool>） */
  mcpTools?: McpToolBridge[];
  /** 内嵌 WebContentsView + CDP 浏览器桥（desktop 注入；缺省时不注册 browser.* 工具） */
  browserBridge?: BrowserAgentBridge;
  /** 是否启用多 Agent 协作工具（spawnAgent 等）；子 Agent 应为 false */
  multiAgent?: boolean;
  emit: (event: AgentStreamEvent) => void;
}

/* ------------------------------------------------------------------ */
/* 权限策略                                                            */
/* ------------------------------------------------------------------ */

type ApprovalVerdict = "allow" | "confirm";

/** 只读终端命令白名单：smart 模式自动放行 */
const READONLY_COMMAND_RE =
  /^\s*(ls|cat|head|tail|wc|pwd|echo|which|whoami|date|file|find|grep|rg|node\s+(-v|--version)|npm\s+(ls|view|search|test --)|git\s+(status|log|diff|show|branch|rev-parse|remote|tag)|pnpm\s+(ls|list|-v)|python3?\s+(-V|--version))\b/;

function riskForTool(toolName: string): ToolRisk {
  if (
    toolName === "readFile" ||
    toolName === "listDir" ||
    toolName === "searchFiles" ||
    toolName === "updateTasks" ||
    toolName === "webSearch" ||
    toolName === "loadSkill" ||
    toolName === "askUser" ||
    toolName === "spawnAgent" ||
    toolName === "listAgents" ||
    toolName === "waitForAgents" ||
    toolName === "collectAgentResults"
  ) {
    return "read";
  }
  if (toolName === "writeFile" || toolName === "editFile") {
    return "write";
  }
  if (toolName === "runTerminal") {
    return "exec";
  }
  if (
    toolName === "browserOpen" ||
    toolName === "browserClick" ||
    toolName === "browserType" ||
    toolName === "browserEvaluate"
  ) {
    return "network";
  }
  if (
    toolName === "browserSnapshot" ||
    toolName === "browserExtract" ||
    toolName === "browserConsole" ||
    toolName === "browserPerformance" ||
    toolName === "browserScreenshot" ||
    toolName === "browserStatus"
  ) {
    return "read";
  }
  if (toolName.startsWith("mcp.")) {
    return "network";
  }
  return "exec";
}

function isReadonlyCommand(command: string): boolean {
  return READONLY_COMMAND_RE.test(command);
}

/**
 * 单工具审批裁决（ADR-004 权限矩阵）。
 * 会话级「全部允许」与网络类确认记忆由 AgentSession 维护，命中后直接放行。
 */
function evaluateApproval(
  toolName: string,
  mode: PermissionMode,
  options: { remembered: boolean; command?: string },
): ApprovalVerdict {
  if (mode === "full") {
    return "allow";
  }
  const risk = riskForTool(toolName);
  if (risk === "read") {
    return "allow";
  }
  // 本会话内用户已放行过的工具（「全部允许」/ 网络类确认过）不再逐次确认
  if (options.remembered) {
    return "allow";
  }
  if (mode === "smart") {
    if (risk === "write") {
      // writeFile/editFile 的 path 都被 tools-fs 约束在工作区内
      return "allow";
    }
    if (risk === "exec" && options.command && isReadonlyCommand(options.command)) {
      return "allow";
    }
    return "confirm";
  }
  // default：除 read 外全部确认
  return "confirm";
}

/* ------------------------------------------------------------------ */
/* 工具集                                                              */
/* ------------------------------------------------------------------ */

function uuidLike(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** DuckDuckGo HTML 搜索（无需 API Key），解析结果链接与标题 */
async function runWebSearch(query: string): Promise<ReferenceItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`websearch HTTP ${response.status}`);
  }
  const html = await response.text();
  const results: ReferenceItem[] = [];
  const seen = new Set<string>();
  // DDG html 结果块：class="result__a" 的 <a href="...">title</a>
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) && results.length < 8) {
    let href = match[1] ?? "";
    const rawTitle = (match[2] ?? "").replace(/<[^>]+>/g, "").trim();
    if (!href || !rawTitle) {
      continue;
    }
    // DDG 会包一层 //duckduckgo.com/l/?uddg=
    if (href.startsWith("//")) {
      href = `https:${href}`;
    }
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        href = uddg;
      }
      if (!/^https?:\/\//i.test(href)) {
        continue;
      }
    } catch {
      continue;
    }
    if (seen.has(href)) {
      continue;
    }
    seen.add(href);
    results.push({ id: uuidLike(), title: rawTitle, url: href });
  }
  return results;
}

function withVersionSegment(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (/\/v\d+$/.test(base)) {
    return base;
  }
  return `${base}/v1`;
}

function createLanguageModel(config: AgentSessionConfig): LanguageModel {
  const baseURL = withVersionSegment(config.baseUrl);

  if (config.protocol === "anthropic-messages") {
    const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL });
    return anthropic(config.model);
  }

  if (config.protocol === "openai-responses") {
    const openai = createOpenAI({ apiKey: config.apiKey, baseURL });
    return openai.responses(config.model);
  }

  const compatible = createOpenAICompatible({
    name: "zen-provider",
    apiKey: config.apiKey,
    baseURL,
  });
  return compatible.chatModel(config.model);
}

function buildProviderOptions(config: AgentSessionConfig): Record<string, unknown> {
  const effort = config.reasoningEffort;
  if (!effort || effort === "off") {
    return {};
  }

  if (config.protocol === "anthropic-messages") {
    return { anthropic: { thinking: { type: "adaptive" }, effort } };
  }
  if (config.protocol === "openai-responses") {
    return { openai: { reasoningEffort: effort } };
  }
  return { zenProvider: { reasoningEffort: effort } };
}

function truncateOutput(text: string, limit = 8000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…[输出截断]` : text;
}

interface ToolHooks {
  /** askUser 工具挂起等待用户回答 */
  waitForUserAnswer(question: AskUserQuestionEvent, toolCallId: string): Promise<string>;
  emitAskEvent(question: AskUserQuestionEvent): void;
  emitAskResolved(askId: string, toolCallId: string, answer: string): void;
}

interface ToolSetRuntime {
  resourceLock?: ResourceLock;
  ownerLabel?: string;
  multiAgentTools?: ToolSet;
}

async function exclusive<T>(
  runtime: ToolSetRuntime | undefined,
  kind: "write" | "terminal" | "browser",
  fn: () => Promise<T>,
): Promise<T> {
  const lock = runtime?.resourceLock;
  const owner = runtime?.ownerLabel ?? "agent";
  if (!lock) {
    return await fn();
  }
  return lock.run(owner, kind, fn);
}

function buildToolSet(
  workspaceRoot: string,
  emit: (event: AgentStreamEvent) => void,
  sessionId: string,
  config: AgentSessionConfig,
  hooks: ToolHooks,
  runtime?: ToolSetRuntime,
): ToolSet {
  const toolSet: ToolSet = {
    readFile: tool({
      description: "Read a UTF-8 text file inside the workspace.",
      inputSchema: z.object({ path: z.string().describe("Path relative to the workspace root.") }),
      execute: async ({ path }) => {
        const result = await readWorkspaceFile(workspaceRoot, path);
        return result.content;
      },
    }),
    writeFile: tool({
      description: "Create or overwrite a UTF-8 text file inside the workspace.",
      inputSchema: z.object({
        path: z.string().describe("Path relative to the workspace root."),
        content: z.string().describe("Full file content to write."),
      }),
      execute: async ({ path, content }) => {
        return exclusive(runtime, "write", () =>
          writeWorkspaceFile(workspaceRoot, path, content),
        );
      },
    }),
    editFile: tool({
      description:
        "Edit a file by exact string replacement. oldString must match exactly (and uniquely unless replaceAll=true). Prefer this over writeFile for small changes.",
      inputSchema: z.object({
        path: z.string().describe("Path relative to the workspace root."),
        oldString: z.string().describe("Exact text to replace."),
        newString: z.string().describe("Replacement text."),
        replaceAll: z.boolean().optional().describe("Replace every occurrence (default false)."),
      }),
      execute: async ({ path, oldString, newString, replaceAll }) => {
        return exclusive(runtime, "write", async () => {
          const result = await editWorkspaceFile(
            workspaceRoot,
            path,
            oldString,
            newString,
            replaceAll ?? false,
          );
          if (result.replacements === 0) {
            throw new Error(
              `oldString not found in ${path}; read the file first and copy exact text`,
            );
          }
          return result;
        });
      },
    }),
    listDir: tool({
      description: "List one directory level inside the workspace (no recursion).",
      inputSchema: z.object({
        path: z.string().describe("Directory path relative to the workspace root ('' for root)."),
      }),
      execute: async ({ path }) => {
        const result = await listWorkspaceDir(workspaceRoot, path || "");
        return result.entries.map((entry) => `${entry.isDir ? "d" : "-"} ${entry.name}`).join("\n");
      },
    }),
    searchFiles: tool({
      description:
        "Search the workspace by file name or file content. Returns path/line/snippet hits.",
      inputSchema: z.object({
        query: z.string().describe("Text to search for."),
        mode: z.enum(["name", "content"]).describe("name = file names, content = file contents."),
      }),
      execute: async ({ query, mode }) => {
        const hits = await searchWorkspaceFiles(workspaceRoot, query, mode);
        if (!hits.length) {
          return "no matches";
        }
        return hits
          .slice(0, 40)
          .map((hit) =>
            hit.line > 0 ? `${hit.path}:${hit.line}: ${hit.snippet}` : `${hit.path}`,
          )
          .join("\n");
      },
    }),
    runTerminal: tool({
      description:
        "Run a shell command with cwd locked to the workspace root. Non-interactive use only (pass --yes/-y style flags yourself). Output is truncated.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to run."),
        timeoutMs: z
          .number()
          .optional()
          .describe("Timeout in ms (default 120000, max 300000)."),
      }),
      execute: async ({ command, timeoutMs }) => {
        return exclusive(runtime, "terminal", async () => {
          return await new Promise((resolve) => {
            exec(
              command,
              {
                cwd: workspaceRoot,
                timeout: Math.min(Math.max(timeoutMs ?? 120_000, 1000), 300_000),
                maxBuffer: 1024 * 1024,
                windowsHide: true,
                env: process.env,
              },
              (error, stdout, stderr) => {
                const exitCode =
                  typeof (error as { code?: unknown } | null)?.code === "number"
                    ? (error as unknown as { code: number }).code
                    : error
                      ? 1
                      : 0;
                const output = truncateOutput(
                  `${stdout || ""}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim() ||
                    "(no output)",
                );
                resolve({
                  ok: !error,
                  exitCode,
                  output,
                });
              },
            );
          });
        });
      },
    }),
    askUser: tool({
      description:
        "Ask the user one question with optional preset options; shown above the chat input. " +
        "Options render as a vertical list — single-select by default (one tap answers). " +
        "Set multiSelect=true when the options are not mutually exclusive (the user picks several and submits together). " +
        "Use when the requirement has branches, key info is missing, or several implementations are reasonable. Never ask what you can find out from the code.",
      inputSchema: z.object({
        question: z.string().describe("One concrete question."),
        options: z
          .array(z.string())
          .optional()
          .describe("2-6 preset answers for the user to pick; empty for free text only."),
        multiSelect: z
          .boolean()
          .optional()
          .describe("Set true when several options may be chosen at once; default single-select."),
        allowFreeText: z.boolean().optional().describe("Whether free text is allowed (default true)."),
      }),
      execute: async ({ question, options, multiSelect, allowFreeText }, { toolCallId }) => {
        const askId = uuidLike();
        const event: AskUserQuestionEvent = {
          askId,
          toolCallId,
          question,
          options: (options ?? []).slice(0, 6),
          multiSelect: multiSelect === true,
          allowFreeText: allowFreeText !== false,
        };
        hooks.emitAskEvent(event);
        const answer = await hooks.waitForUserAnswer(event, toolCallId);
        hooks.emitAskResolved(askId, toolCallId, answer);
        return { answer };
      },
    }),
    loadSkill: tool({
      description:
        "Load the full instructions (SKILL.md body) of one listed skill. Call before following a skill's workflow.",
      inputSchema: z.object({
        skillId: z.string().describe("The skill id from the available-skills list."),
      }),
      execute: async ({ skillId }) => {
        const found = await readSkillById(skillId, config.skillExtraPaths ?? []);
        if (!found) {
          throw new Error(`skill not found or not allowed: ${skillId}`);
        }
        return found;
      },
    }),
    updateTasks: tool({
      description:
        "Create or update the session task/plan list shown in the UI sidebar and chat timeline. " +
        "REQUIRED for any multi-step work (3+ steps or any plan). Call once up front with startNew=true, " +
        "then call again after completing or revising items — always send the FULL list. " +
        "Do not only write markdown checklists in prose; use this tool so the UI can track progress.",
      inputSchema: z.object({
        startNew: z
          .boolean()
          .optional()
          .describe("Set true to start a new task-list version instead of updating the current one."),
        tasks: z
          .array(
            z.object({
              id: z.string().describe("Stable task id, e.g. t1"),
              label: z.string().describe("Short task description"),
              done: z.boolean().describe("Whether the task is complete"),
            }),
          )
          .describe("Full list of tasks for this version."),
      }),
      execute: async ({ startNew, tasks }) => {
        const items: TaskItem[] = tasks.map((item) => ({
          id: item.id,
          label: item.label,
          done: item.done,
        }));
        // version 号由渲染层按会话累计；这里只传 items，startNew 用负数哨兵不优雅，
        // 改为在 AgentSession 侧维护计数并直接 emit 完整事件。
        emit({
          type: "tasks_updated",
          sessionId,
          version: startNew ? -1 : 0,
          items,
        });
        return { ok: true, count: items.length };
      },
    }),
    webSearch: tool({
      description:
        "Search the web (DuckDuckGo) and return top result titles/urls. Results are also listed in the UI References section.",
      inputSchema: z.object({
        query: z.string().describe("Search query in the user's language when possible."),
      }),
      execute: async ({ query }) => {
        const results = await runWebSearch(query);
        for (const reference of results) {
          emit({
            type: "reference_found",
            sessionId,
            reference: { ...reference, source: "web" },
          });
        }
        if (!results.length) {
          return { query, results: [], note: "no results" };
        }
        return {
          query,
          results: results.map((item) => ({ title: item.title, url: item.url })),
        };
      },
    }),
  };

  if (runtime?.multiAgentTools) {
    Object.assign(toolSet, runtime.multiAgentTools);
  }

  // 内嵌 WebContentsView + CDP：AI 浏览器工具（UI 对照 / 交互验证 / console / 性能）
  const browserBridge = config.browserBridge;
  if (browserBridge) {
    toolSet.browserStatus = tool({
      description:
        "Get the product browser status (Electron WebContentsView + CDP). Shows Chromium version bundled with Zen (updates via app update), URL/title.",
      inputSchema: z.object({}),
      execute: async () => browserBridge.status(),
    });
    toolSet.browserOpen = tool({
      description:
        "Open a URL in the product browser (embedded WebContentsView). Prefer the pageUrl from [页面元素]. " +
        "Local dev servers: use http://127.0.0.1:<port> or http://[::1]:<port> if localhost fails (IPv6-only listeners). " +
        "After open succeeds, use browserClick with the selector from [页面元素].",
      inputSchema: z.object({ url: z.string().describe("http(s) URL to open") }),
      execute: async ({ url }) => exclusive(runtime, "browser", () => browserBridge.open(url)),
    });
    toolSet.browserSnapshot = tool({
      description:
        "Snapshot the current browser page: title, outline of key UI nodes, visible text, links. Use for UI对照 and understanding structure.",
      inputSchema: z.object({}),
      execute: async () => formatSnapshotForPrompt(await browserBridge.snapshot()),
    });
    toolSet.browserExtract = tool({
      description:
        "Extract page content for AI: visible text, links, buttons, form inputs with selectors. Prefer this when you need actionable selectors.",
      inputSchema: z.object({}),
      execute: async () => formatExtractForPrompt(await browserBridge.extract()),
    });
    toolSet.browserClick = tool({
      description: "Click an element in the browser by CSS selector (from extract/element pick).",
      inputSchema: z.object({ selector: z.string() }),
      execute: async ({ selector }) =>
        exclusive(runtime, "browser", () => browserBridge.click(selector)),
    });
    toolSet.browserType = tool({
      description: "Type text into a browser form field by CSS selector.",
      inputSchema: z.object({
        selector: z.string(),
        text: z.string(),
        submit: z.boolean().optional().describe("Submit the form after typing"),
      }),
      execute: async ({ selector, text, submit }) =>
        exclusive(runtime, "browser", () => browserBridge.type(selector, text, { submit })),
    });
    toolSet.browserConsole = tool({
      description:
        "Read recent browser console logs (errors/warnings/log) for UI debugging and交互验证.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async ({ limit }) => formatConsoleForPrompt((await browserBridge.console(limit)).entries),
    });
    toolSet.browserPerformance = tool({
      description:
        "Collect browser performance metrics (navigation timing, FCP, heap, layout counts) for performance分析.",
      inputSchema: z.object({}),
      execute: async () => formatPerformanceForPrompt(await browserBridge.performance()),
    });
    toolSet.browserScreenshot = tool({
      description: "Capture a PNG screenshot of the current browser page to local disk.",
      inputSchema: z.object({}),
      execute: async () => exclusive(runtime, "browser", () => browserBridge.screenshot()),
    });
    toolSet.browserEvaluate = tool({
      description:
        "Evaluate a JS expression in the browser page context and return the value. Use sparingly.",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) =>
        exclusive(runtime, "browser", () => browserBridge.evaluate(expression)),
    });
  }

  // MCP 工具动态桥接：mcp.<server>.<tool>
  for (const bridge of config.mcpTools ?? []) {
    const toolName = `mcp.${bridge.serverName}.${bridge.name}`;
    toolSet[toolName] = tool({
      description: bridge.description
        ? `[MCP ${bridge.serverName}] ${bridge.description}`
        : `[MCP ${bridge.serverName}] ${bridge.name}`,
      inputSchema: jsonSchema(bridge.inputSchema),
      execute: async (input: unknown) => {
        const { callMcpTool } = await importMcpRuntime();
        const result = await callMcpTool(bridge.serverName, bridge.name, input);
        if (!result.ok) {
          throw new Error(result.error ?? "MCP tool failed");
        }
        return result.text;
      },
    });
  }

  return toolSet;
}

/** 延迟加载 main 侧 MCP 运行时，避免 agent-core 启动即依赖 Electron */
let mcpRuntimeLoader: (() => Promise<{
  callMcpTool(
    serverName: string,
    toolName: string,
    args: unknown,
  ): Promise<{ ok: boolean; text: string; error?: string }>;
}>) | null = null;

export function registerMcpRuntime(
  loader: () => Promise<{
    callMcpTool(
      serverName: string,
      toolName: string,
      args: unknown,
    ): Promise<{ ok: boolean; text: string; error?: string }>;
  }>,
): void {
  mcpRuntimeLoader = loader;
}

async function importMcpRuntime() {
  if (!mcpRuntimeLoader) {
    throw new Error("MCP runtime 未注册");
  }
  return mcpRuntimeLoader();
}

function buildInstructions(config: AgentSessionConfig): string | undefined {
  const parts: string[] = [];
  if (config.systemPrompt?.trim()) {
    parts.push(config.systemPrompt.trim());
  }
  if (config.skills?.length) {
    const lines = config.skills
      .map((skill) => `- ${skill.name}（id: ${skill.id}）：${skill.description || "无描述"}`)
      .join("\n");
    parts.push(
      `可用技能（按需用 loadSkill 工具加载全文后再遵循其流程）：\n${lines}\n不要对任务硬套技能；只有当技能确实匹配时才加载。`,
    );
  }
  if (config.mcpTools?.length) {
    const lines = config.mcpTools
      .map((bridge) => `- mcp.${bridge.serverName}.${bridge.name}: ${bridge.description ?? ""}`)
      .join("\n");
    parts.push(`已连接的 MCP 工具（调用前注意这些是外部服务）：\n${lines}`);
  }
  if (config.multiAgent !== false) {
    parts.push(multiAgentInstructions());
  }
  parts.push(
    `当前工作目录：${config.workspaceRoot}\n系统平台：${process.platform}\n今天的日期：${new Date().toISOString().slice(0, 10)}`,
  );
  if (config.browserBridge) {
    parts.push(
      `内置浏览器已接入（WebContentsView + CDP）。流程：browserOpen 打开 [页面元素] 里的 page= URL → browserClick/browserType 使用同一元素的 selector。` +
        `本地 dev server 若打开失败：依次改试 http://127.0.0.1:<port> 与 http://[::1]:<port>（IPv6-only 监听时 localhost 可能连不上）。` +
        `不要因一次 open 失败就放弃浏览器工具改去盲猜组件；先确认 URL 再定位代码。`,
    );
  }
  return parts.join("\n\n");
}

function partText(part: unknown): string {
  const p = part as { text?: string; delta?: string };
  return p.text ?? p.delta ?? "";
}

function toolNameFromPart(part: unknown): string {
  const p = part as { toolName?: string; toolCall?: { toolName?: string } };
  return p.toolName ?? p.toolCall?.toolName ?? "unknown";
}

function toolIdFromPart(part: unknown): string {
  const p = part as { id?: string; toolCallId?: string; toolCall?: { toolCallId?: string } };
  return p.id ?? p.toolCallId ?? p.toolCall?.toolCallId ?? "";
}

function argsFromPart(part: unknown): unknown {
  const p = part as { toolCall?: { input?: unknown; args?: unknown }; input?: unknown };
  return p.toolCall?.input ?? p.toolCall?.args ?? p.input;
}

function outputFromPart(part: unknown): unknown {
  const p = part as { output?: unknown; result?: unknown };
  return p.output ?? p.result;
}

function summarizeToolOutput(part: unknown): string {
  const output = outputFromPart(part);
  if (typeof output === "string") {
    return output.length > 120 ? `${output.slice(0, 120)}…` : output;
  }
  if (output && typeof output === "object" && "path" in output) {
    return String((output as { path: unknown }).path);
  }
  if (isFailedToolOutput(output)) {
    return output.output.length > 120 ? `${output.output.slice(0, 120)}…` : output.output;
  }
  return "工具执行完成";
}

function isFailedToolOutput(value: unknown): value is { ok: false; output: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false &&
    "output" in value &&
    typeof (value as { output?: unknown }).output === "string"
  );
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return "Agent 执行失败";
}

/** AI SDK finish-step 的 usage（token 数可能为 undefined/null） */
function usageFromPart(part: unknown): { inputTokens: number; outputTokens: number } | null {
  const p = part as {
    usage?: { inputTokens?: number | null; outputTokens?: number | null };
    totalUsage?: { inputTokens?: number | null; outputTokens?: number | null };
  };
  const usage = p.usage ?? p.totalUsage;
  if (!usage || (usage.inputTokens == null && usage.outputTokens == null)) {
    return null;
  }
  return { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 };
}

interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
}

interface PendingAsk {
  askId: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
}

/**
 * 单个会话的有状态 Agent 运行时。
 *
 * 通过 AI SDK `ToolLoopAgent` 完成多步工具循环，并在需要审批的工具调用处暂停。
 * 审批通过/拒绝后，把 `tool-approval-response` 追加回消息并继续 loop。
 * `pause` 会中断当前流，`resume` 从最近一次完整 step 的 checkpoint 继续。
 */
export class AgentSession {
  private readonly config: AgentSessionConfig;
  private readonly agent: ToolLoopAgent;
  private messages: ModelMessage[] = [];
  private controller: AbortController | null = null;
  private paused = false;
  private step = 0;
  /** run 是否仍活跃：暂停/等审批时 start/runStep 已返回，但 run 未结束 */
  private runActive = false;
  /** 尚未 tool_end 的工具，run 终态时补 cancelled/interrupted */
  private openTools = new Map<string, string>();
  private pending: PendingApproval | null = null;
  /** 会话内任务清单版本号（updateTasks 的 startNew 递增） */
  private taskVersion = 0;
  /** askUser 挂起等待（askId → resolver） */
  private readonly pendingAsks = new Map<string, PendingAsk>();
  /** 会话内已放行的工具（「全部允许」记忆；网络类确认一次后同样放行） */
  private readonly rememberedTools = new Set<string>();
  /** 多 Agent：写/终端/浏览器互斥 + 编排器（主会话） */
  private readonly resourceLock = new ResourceLock();
  private readonly orchestrator: MultiAgentOrchestrator | null;

  constructor(config: AgentSessionConfig) {
    this.config = config;
    const emit: (event: AgentStreamEvent) => void = (event) => {
      if (event.type === "tasks_updated") {
        // version=-1 表示工具要求开新版；version=0 表示更新当前版
        if (event.version === -1) {
          this.taskVersion += 1;
        } else if (this.taskVersion === 0) {
          this.taskVersion = 1;
        }
        config.emit({
          type: "tasks_updated",
          sessionId: event.sessionId,
          version: this.taskVersion,
          items: event.items,
        });
        return;
      }
      config.emit(event);
    };
    const hooks: ToolHooks = {
      emitAskEvent: (question) => {
        emit({ type: "ask_user", sessionId: config.sessionId, question });
      },
      emitAskResolved: (askId, toolCallId, answer) => {
        emit({
          type: "ask_resolved",
          sessionId: config.sessionId,
          askId,
          toolCallId,
          answer,
        });
      },
      waitForUserAnswer: (question) => {
        return new Promise<string>((resolve, reject) => {
          this.pendingAsks.set(question.askId, { askId: question.askId, resolve, reject });
        });
      },
    };

    this.orchestrator =
      config.multiAgent === false
        ? null
        : new MultiAgentOrchestrator({
            parentSessionId: config.sessionId,
            emit: config.emit,
            resourceLock: this.resourceLock,
            runChild: (spec) => this.runSubAgent(spec),
          });

    const multiAgentTools = this.orchestrator?.buildTools();
    this.agent = new ToolLoopAgent({
      model: createLanguageModel(config),
      tools: buildToolSet(config.workspaceRoot, emit, config.sessionId, config, hooks, {
        resourceLock: this.resourceLock,
        ownerLabel: config.sessionId,
        multiAgentTools,
      }),
      instructions: buildInstructions(config),
      stopWhen: isStepCount(30),
      providerOptions: buildProviderOptions(config) as never,
      toolApproval: ({ toolCall }) => {
        const toolName = toolCall.toolName ?? "";
        const args = (toolCall as { input?: unknown; args?: unknown }).input;
        const command =
          typeof args === "object" && args !== null && "command" in args
            ? String((args as { command: unknown }).command)
            : undefined;
        const verdict = evaluateApproval(toolName, config.permissionMode, {
          remembered: this.rememberedTools.has(toolName),
          command,
        });
        return verdict === "allow" ? undefined : "user-approval";
      },
    });
  }

  get sessionId(): string {
    return this.config.sessionId;
  }

  get agentTree() {
    return this.orchestrator?.snapshot() ?? null;
  }

  /** 启动并等待一个子 Agent；子会话不启用 multiAgent、不阻塞审批（smart→full） */
  private async runSubAgent(spec: {
    agentId: string;
    name: string;
    task: string;
    signal: AbortSignal;
    onLog: (text: string) => void;
  }): Promise<{ ok: boolean; text: string; error?: string }> {
    if (spec.signal.aborted) {
      return { ok: false, text: "", error: "cancelled" };
    }
    let collected = "";
    let childError = "";
    const child = new AgentSession({
      ...this.config,
      sessionId: `${this.config.sessionId}::${spec.agentId}`,
      multiAgent: false,
      permissionMode: "full",
      systemPrompt: `${subAgentInstructions({
        name: spec.name,
        parentSessionId: this.config.sessionId,
      })}\n\n${this.config.systemPrompt ?? ""}`.trim(),
      browserBridge: this.config.browserBridge,
      emit: (event) => {
        if (event.type === "delta" && event.text) {
          collected += event.text;
          spec.onLog(event.text.slice(0, 120));
          return;
        }
        if (event.type === "error") {
          childError = event.message;
          spec.onLog(`错误：${event.message}`);
          return;
        }
        if (event.type === "tool_start") {
          spec.onLog(`工具 ${event.toolName}`);
          return;
        }
        if (event.type === "done" && event.reason === "error") {
          childError = childError || "子任务失败";
        }
      },
    });
    const onAbort = () => {
      void child.cancel();
    };
    spec.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await child.start(spec.task);
      if (spec.signal.aborted) {
        return { ok: false, text: collected, error: "cancelled" };
      }
      if (childError) {
        return { ok: false, text: collected, error: childError };
      }
      const text = collected.trim();
      if (!text) {
        return { ok: false, text: "", error: "子任务未产生输出" };
      }
      return { ok: true, text };
    } catch (error) {
      return {
        ok: false,
        text: collected,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      spec.signal.removeEventListener("abort", onAbort);
    }
  }

  async start(userMessage: string, history?: ChatTurn[]): Promise<void> {
    this.messages = (history ?? []).map((item) => ({
      role: item.role as "system" | "user" | "assistant",
      content: item.content,
    }));
    this.messages.push({ role: "user", content: userMessage });
    this.paused = false;
    this.step = 0;
    this.pending = null;
    this.openTools.clear();
    this.runActive = true;
    this.controller = new AbortController();
    this.config.emit({ type: "status", sessionId: this.sessionId, status: "thinking" });
    await this.runStep();
  }

  async approve(decision: ToolApprovalDecision): Promise<void> {
    if (!this.pending || this.pending.approvalId !== decision.approvalId) {
      return;
    }
    const pending = this.pending;
    if (decision.approved) {
      const risk = riskForTool(pending.toolName);
      if (risk === "network" || decision.always) {
        // 会话级记忆：网络类确认一次后放行；显式「全部允许」时记忆该工具
        this.rememberedTools.add(pending.toolName);
      }
    }
    this.messages.push({
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: decision.approvalId,
          approved: decision.approved,
          reason: decision.reason,
        },
      ],
    });
    this.pending = null;
    // 批准只解阻，不伪造 tool_end；拒绝才有 denied 终态
    this.config.emit({
      type: "approval_resolved",
      sessionId: this.sessionId,
      approvalId: pending.approvalId,
      toolCallId: pending.toolCallId,
      approved: decision.approved,
    });
    if (!decision.approved) {
      this.openTools.delete(pending.toolCallId);
      this.config.emit({
        type: "tool_end",
        sessionId: this.sessionId,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        ok: false,
        state: "denied",
        summary: decision.reason ?? "已拒绝执行",
      });
    }
    await this.continueLoop();
  }

  reject(decision: ToolApprovalDecision): Promise<void> {
    return this.approve({ ...decision, approved: false });
  }

  /** 渲染层回答 askUser 提问 */
  resolveAsk(askId: string, answer: string): boolean {
    const pending = this.pendingAsks.get(askId);
    if (!pending) {
      return false;
    }
    this.pendingAsks.delete(askId);
    pending.resolve(answer);
    return true;
  }

  async pause(): Promise<void> {
    if (!this.controller || this.paused) {
      return;
    }
    this.paused = true;
    this.controller.abort();
  }

  async resume(): Promise<void> {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    await this.continueLoop();
  }

  async cancel(): Promise<void> {
    const waiting = this.paused || this.pending != null || this.pendingAsks.size > 0;
    this.orchestrator?.dispose();
    if (this.controller) {
      this.controller.abort();
    }
    this.paused = false;
    this.pending = null;
    for (const pending of this.pendingAsks.values()) {
      pending.reject(new Error("会话已取消"));
    }
    this.pendingAsks.clear();
    // runStep 已因暂停/等审批返回时，abort 不会再触发 done，这里补终态
    if (this.runActive && waiting) {
      this.finishRun("cancelled");
    }
  }

  private finishRun(reason: AgentDoneReason): void {
    this.runActive = false;
    this.pending = null;
    // 未结束工具补终态事件，与 reducer / tool_end 协议一致
    const unfinishedState: ToolCallState = reason === "cancelled" ? "cancelled" : "interrupted";
    const unfinishedSummary = reason === "cancelled" ? "已取消，未完成" : "已中断，未完成";
    for (const [toolCallId, toolName] of this.openTools) {
      this.config.emit({
        type: "tool_end",
        sessionId: this.sessionId,
        toolCallId,
        toolName,
        ok: false,
        state: unfinishedState,
        summary: unfinishedSummary,
      });
    }
    this.openTools.clear();
    this.config.emit({ type: "done", sessionId: this.sessionId, reason });
  }

  private async continueLoop(): Promise<void> {
    this.controller = new AbortController();
    this.config.emit({ type: "status", sessionId: this.sessionId, status: "thinking" });
    await this.runStep();
  }

  private async runStep(): Promise<void> {
    if (!this.controller) {
      return;
    }

    const signal = this.controller.signal;
    let stream: Awaited<ReturnType<ToolLoopAgent["stream"]>> | null = null;

    try {
      stream = await this.agent.stream({ messages: this.messages, abortSignal: signal });
    } catch (error) {
      this.config.emit({
        type: "error",
        sessionId: this.sessionId,
        message: errorMessage(error),
      });
      this.finishRun("error");
      return;
    }

    let approvalRequested = false;
    let aborted = false;
    let streamError: string | null = null;

    try {
      for await (const part of stream.fullStream) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        switch (part.type) {
          case "start-step":
            this.step += 1;
            this.config.emit({ type: "step_start", sessionId: this.sessionId, step: this.step });
            break;
          case "finish":
            break;
          case "finish-step": {
            const usage = usageFromPart(part);
            if (usage) {
              this.config.emit({ type: "usage", sessionId: this.sessionId, ...usage });
            }
            break;
          }
          case "reasoning-delta":
            this.config.emit({
              type: "reasoning_delta",
              sessionId: this.sessionId,
              text: partText(part),
            });
            break;
          case "text-delta": {
            const text = partText(part);
            if (text) {
              this.config.emit({
                type: "status",
                sessionId: this.sessionId,
                status: "answering",
              });
              this.config.emit({ type: "delta", sessionId: this.sessionId, text });
            }
            break;
          }
          case "tool-input-start":
            this.openTools.set(toolIdFromPart(part), toolNameFromPart(part));
            this.config.emit({
              type: "tool_input_start",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
            });
            break;
          case "tool-call":
            this.openTools.set(toolIdFromPart(part), toolNameFromPart(part));
            this.config.emit({
              type: "tool_start",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
              args: argsFromPart(part),
            });
            this.config.emit({
              type: "status",
              sessionId: this.sessionId,
              status: "tool-running",
            });
            break;
          case "tool-result":
            this.openTools.delete(toolIdFromPart(part));
            this.config.emit({
              type: "tool_end",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
              ok: !isFailedToolOutput(outputFromPart(part)),
              state: isFailedToolOutput(outputFromPart(part)) ? "error" : "ok",
              summary: summarizeToolOutput(part),
              output: outputFromPart(part),
            });
            break;
          case "tool-error": {
            this.openTools.delete(toolIdFromPart(part));
            const error = (part as { error?: unknown }).error;
            const message = errorMessage(error);
            this.config.emit({
              type: "tool_end",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
              ok: false,
              state: "error",
              summary: message || "工具执行失败",
              output: message,
            });
            break;
          }
          case "tool-approval-request":
            if (!part.isAutomatic) {
              approvalRequested = true;
              this.pending = {
                approvalId: part.approvalId,
                toolCallId: toolIdFromPart(part),
                toolName: toolNameFromPart(part),
              };
              this.config.emit({
                type: "approval_request",
                sessionId: this.sessionId,
                request: {
                  approvalId: part.approvalId,
                  toolCallId: toolIdFromPart(part),
                  toolName: toolNameFromPart(part),
                  input: argsFromPart(part),
                  reason: part.reason,
                  risk: riskForTool(toolNameFromPart(part)),
                },
              });
              this.config.emit({
                type: "status",
                sessionId: this.sessionId,
                status: "awaiting-approval",
              });
            }
            break;
          case "tool-approval-response":
            this.config.emit({
              type: "approval_resolved",
              sessionId: this.sessionId,
              approvalId: part.approvalId,
              toolCallId: toolIdFromPart(part),
              approved: part.approved,
            });
            break;
          case "error":
            streamError = errorMessage(part.error);
            this.config.emit({
              type: "error",
              sessionId: this.sessionId,
              message: streamError,
            });
            break;
          default:
            break;
        }
      }
    } catch (error) {
      streamError = errorMessage(error);
      this.config.emit({
        type: "error",
        sessionId: this.sessionId,
        message: streamError,
      });
    }

    if (aborted) {
      if (this.paused) {
        this.config.emit({ type: "status", sessionId: this.sessionId, status: "paused" });
        return;
      }
      this.finishRun("cancelled");
      return;
    }

    // 错误终态：不得再发 done(stop) 覆盖
    if (streamError) {
      this.finishRun("error");
      return;
    }

    // 完整 step 才落 checkpoint，避免把半截 step 写入后续上下文。
    const responseMessages = await stream.responseMessages;
    if (responseMessages.length) {
      this.messages.push(...responseMessages);
    }

    if (approvalRequested) {
      return;
    }

    this.finishRun("stop");
  }
}
