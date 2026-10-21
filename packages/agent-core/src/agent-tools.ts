import { jsonSchema, tool } from "ai";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
import { resolveDefaultShell } from "@zen/tools-terminal";

import type { ToolSet } from "ai";
import type {
  AgentStreamEvent,
  AskUserQuestionEvent,
  McpAppToolOutput,
  TaskItem,
} from "@zen/shared";
import { MCP_TOOL_NAME_MAX, mcpToolWireName } from "@zen/shared";
import type { ResourceLock } from "./resource-lock";
import type { AgentSessionConfig } from "./agent-config";
import { uuidLike } from "./agent-parts";
import { runWebFetch } from "./agent-webfetch";
import { searchWeb } from "./agent-websearch";
import { truncateOutput } from "./agent-model";

/** 工具结果统一输出上限：超长 string 截断后再进对话历史，避免大输出每步重复挤占上下文 */
export const MAX_TOOL_RESULT_CHARS = 30_000;

type ToolExecute = (input: unknown, options: unknown) => Promise<unknown>;

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
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const lock = runtime?.resourceLock;
  const owner = runtime?.ownerLabel ?? "agent";
  if (!lock) {
    return await fn(signal);
  }
  // 等锁阶段可被 abort 中断：否则持锁任务卡死时，后续独占工具永久排队，会话假死
  return lock.run(owner, kind, fn, signal);
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
        if (result.content.length <= MAX_TOOL_RESULT_CHARS) {
          return result.content;
        }
        const note =
          `\n\n[文件内容已截断：原始 ${result.content.length} 字符，仅保留前 ${MAX_TOOL_RESULT_CHARS}；` +
          `完整文件仍在 ${path}，可用 searchFiles content 模式按片段检索]`;
        // 后缀计入上限：readFile 自身截断后总输出不超上限，通用包装层对它就是 no-op
        return result.content.slice(0, MAX_TOOL_RESULT_CHARS - note.length) + note;
      },
    }),
    writeFile: tool({
      description: "Create or overwrite a UTF-8 text file inside the workspace.",
      inputSchema: z.object({
        path: z.string().describe("Path relative to the workspace root."),
        content: z.string().describe("Full file content to write."),
      }),
      execute: async ({ path, content }, { abortSignal }) => {
        return exclusive(
          runtime,
          "write",
          async () => {
            // 检查点只是回退保障，备份失败不应让写入本身中断
            let checkpointId: string | null = null;
            try {
              checkpointId = (await config.checkpointBridge?.backupFile(path)) ?? null;
            } catch {
              // 忽略备份错误
            }
            const result = await writeWorkspaceFile(workspaceRoot, path, content);
            // 写入成功后补改后副本（撤销后可重新套用）；失败不影响写入结果
            try {
              await config.checkpointBridge?.afterFile?.(path, checkpointId);
            } catch {
              // 忽略改后副本错误
            }
            return result;
          },
          abortSignal,
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
      execute: async ({ path, oldString, newString, replaceAll }, { abortSignal }) => {
        return exclusive(runtime, "write", async (signal) => {
          void signal;
          // 检查点只是回退保障，备份失败不应让写入本身中断
          let checkpointId: string | null = null;
          try {
            checkpointId = (await config.checkpointBridge?.backupFile(path)) ?? null;
          } catch {
            // 忽略备份错误
          }
          const result = await editWorkspaceFile(
            workspaceRoot,
            path,
            oldString,
            newString,
            replaceAll ?? false,
          );
          if (result.replacements === 0) {
            throw new Error(
              `oldString not found in ${path}; read the file first and copy exact text${result.hint ? ` (${result.hint})` : ""}`,
            );
          }
          // 写入成功后补改后副本（撤销后可重新套用）；失败不影响写入结果
          try {
            await config.checkpointBridge?.afterFile?.(path, checkpointId);
          } catch {
            // 忽略改后副本错误
          }
          return result;
        }, abortSignal);
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
        const lines = result.entries.map((entry) => `${entry.isDir ? "d" : "-"} ${entry.name}`);
        if (result.truncated) {
          lines.push(`[条目过多：仅显示前 ${result.entries.length} 项]`);
        }
        return lines.join("\n");
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
        const { hits, truncated } = await searchWorkspaceFiles(workspaceRoot, query, mode);
        if (!hits.length) {
          return "no matches";
        }
        const lines = hits
          .slice(0, 40)
          .map((hit) => (hit.line > 0 ? `${hit.path}:${hit.line}: ${hit.snippet}` : `${hit.path}`));
        if (truncated) {
          lines.push("[结果已截断：命中过多或扫描范围达上限，请用更精确的查询缩小范围]");
        }
        return lines.join("\n");
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
      execute: async ({ command, timeoutMs }, { toolCallId, abortSignal }) => {
        return exclusive(runtime, "terminal", async () => {
          // 用户 shell 环境快照（PATH 等）：GUI 启动的进程缺 ~/.zshrc 等交互配置，
          // 直接继承 process.env 会高频 command not found；首调捕获一次，进程内缓存
          const shellEnv = await getShellEnvSnapshot();
          return await new Promise((resolve) => {
            // 持续运行的命令（dev server / watch）：边跑边收输出尾部，
            // 节流推送 tool_progress.outputTail 供「进程」节实时刷新；仅保留尾部限量
            const TAIL_LIMIT = 8000;
            const OUTPUT_LIMIT = 1024 * 1024;
            let tail = "";
            let stdoutText = "";
            let stderrText = "";
            let lastEmitAt = 0;
            const appendChunk = (chunk: string, isStderr: boolean) => {
              if (settled) {
                return; // 已结算后不再刷进度：close 前的残留数据只入缓存，不发无效 tool_progress
              }
              tail = (tail + chunk).slice(-TAIL_LIMIT);
              if (isStderr) {
                stderrText = (stderrText + chunk).slice(-OUTPUT_LIMIT);
              } else {
                stdoutText = (stdoutText + chunk).slice(-OUTPUT_LIMIT);
              }
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
            // settle 兜底：close 回调与 abort 可能竞态，只取第一个结果；
            // 暂停/取消必须立刻生效，否则 fullStream 等不到下一个 part，run 卡在工具里
            let settled = false;
            let childPid = 0;
            let timedOut = false;
            let exitCode: number | null = null;
            let drainTimer: ReturnType<typeof setTimeout> | null = null;
            const settle = (value: { ok: boolean; exitCode: number; output: string }) => {
              if (settled) {
                return;
              }
              settled = true;
              abortSignal?.removeEventListener("abort", onAbort);
              // 结束后检测进程组存活者：dev server 等孙进程在 shell 被 kill 后仍存活，
              // 交给 main 侧收集为长驻服务（右栏「服务」可管理/关闭）
              if (childPid > 0) {
                config.servicesBridge?.settle(childPid);
              }
              resolve(value);
            };
            // 只杀 shell 本身、不杀进程组：孙进程（dev server）留在进程组里，
            // 由 servicesBridge 收集为长驻服务（有意设计，勿改成整组 kill）。
            // SIGTERM 被忽略的 shell 2s 后升级 SIGKILL；exitCode 非 null 表示已退出，
            // 不会再误杀（避免 pid 复用风险）
            const killShell = () => {
              child.kill();
              setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                  child.kill("SIGKILL");
                }
              }, 2000).unref?.();
            };
            // spawn（而非 exec）：detached 让 shell 真正成为进程组长（pgid = pid，
            // exec 不转发 detached），超时/中断只杀 shell，存活的孙进程仍留在同一
            // 进程组，settle 后可整组跟踪与关闭。
            // stdin = ignore：等待输入的命令立刻 EOF 退出，而不是挂到超时
            const child = spawnAgentCommand(workspaceRoot, command, shellEnv);
            childPid = child.pid ?? 0;
            if (childPid > 0) {
              config.servicesBridge?.track({ sessionId, command, cwd: workspaceRoot, pid: childPid });
            }
            const combinedSoFar = () =>
              `${stdoutText}${stderrText ? `\n[stderr]\n${stderrText}` : ""}`.trim();
            const timer = setTimeout(() => {
              timedOut = true;
              killShell();
              // 超时即结算：孙进程（dev server 等）会继续持有 stdio 管道令 close 永不
              // 触发，干等只会把 exclusive 锁一起挂死；存活进程组交给 settle 里的
              // servicesBridge 收集为长驻服务
              settle({
                ok: false,
                exitCode: exitCode ?? -1,
                output: truncateOutput(combinedSoFar() || "(no output)"),
              });
            }, Math.min(Math.max(timeoutMs ?? 120_000, 1000), 300_000));
            // spawn 异步失败（shell 不存在/cwd 失效）必须兜底结算：
            // 无 error 监听会变成 unhandled 'error' 事件直接崩进程
            child.on("error", (error) => {
              clearTimeout(timer);
              settle({
                ok: false,
                exitCode: -1,
                output: `failed to start command: ${error.message}`,
              });
            });
            child.on("exit", (code) => {
              exitCode = code;
              // shell 退出 ≠ close：孙进程可能仍持有管道。给一个短暂收尾窗口把已产出
              // 的输出收完，窗口过后仍未 close 则按已收输出结算——否则 close 永不触发，
              // 工具与 exclusive 锁一起挂死（「运行中」无下文的根因）
              drainTimer = setTimeout(() => {
                settle({
                  ok: !timedOut && code === 0,
                  exitCode: code ?? 1,
                  output: truncateOutput(combinedSoFar() || "(no output)"),
                });
              }, 1000);
            });
            child.on("close", (code) => {
              clearTimeout(timer);
              if (drainTimer) {
                clearTimeout(drainTimer);
                drainTimer = null;
              }
              // 与原 exec 契约一致：stdout 在前，stderr 以 [stderr] 标记拼接
              const combined = `${stdoutText}${stderrText ? `\n[stderr]\n${stderrText}` : ""}`.trim();
              settle({
                ok: !timedOut && code === 0,
                exitCode: code ?? 1,
                output: truncateOutput(combined || "(no output)"),
              });
            });
            const onAbort = () => {
              clearTimeout(timer);
              killShell();
              settle({ ok: false, exitCode: -1, output: "已中断（暂停或取消）" });
            };
            if (abortSignal?.aborted) {
              onAbort();
            } else {
              abortSignal?.addEventListener("abort", onAbort, { once: true });
            }
            child.stdout?.on("data", (chunk) => appendChunk(String(chunk), false));
            child.stderr?.on("data", (chunk) => appendChunk(String(chunk), true));
          });
        }, abortSignal);
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
        skillId: z
          .string()
          .describe('Skill name (e.g. "coder") or skill directory id from the available-skills list.'),
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
        "Search the web. Tries configured API providers (Tavily/Bocha/Serper) first, then falls back to free scraping " +
        "(DuckDuckGo, Bing). Returns top results with title/url/snippet and which provider produced them; results are " +
        "also listed in the UI References section. Follow up with webFetch to read a promising result.",
      inputSchema: z.object({
        query: z.string().describe("Search query in the user's language when possible."),
      }),
      execute: async ({ query }) => {
        const outcome = await searchWeb(query, { apiKeys: config.webSearchApiKeys });
        for (const reference of outcome.results) {
          emit({
            type: "reference_found",
            sessionId,
            reference: { ...reference, source: "web" },
          });
        }
        if (!outcome.results.length) {
          return { query, provider: outcome.provider, results: [], note: "no results" };
        }
        return {
          query,
          provider: outcome.provider,
          results: outcome.results.map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.snippet,
          })),
        };
      },
    }),
    webFetch: tool({
      description:
        "Fetch a web page and return its main content as markdown (paginated). Use after webSearch to read a result. " +
        "Long pages return a slice plus nextStartIndex — pass it back as startIndex to continue reading. " +
        "Do not fetch login-walled or paywalled pages; PDFs/images are not supported (use browser tools instead).",
      inputSchema: z.object({
        url: z.string().describe("http(s) URL to fetch"),
        startIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Character offset from a previous read's nextStartIndex."),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(50_000)
          .optional()
          .describe("Max characters to return (default 10000)."),
      }),
      execute: async ({ url, startIndex, maxChars }) => runWebFetch(url, { startIndex, maxChars }),
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
      execute: async ({ url }, { abortSignal }) =>
        exclusive(runtime, "browser", () => browserBridge.open(url), abortSignal),
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
      execute: async ({ selector }, { abortSignal }) =>
        exclusive(runtime, "browser", () => browserBridge.click(selector), abortSignal),
    });
    toolSet.browserType = tool({
      description: "Type text into a browser form field by CSS selector.",
      inputSchema: z.object({
        selector: z.string(),
        text: z.string(),
        submit: z.boolean().optional().describe("Submit the form after typing"),
      }),
      execute: async ({ selector, text, submit }, { abortSignal }) =>
        exclusive(runtime, "browser", () => browserBridge.type(selector, text, { submit }), abortSignal),
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
      execute: async (_, { abortSignal }) =>
        exclusive(runtime, "browser", () => browserBridge.screenshot(), abortSignal),
    });
    toolSet.browserEvaluate = tool({
      description:
        "Evaluate a JS expression in the browser page context and return the value. Use sparingly.",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }, { abortSignal }) =>
        exclusive(runtime, "browser", () => browserBridge.evaluate(expression), abortSignal),
    });
  }

  // CUA 桌面自动化（desktop 注入 cuaBridge 时注册；权限系统按 exec 风险逐次确认）
  const cuaBridge = config.cuaBridge;
  if (cuaBridge) {
    toolSet.cuaStatus = tool({
      description:
        "Check desktop automation availability (backend: macOS CGEvent tool / Windows PowerShell / Linux xdotool).",
      inputSchema: z.object({}),
      execute: async () => cuaBridge.status(),
    });
    toolSet.cuaScreenSize = tool({
      description:
        "Get the primary display size in DIP pixels. Use before computing mouse coordinates.",
      inputSchema: z.object({}),
      execute: async () => cuaBridge.screenSize(),
    });
    toolSet.cuaMouseMove = tool({
      description: "Move the mouse cursor to (x, y) on the primary display.",
      inputSchema: z.object({
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      }),
      execute: async ({ x, y }) => cuaBridge.mouseMove(x, y),
    });
    toolSet.cuaMouseClick = tool({
      description:
        "Click the mouse. Defaults to left button at the current position; pass x/y to move first.",
      inputSchema: z.object({
        button: z.enum(["left", "right", "middle"]).optional().describe("Default left"),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      execute: async ({ button, x, y }) => cuaBridge.mouseClick(button, x, y),
    });
    toolSet.cuaKeyboardType = tool({
      description: "Type a text string at the current keyboard focus.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => cuaBridge.keyboardType(text),
    });
    toolSet.cuaKey = tool({
      description:
        'Press a key or hotkey, e.g. "enter", "tab", "esc", "ctrl+c", "cmd+shift+3".',
      inputSchema: z.object({
        key: z
          .string()
          .describe(
            'Key name, optionally with modifiers joined by "+": ctrl/alt/shift/cmd(meta/win) + key name.',
          ),
      }),
      execute: async ({ key }) => cuaBridge.keyboardKey(key),
    });
  }

  // MCP 工具动态桥接：mcp__<server>__<tool>（Anthropic 等协议要求工具名匹配
  // ^[a-zA-Z0-9_-]+$，点号非法；描述里保留 [MCP server.tool] 原名供展示）
  const usedMcpNames = new Set<string>();
  for (const bridge of config.mcpTools ?? []) {
    let wireName = mcpToolWireName(bridge.serverName, bridge.name);
    // 净化/截断可能撞名：序号后缀去重，避免后注册的静默覆盖前者
    for (let seq = 2; usedMcpNames.has(wireName); seq += 1) {
      const suffix = `_${seq}`;
      wireName = wireName.slice(0, MCP_TOOL_NAME_MAX - suffix.length) + suffix;
    }
    usedMcpNames.add(wireName);
    toolSet[wireName] = tool({
      description: bridge.description
        ? `[MCP ${bridge.serverName}.${bridge.name}] ${bridge.description}`
        : `[MCP ${bridge.serverName}.${bridge.name}] ${bridge.name}`,
      inputSchema: jsonSchema(bridge.inputSchema),
      execute: async (input: unknown) => {
        const { callMcpTool } = await importMcpRuntime();
        const result = await callMcpTool(bridge.serverName, bridge.name, input);
        if (!result.ok) {
          throw new Error(result.error ?? "MCP tool failed");
        }
        // MCP Apps（SEP-1865）：结果带 HTML 资源时返回 { output, html } 对象，
        // 渲染层据此用沙箱 iframe 展示交互 UI；output 字段仍是给模型看的文本
        if (result.html) {
          return { output: result.text, html: capMcpAppHtml(result.html) } satisfies McpAppToolOutput;
        }
        return result.text;
      },
    });
  }

  // 统一输出上限：在工具集完全组装完（multiAgent/browser/MCP 都已并入）后包装 execute，
  // 超长 string 截断并附说明；非 string 结果（对象）原样放行
  for (const name of Object.keys(toolSet)) {
    const toolDef = toolSet[name] as { execute?: ToolExecute };
    const originalExecute = toolDef.execute;
    if (!originalExecute) {
      continue;
    }
    toolDef.execute = async (input, options) => {
      const result = await originalExecute(input, options);
      if (typeof result !== "string" || result.length <= MAX_TOOL_RESULT_CHARS) {
        return result;
      }
      const note =
        `\n\n[工具输出已截断：原始 ${result.length} 字符，仅保留前 ${MAX_TOOL_RESULT_CHARS}；` +
        `请缩小查询范围或分次读取获取完整信息]`;
      return result.slice(0, MAX_TOOL_RESULT_CHARS) + note;
    };
  }

  return toolSet;
}

async function importMcpRuntime(): Promise<{
  callMcpTool(
    serverName: string,
    toolName: string,
    args: unknown,
  ): Promise<{ ok: boolean; text: string; error?: string; html?: string }>;
}> {
  const mod = await import("./mcp-runtime");
  return mod.importMcpRuntime();
}

/**
 * 用户 shell 环境快照：GUI 启动的 Electron 主进程继承的是 launchd/systemd 环境，
 * 缺 ~/.zshrc 等交互配置里的 PATH（nvm/homebrew/自定义 bin），runTerminal 因此
 * 高频 "command not found"。用登录+交互 shell 跑一次 env，取白名单键，进程内缓存。
 * 快照失败/超时一律返回空对象（回退 process.env，行为不劣于旧实现）。
 */
const SHELL_ENV_KEYS = new Set([
  "PATH",
  "MANPATH",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
]);
let shellEnvSnapshot: Promise<Record<string, string>> | null = null;

function captureShellEnv(): Promise<Record<string, string>> {
  if (process.platform === "win32") {
    // Windows GUI 进程从注册表拿到用户 PATH，无需快照
    return Promise.resolve({});
  }
  const shell = resolveDefaultShell();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: Record<string, string>) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell.path, ["-l", "-i", "-c", "env"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish({});
      return;
    }
    // 病态 profile 可能挂住（如等待输入）：5s 超时放弃，回退默认 env
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({});
    }, 5000);
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (out.length < 1024 * 1024) {
        out += chunk.toString("utf8");
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish({});
    });
    child.on("close", () => {
      clearTimeout(timer);
      const env: Record<string, string> = {};
      for (const line of out.split("\n")) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
        const key = match?.[1];
        if (match && key && SHELL_ENV_KEYS.has(key)) {
          env[key] = match[2] ?? "";
        }
      }
      finish(env);
    });
  });
}

