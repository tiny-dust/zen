import type {
  AgentNodeState,
  AgentStreamEvent,
  AgentTreeSnapshot,
  SubAgentStatus,
} from "@zen/shared";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { ResourceLock } from "./resource-lock";
import { multiAgentInstructions, subAgentInstructions } from "./multi-agent-instructions";

/**
 * DESIGN — 多 Agent 调度 / 保活 / 超时 / 多问询
 *
 * ## 超时策略（空闲超时 + 绝对上限）
 * - 空闲超时 `subAgentIdleTimeoutMs`（默认 4 分钟）：仅在「无进展且不在合法等待」时计时。
 *   进展 = onProgress（onLog / tool_start / tool_end / usage / ask 等）。
 *   合法等待 = 工具执行中（onToolRunning）/ 等待用户回答（onWaitingUser）/ 等审批。
 *   空闲到点 abort 本轮，按可重试失败处理。
 * - 绝对上限 `subAgentMaxDurationMs`（默认 45 分钟）：本轮 start 起墙钟，防真挂死
 *   （含用户长期不回答）。到点强制 abort。
 * - 保活：任何 onProgress 重置空闲计时；工具执行中 / waiting_user 暂停空闲计时。
 *
 * ## 多问询模型（多个 ask 并存，按 askId 独立 resolve）
 * - AgentSession.pendingAsks 为 Map<askId, PendingAsk>，支持同会话/多子 Agent 并发 ask。
 * - 子 Agent 的 ask_user 改写 sessionId 为父会话并附 agentName 上抛，UI 并行渲染多张 AskUserCard。
 * - 父会话 resolveAsk(askId) 先查自身，再递归子会话；回答一个推进一个，禁止覆盖丢卡。
 * - UI 侧 pendingAsks 数组，ask_resolved 按 askId 摘除。
 *
 * ## 状态机（SubAgentStatus）
 * waiting_deps → queued → running ⇄ waiting_user → done | error | cancelled
 * running / waiting_user 占用并发槽；waiting_user 不得显示成假「运行中」。
 */

/** 子 Agent 并发上限，避免模型/API/文件系统资源被并行打爆 */
export const MAX_CONCURRENT_SUBAGENTS = 2;

/** 子 Agent 空闲超时：无进展且不在等用户/跑工具时超过该时长取消本轮 */
export const SUB_AGENT_IDLE_TIMEOUT_MS = 4 * 60_000;

/** 子 Agent 绝对执行上限：防真挂死（含等用户过久） */
export const SUB_AGENT_MAX_DURATION_MS = 45 * 60_000;

/** @deprecated 旧固定硬超时；请用 SUB_AGENT_IDLE_TIMEOUT_MS / SUB_AGENT_MAX_DURATION_MS */
export const SUB_AGENT_TIMEOUT_MS = SUB_AGENT_IDLE_TIMEOUT_MS;

const MAX_LOG_LINES = 40;
const MAX_RETRY = 2;

const TERMINAL_STATUSES = new Set<SubAgentStatus>(["done", "error", "cancelled"]);

export { ResourceLock, multiAgentInstructions, subAgentInstructions };

export interface MultiAgentDeps {
  parentSessionId: string;
  /** 创建并运行一个子 Agent 会话；返回最终 assistant 文本 */
  runChild: (spec: {
    agentId: string;
    name: string;
    task: string;
    signal: AbortSignal;
    onLog: (text: string) => void;
    /** 进展保活：日志 / 工具 / usage / ask 等都应调用，重置空闲计时 */
    onProgress: () => void;
    /** 工具执行中 true（期间暂停空闲计时，长命令/等锁不被误杀）；成对 start/end 用计数收敛 */
    onToolRunning: (running: boolean) => void;
    /** askUser 等待用户回答；true 时标记 waiting_user 并暂停空闲计时 */
    onWaitingUser: (waiting: boolean) => void;
  }) => Promise<{ ok: boolean; text: string; error?: string }>;
  emit: (event: AgentStreamEvent) => void;
  resourceLock: ResourceLock;
  concurrencyLimit?: number;
  /** 空闲超时（毫秒），缺省 SUB_AGENT_IDLE_TIMEOUT_MS */
  subAgentIdleTimeoutMs?: number;
  /** 绝对执行上限（毫秒），缺省 SUB_AGENT_MAX_DURATION_MS */
  subAgentMaxDurationMs?: number;
  /** @deprecated 兼容旧字段：等价于 subAgentIdleTimeoutMs */
  subAgentTimeoutMs?: number;
}

