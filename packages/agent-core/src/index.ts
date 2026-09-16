import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isStepCount, tool, ToolLoopAgent } from "ai";
import { z } from "zod";

import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type {
  AgentStreamEvent,
  ChatTurn,
  ProviderProtocol,
  ReasoningEffort,
  ReferenceItem,
  TaskItem,
  ToolApprovalDecision,
  ToolRisk,
} from "@zen/shared";
import { readWorkspaceFile, writeWorkspaceFile } from "@zen/tools-fs";

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

export interface AgentSessionConfig {
  sessionId: string;
  workspaceRoot: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  emit: (event: AgentStreamEvent) => void;
}

const APPROVAL_BY_RISK: Record<ToolRisk, boolean> = {
  read: false,
  write: true,
  exec: true,
  network: true,
};

function riskForTool(toolName: string): ToolRisk {
  if (toolName === "readFile" || toolName === "updateTasks" || toolName === "webSearch") {
    // webSearch 只发起公开 GET，按只读处理，避免每次搜索都弹审批
    return "read";
  }
  if (toolName === "writeFile") {
    return "write";
  }
  return "exec";
}

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

function buildToolSet(
  workspaceRoot: string,
  emit: (event: AgentStreamEvent) => void,
  sessionId: string,
): ToolSet {
  return {
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
        const result = await writeWorkspaceFile(workspaceRoot, path, content);
        return result.content;
      },
    }),
    updateTasks: tool({
      description:
        "Create or update the session task list shown in the UI. Call with startNew=true to begin a new version (vN). Always send the full task list.",
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
          emit({ type: "reference_found", sessionId, reference });
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
  return "工具执行完成";
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
  private pending: PendingApproval | null = null;
  /** 会话内任务清单版本号（updateTasks 的 startNew 递增） */
  private taskVersion = 0;

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
    this.agent = new ToolLoopAgent({
      model: createLanguageModel(config),
      tools: buildToolSet(config.workspaceRoot, emit, config.sessionId),
      stopWhen: isStepCount(20),
      providerOptions: buildProviderOptions(config) as never,
      toolApproval: ({ toolCall }) => {
        const risk = riskForTool(toolCall.toolName);
        return APPROVAL_BY_RISK[risk] ? "user-approval" : undefined;
      },
    });
  }

  get sessionId(): string {
    return this.config.sessionId;
  }

  async start(userMessage: string, history?: ChatTurn[]): Promise<void> {
    this.messages = (history ?? []).map((item) => ({
      role: item.role as "system" | "user" | "assistant",
      content: item.content,
    }));
    this.messages.push({ role: "user", content: userMessage });
    this.paused = false;
    this.pending = null;
    this.controller = new AbortController();
    this.config.emit({ type: "status", sessionId: this.sessionId, status: "thinking" });
    await this.runStep();
  }

  async approve(decision: ToolApprovalDecision): Promise<void> {
    if (!this.pending || this.pending.approvalId !== decision.approvalId) {
      return;
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
    await this.continueLoop();
  }

  reject(decision: ToolApprovalDecision): Promise<void> {
    return this.approve({ ...decision, approved: false });
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
    if (this.controller) {
      this.controller.abort();
    }
    this.paused = false;
    this.pending = null;
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
      this.config.emit({ type: "done", sessionId: this.sessionId, reason: "error" });
      return;
    }

    let approvalRequested = false;
    let aborted = false;

    try {
      for await (const part of stream.fullStream) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        switch (part.type) {
          case "start-step":
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
            this.config.emit({
              type: "tool_input_start",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
            });
            break;
          case "tool-call":
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
            this.config.emit({
              type: "tool_end",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
              ok: true,
              summary: summarizeToolOutput(part),
              output: outputFromPart(part),
            });
            break;
          case "tool-error":
            this.config.emit({
              type: "tool_end",
              sessionId: this.sessionId,
              toolCallId: toolIdFromPart(part),
              toolName: toolNameFromPart(part),
              ok: false,
              summary: "工具执行失败",
              output: outputFromPart(part),
            });
            break;
          case "tool-approval-request":
            if (!part.isAutomatic) {
              approvalRequested = true;
              this.pending = { approvalId: part.approvalId };
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
            this.config.emit({
              type: "error",
              sessionId: this.sessionId,
              message: errorMessage(part.error),
            });
            break;
          default:
            break;
        }
      }
    } catch (error) {
      this.config.emit({
        type: "error",
        sessionId: this.sessionId,
        message: errorMessage(error),
      });
    }

    if (aborted) {
      if (this.paused) {
        this.config.emit({ type: "status", sessionId: this.sessionId, status: "paused" });
        return;
      }
      this.config.emit({ type: "done", sessionId: this.sessionId, reason: "cancelled" });
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

    this.config.emit({ type: "done", sessionId: this.sessionId, reason: "stop" });
  }
}