function getShellEnvSnapshot(): Promise<Record<string, string>> {
  if (!shellEnvSnapshot) {
    shellEnvSnapshot = captureShellEnv().catch(() => ({}));
  }
  return shellEnvSnapshot;
}

/**
 * runTerminal 命令 spawn：POSIX 用用户登录 shell（$SHELL）-c 执行——shell:true
 * 固定 /bin/sh，bashism/用户别名全部失效；PATH 等来自 shell 环境快照。
 * shell 路径逐级回退（$SHELL → /bin/zsh|bash → /bin/sh），Windows 保持 cmd shell:true。
 */
function spawnAgentCommand(
  cwd: string,
  command: string,
  shellEnv: Record<string, string>,
): ReturnType<typeof spawn> {
  const env = Object.keys(shellEnv).length ? { ...process.env, ...shellEnv } : process.env;
  const stdio: Array<"ignore" | "pipe"> = ["ignore", "pipe", "pipe"];
  if (process.platform !== "win32") {
    const fallbacks =
      process.platform === "darwin"
        ? [resolveDefaultShell().path, "/bin/zsh", "/bin/bash", "/bin/sh"]
        : [resolveDefaultShell().path, "/bin/bash", "/bin/sh"];
    const shellPath = fallbacks.find((candidate) => candidate && existsSync(candidate));
    if (shellPath) {
      return spawn(shellPath, ["-c", command], {
        cwd,
        detached: true,
        windowsHide: true,
        env,
        stdio,
      });
    }
  }
  return spawn(command, { cwd, shell: true, detached: true, windowsHide: true, env, stdio });
}

/** MCP Apps HTML 上限：超长 UI 截断（事件/持久化都不会被巨幅 HTML 撑爆） */
const MAX_MCP_APP_HTML_CHARS = 100_000;

function capMcpAppHtml(html: string): string {
  if (html.length <= MAX_MCP_APP_HTML_CHARS) {
    return html;
  }
  return `${html.slice(0, MAX_MCP_APP_HTML_CHARS)}\n<!-- zen: MCP App HTML 超长已截断（原始 ${html.length} 字符） -->`;
}