function now(): number {
  return Date.now();
}

function truncate(text: string, limit = 400): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 多 Agent 协作编排器：
 * - 任务拆分（spawn）→ 依赖等待 → 有限并发执行 → 失败重试 → 结果汇总
 * - 独占资源（写/终端/浏览器）经 ResourceLock 串行化
 * - 空闲超时 + 绝对上限；等待用户 / 跑工具时保活
 */
export class MultiAgentOrchestrator {
  private readonly deps: MultiAgentDeps;
  private readonly nodes = new Map<string, AgentNodeState>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly limit: number;
  private readonly idleTimeoutMs: number;
  private readonly maxDurationMs: number;
  private pumping = false;
  private disposed = false;

  constructor(deps: MultiAgentDeps) {
    this.deps = deps;
    this.limit = deps.concurrencyLimit ?? MAX_CONCURRENT_SUBAGENTS;
    this.idleTimeoutMs =
      deps.subAgentIdleTimeoutMs ?? deps.subAgentTimeoutMs ?? SUB_AGENT_IDLE_TIMEOUT_MS;
    this.maxDurationMs = deps.subAgentMaxDurationMs ?? SUB_AGENT_MAX_DURATION_MS;
    deps.resourceLock.onHold = (ownerId, label) => {
      for (const agent of this.nodes.values()) {
        if (agent.status === "running" || agent.status === "waiting_user") {
          agent.busyResource = agent.id === ownerId ? (label ?? null) : null;
        } else if (agent.busyResource) {
          agent.busyResource = null;
        }
      }
      this.emitTree();
    };
  }

  /** 占用并发槽：running 与 waiting_user 都算 */
  private get runningCount(): number {
    let n = 0;
    for (const node of this.nodes.values()) {
      if (node.status === "running" || node.status === "waiting_user") {
        n += 1;
      }
    }
    return n;
  }

  private concurrency() {
    return { limit: this.limit, running: this.runningCount };
  }

  snapshot(): AgentTreeSnapshot {
    return {
      sessionId: this.deps.parentSessionId,
      agents: [...this.nodes.values()].map((node) => ({
        ...node,
        log: [...node.log],
        dependsOn: [...node.dependsOn],
      })),
      concurrency: this.concurrency(),
    };
  }

  private emitTree(): void {
    this.deps.emit({
      type: "agent_tree",
      sessionId: this.deps.parentSessionId,
      agents: this.snapshot().agents,
      concurrency: this.concurrency(),
    });
  }

  private emitStatus(agent: AgentNodeState): void {
    this.deps.emit({
      type: "agent_status",
      sessionId: this.deps.parentSessionId,
      agent: { ...agent, log: [...agent.log], dependsOn: [...agent.dependsOn] },
      concurrency: this.concurrency(),
    });
  }

  private appendLog(agent: AgentNodeState, text: string): void {
    agent.log.push({ t: now(), text: truncate(text, 240) });
    if (agent.log.length > MAX_LOG_LINES) {
      agent.log.splice(0, agent.log.length - MAX_LOG_LINES);
    }
  }

