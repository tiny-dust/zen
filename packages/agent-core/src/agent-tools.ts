import { jsonSchema, tool } from "ai";
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

import type { ToolSet } from "ai";
import type {
  AgentStreamEvent,
  AskUserQuestionEvent,
  TaskItem,
} from "@zen/shared";
import type { ResourceLock } from "./resource-lock";
import type { AgentSessionConfig } from "./agent-config";
import { uuidLike } from "./agent-parts";
import { runWebSearch } from "./agent-websearch";
import { truncateOutput } from "./agent-model";

export interface ToolHooks {
  /** askUser 工具挂起等待用户回答 */
  waitForUserAnswer(question: AskUserQuestionEvent, toolCallId: string): Promise<string>;
  emitAskEvent(question: AskUserQuestionEvent): void;
  emitAskResolved(askId: string, toolCallId: string, answer: string): void;
}

export interface ToolSetRuntime {
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

export function buildToolSet(
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
        path: z
          .string()
          .optional()
          .describe("Directory path relative to the workspace root. Omit or '' for root."),
      }),
      execute: async ({ path }) => {
        const result = await listWorkspaceDir(workspaceRoot, path ?? "");
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
      execute: async ({ command, timeoutMs }, { toolCallId }) => {
        return exclusive(runtime, "terminal", async () => {
          return await new Promise((resolve) => {
            // 持续运行的命令（dev server / watch）：边跑边收输出尾部，
            // 节流推送 tool_progress.outputTail 供「进程」节实时刷新；仅保留尾部限量
            const TAIL_LIMIT = 8000;
            let tail = "";
            let lastEmitAt = 0;
            const appendTail = (chunk: string) => {
              tail = (tail + chunk).slice(-TAIL_LIMIT);
              const now = Date.now();
              if (now - lastEmitAt < 500) {
                return;
              }
              lastEmitAt = now;
              emit({
                type: "tool_progress",
                sessionId,
                event: {
                  toolCallId,
                  toolName: "runTerminal",
                  message: "运行中",
                  outputTail: tail,
                },
              });
            };
            const child = exec(
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
            child.stdout?.on("data", (chunk) => appendTail(String(chunk)));
            child.stderr?.on("data", (chunk) => appendTail(String(chunk)));
          });
        });
      },
    }),
    askUser: tool({
      description:
        "Ask the user one question with optional preset options; shown above the chat input. " +
        "Options render as a vertical list — single-select by default (one tap answers). " +
        "Set multiSelect=true when the options are not mutually exclusive (the user picks several and submits together). " +
        "Multiple questions may be pending at once (from this agent or parallel sub-agents); each is answered independently and resumes its asker. " +
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
    ...(config.memoryBridge
      ? {
          updateMemory: tool({
            description:
              "Append one durable note to long-term memory (survives across sessions). " +
              "scope=device records device facts worth reusing (paths, tool locations, environment quirks); " +
              "scope=user records stable user preferences and working habits. " +
              "Only save long-lived information — never one-off task details. " +
              "For user habits, save when the user explicitly asks to remember, or states a clear durable preference.",
            inputSchema: z.object({
              scope: z
                .enum(["device", "user"])
                .describe("device = environment facts; user = user preferences/habits."),
              text: z
                .string()
                .max(500)
                .describe("One concise note (a single sentence or bullet)."),
            }),
            execute: async ({ scope, text }) => {
              const result = await config.memoryBridge?.appendNote(scope, text);
              if (!result?.ok) {
                throw new Error(result?.error ?? "memory write failed");
              }
              return { ok: true };
            },
          }),
        }
      : {}),
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

async function importMcpRuntime(): Promise<{
  callMcpTool(
    serverName: string,
    toolName: string,
    args: unknown,
  ): Promise<{ ok: boolean; text: string; error?: string }>;
}> {
  const mod = await import("./mcp-runtime");
  return mod.importMcpRuntime();
}