  spawn(input: {
    name: string;
    task: string;
    dependsOn?: string[];
    maxAttempts?: number;
  }): AgentNodeState {
    const id = `sub-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dependsOn = (input.dependsOn ?? []).filter((dep) => this.nodes.has(dep));
    const agent: AgentNodeState = {
      id,
      sessionId: this.deps.parentSessionId,
      parentId: null,
      name: input.name.trim() || `子任务 ${this.nodes.size + 1}`,
      task: input.task.trim(),
      status: dependsOn.length ? "waiting_deps" : "queued",
      dependsOn,
      attempts: 0,
      maxAttempts: Math.min(Math.max(input.maxAttempts ?? 1, 1), MAX_RETRY + 1),
      log: [],
      busyResource: null,
      waitingUser: false,
    };
    this.appendLog(agent, "已创建，等待调度");
    this.nodes.set(id, agent);
    this.emitStatus(agent);
    this.emitTree();
    void this.pump();
    return { ...agent };
  }

  list(): AgentNodeState[] {
    return this.snapshot().agents;
  }

  private dependenciesMet(agent: AgentNodeState): boolean {
    return agent.dependsOn.every((depId) => this.nodes.get(depId)?.status === "done");
  }

  private hasFailedDependency(agent: AgentNodeState): boolean {
    return agent.dependsOn.some((depId) => {
      const dep = this.nodes.get(depId);
      return dep && (dep.status === "error" || dep.status === "cancelled");
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) {
      return;
    }
    this.pumping = true;
    try {
      for (;;) {
        if (this.disposed) {
          return;
        }
        // 依赖失败 → 自身失败
        for (const agent of this.nodes.values()) {
          if (agent.status === "waiting_deps" && this.hasFailedDependency(agent)) {
            agent.status = "error";
            agent.error = "依赖的子任务失败，未执行";
            agent.endedAt = now();
            this.appendLog(agent, agent.error);
            this.emitStatus(agent);
          } else if (agent.status === "waiting_deps" && this.dependenciesMet(agent)) {
            agent.status = "queued";
            this.appendLog(agent, "依赖已满足，进入队列");
            this.emitStatus(agent);
          }
        }
        if (this.runningCount >= this.limit) {
          return;
        }
        const next = [...this.nodes.values()].find((item) => item.status === "queued");
        if (!next) {
          return;
        }
        void this.runOne(next);
        // 让 runOne 先把状态改为 running，再继续下一轮
        await Promise.resolve();
        if (this.runningCount >= this.limit) {
          // 继续循环以便其它 queued 在空位时启动；此处再 await 一拍避免忙等
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runOne(agent: AgentNodeState): Promise<void> {
    if (agent.status !== "queued" || this.disposed) {
      return;
    }
    agent.status = "running";
    agent.waitingUser = false;
    agent.attempts += 1;
    agent.startedAt = agent.startedAt ?? now();
    agent.endedAt = undefined;
    agent.error = undefined;
    this.appendLog(agent, `开始执行（第 ${agent.attempts}/${agent.maxAttempts} 次）`);
    this.emitStatus(agent);
    this.emitTree();

    const controller = new AbortController();
    this.aborts.set(agent.id, controller);

    const promise = (async () => {
      // 空闲超时 + 绝对上限：合法等待（工具中 / 等用户）暂停空闲计时
      type RaceOutcome =
        | { type: "result"; ok: boolean; text: string; error?: string }
        | { type: "timeout"; kind: "idle" | "max" };
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      let timedOut: "idle" | "max" | null = null;
      let toolBusy = false;
      let waitingUser = false;
      let finished = false;
      let resolveTimeout: ((value: RaceOutcome) => void) | null = null;

      const timeoutPromise = new Promise<RaceOutcome>((resolve) => {
        resolveTimeout = resolve;
      });
      const clearIdle = () => {
        if (idleTimer != null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      };
      const fireTimeout = (kind: "idle" | "max") => {
        if (timedOut || finished) {
          return;
        }
        timedOut = kind;
        controller.abort();
        resolveTimeout?.({ type: "timeout", kind });
      };
      /** 重置空闲计时（保活）；合法等待时不武装 */
      const touch = () => {
        clearIdle();
        if (finished || toolBusy || waitingUser || timedOut) {
          return;
        }
        idleTimer = setTimeout(() => fireTimeout("idle"), this.idleTimeoutMs);
      };

      touch();
      maxTimer = setTimeout(() => fireTimeout("max"), this.maxDurationMs);

      const setWaitingUser = (waiting: boolean) => {
        if (finished || waitingUser === waiting) {
          return;
        }
        waitingUser = waiting;
        agent.waitingUser = waiting;
        if (waiting) {
          agent.status = "waiting_user";
          this.appendLog(agent, "等待用户回答");
          clearIdle();
        } else if (agent.status === "waiting_user") {
          agent.status = "running";
          this.appendLog(agent, "已收到用户回答");
          touch();
        }
        this.emitStatus(agent);
        this.emitTree();
      };

      const setToolRunning = (running: boolean) => {
        if (finished || toolBusy === running) {
          return;
        }
        toolBusy = running;
        if (running) {
          clearIdle();
        } else {
          touch();
        }
      };

      try {
        const raced = await Promise.race([
          this.deps
            .runChild({
              agentId: agent.id,
              name: agent.name,
              task: agent.task,
              signal: controller.signal,
              onLog: (text) => {
                this.appendLog(agent, text);
                touch();
                this.emitStatus(agent);
              },
              onProgress: () => touch(),
              onToolRunning: setToolRunning,
              onWaitingUser: setWaitingUser,
            })
            .then((result): RaceOutcome => ({ type: "result", ...result }))
            .catch((error): RaceOutcome => ({
              type: "result",
              ok: false,
              text: "",
              error: error instanceof Error ? error.message : String(error),
            })),
          timeoutPromise,
        ]);
        finished = true;
        clearIdle();
        if (maxTimer != null) {
          clearTimeout(maxTimer);
          maxTimer = null;
        }
        if (raced.type === "timeout") {
          const message =
            raced.kind === "idle"
              ? `子任务空闲超时（${Math.round(this.idleTimeoutMs / 60_000)} 分钟无进展），已自动取消`
              : `子任务执行超时（超过最长执行时间 ${Math.round(this.maxDurationMs / 60_000)} 分钟），已自动取消`;
          agent.error = message;
          agent.waitingUser = false;
          this.appendLog(agent, message);
          if (agent.attempts < agent.maxAttempts) {
            agent.status = "queued";
            this.appendLog(agent, "将重试");
            return;
          }
          agent.status = "error";
          agent.reason = "error";
          agent.endedAt = now();
          return;
        }
        const result = raced;
        if (controller.signal.aborted && !result.ok) {
          agent.status = "cancelled";
          agent.reason = "cancelled";
          agent.error = result.error || "已取消";
          agent.waitingUser = false;
          agent.endedAt = now();
          this.appendLog(agent, agent.error);
          return;
        }
        if (result.ok) {
          agent.status = "done";
          agent.reason = "stop";
          agent.waitingUser = false;
          agent.result = truncate(result.text, 2000);
          agent.endedAt = now();
          this.appendLog(agent, "执行完成");
          return;
        }
        agent.error = result.error || "子任务失败";
        agent.waitingUser = false;
        this.appendLog(agent, `失败：${agent.error}`);
        if (agent.attempts < agent.maxAttempts && !controller.signal.aborted) {
          agent.status = "queued";
          this.appendLog(agent, "将重试");
          return;
        }
        agent.status = "error";
        agent.reason = "error";
        agent.endedAt = now();
      } catch (error) {
        finished = true;
        clearIdle();
        if (maxTimer != null) {
          clearTimeout(maxTimer);
          maxTimer = null;
        }
        agent.waitingUser = false;
        if (timedOut) {
          const message =
            timedOut === "idle"
              ? `子任务空闲超时（${Math.round(this.idleTimeoutMs / 60_000)} 分钟无进展），已自动取消`
              : `子任务执行超时（超过最长执行时间 ${Math.round(this.maxDurationMs / 60_000)} 分钟），已自动取消`;
          agent.error = message;
          this.appendLog(agent, message);
          if (agent.attempts < agent.maxAttempts) {
            agent.status = "queued";
            this.appendLog(agent, "将重试");
          } else {
            agent.status = "error";
            agent.reason = "error";
            agent.endedAt = now();
          }
          return;
        }
        agent.error = error instanceof Error ? error.message : String(error);
        agent.status = controller.signal.aborted ? "cancelled" : "error";
        agent.reason = controller.signal.aborted ? "cancelled" : "error";
        agent.endedAt = now();
        this.appendLog(agent, `异常：${agent.error}`);
      } finally {
        finished = true;
        clearIdle();
        if (maxTimer != null) {
          clearTimeout(maxTimer);
          maxTimer = null;
        }
        agent.waitingUser = false;
        this.aborts.delete(agent.id);
        this.emitStatus(agent);
        this.emitTree();
        void this.pump();
      }
    })();
    this.runs.set(agent.id, promise);
    await promise;
    this.runs.delete(agent.id);
  }

  /** 汇总结果：供主 Agent 的 collectAgentResults / waitForAgents 使用 */
  collect(ids?: string[]): AgentNodeState[] {
    const list = ids?.length
      ? ids.map((id) => this.nodes.get(id)).filter((item): item is AgentNodeState => Boolean(item))
      : this.list();
    return list;
  }

  async waitForAgents(ids?: string[]): Promise<AgentNodeState[]> {
    const targets = ids?.length
      ? ids.map((id) => this.nodes.get(id)).filter((item): item is AgentNodeState => Boolean(item))
      : [...this.nodes.values()];
    // 依赖仍 waiting 的先 pump
    await this.pump();
    for (;;) {
      if (this.disposed) {
        return this.collect(ids);
      }
      const pending = targets.filter((item) => !TERMINAL_STATUSES.has(item.status));
      if (!pending.length) {
        return this.collect(ids);
      }
      await this.pump();
      if (this.disposed) {
        return this.collect(ids);
      }
      await Promise.all(
        pending.map((item) => this.runs.get(item.id) ?? Promise.resolve()),
      );
      if (this.disposed) {
        return this.collect(ids);
      }
      // 仍有非终态（如仅 waiting_deps 未入队）时短轮询，避免死等
      const still = targets.filter((item) => !TERMINAL_STATUSES.has(item.status));
      if (still.some((item) => this.runs.has(item.id))) {
        continue;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async cancelAll(): Promise<void> {
    for (const agent of this.nodes.values()) {
      if (!TERMINAL_STATUSES.has(agent.status)) {
        agent.status = "cancelled";
        agent.reason = "cancelled";
        agent.error = "主会话已取消";
        agent.waitingUser = false;
        agent.endedAt = now();
        this.appendLog(agent, agent.error);
        this.emitStatus(agent);
      }
    }
    for (const controller of this.aborts.values()) {
      controller.abort();
    }
    this.aborts.clear();
    this.emitTree();
  }

  dispose(): void {
    this.disposed = true;
    void this.cancelAll();
  }

  /** 主 Agent 可用的协作工具集 */
  buildTools(): ToolSet {
    const idleMin = Math.max(1, Math.round(this.idleTimeoutMs / 60_000));
    const maxMin = Math.max(1, Math.round(this.maxDurationMs / 60_000));
    const tools: ToolSet = {
      spawnAgent: tool({
        description:
          "Spawn a sub-agent for a focused subtask. Use dependsOn to sequence work. Results appear in the right Agents panel. Max concurrent sub-agents is limited; exclusive resources (write/terminal/browser) are serialized. " +
          `Sub-agents are cancelled after ~${idleMin}m without progress or ${maxMin}m total; tool use and waiting for user answers keep them alive. ` +
          "If a sub-agent asks the user a question, answer that ask card; it resumes automatically.",
        inputSchema: z.object({
          name: z.string().describe("Short display name for the sub-agent."),
          task: z.string().describe("Self-contained task description for the sub-agent."),
          dependsOn: z
            .array(z.string())
            .optional()
            .describe("Sub-agent ids that must finish successfully before this one runs."),
          maxAttempts: z
            .number()
            .optional()
            .describe("Retry attempts on failure (1-3, default 1)."),
        }),
        execute: async (input) => {
          const node = this.spawn(input);
          return {
            id: node.id,
            name: node.name,
            status: node.status,
            dependsOn: node.dependsOn,
          };
        },
      }),
      listAgents: tool({
        description:
          "List main/sub agents and their statuses for this session. status waiting_user means the agent is blocked on an askUser question.",
        inputSchema: z.object({}),
        execute: async () => {
          return this.list().map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            task: item.task,
            attempts: item.attempts,
            dependsOn: item.dependsOn,
            error: item.error,
            waitingUser: item.waitingUser ?? item.status === "waiting_user",
            hasResult: Boolean(item.result),
          }));
        },
      }),
      waitForAgents: tool({
        description:
          "Wait until the given sub-agents (or all) reach a terminal state, then return their status list. Agents waiting on user answers stay pending until those asks are answered.",
        inputSchema: z.object({
          ids: z.array(z.string()).optional().describe("Sub-agent ids; omit to wait for all."),
        }),
        execute: async ({ ids }) => {
          const nodes = await this.waitForAgents(ids);
          return nodes.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            error: item.error,
            result: item.result,
          }));
        },
      }),
      collectAgentResults: tool({
        description:
          "Collect sub-agent results for aggregation. Prefer this after waitForAgents.",
        inputSchema: z.object({
          ids: z.array(z.string()).optional().describe("Sub-agent ids; omit for all."),
        }),
        execute: async ({ ids }) => {
          const nodes = this.collect(ids);
          return nodes.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            task: item.task,
            result: item.result ?? "",
            error: item.error ?? "",
          }));
        },
      }),
    };
    return tools;
  }
}

export type { SubAgentStatus };
