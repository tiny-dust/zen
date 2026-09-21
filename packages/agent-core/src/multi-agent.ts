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

/** 子 Agent 并发上限，避免模型/API/文件系统资源被并行打爆 */
export const MAX_CONCURRENT_SUBAGENTS = 2;

/** 子 Agent 单次执行超时：超时自动取消本轮，交回编排器按重试策略处理 */
export const SUB_AGENT_TIMEOUT_MS = 10 * 60_000;

const MAX_LOG_LINES = 40;
const MAX_RETRY = 2;

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
  }) => Promise<{ ok: boolean; text: string; error?: string }>;
  emit: (event: AgentStreamEvent) => void;
  resourceLock: ResourceLock;
  concurrencyLimit?: number;
  /** 子 Agent 单次执行超时（毫秒），缺省 SUB_AGENT_TIMEOUT_MS */
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
 */
export class MultiAgentOrchestrator {
  private readonly deps: MultiAgentDeps;
  private readonly nodes = new Map<string, AgentNodeState>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly limit: number;
  private readonly timeoutMs: number;
  private pumping = false;
  private disposed = false;

  constructor(deps: MultiAgentDeps) {
    this.deps = deps;
    this.limit = deps.concurrencyLimit ?? MAX_CONCURRENT_SUBAGENTS;
    this.timeoutMs = deps.subAgentTimeoutMs ?? SUB_AGENT_TIMEOUT_MS;
    deps.resourceLock.onHold = (ownerId, label) => {
      for (const agent of this.nodes.values()) {
        if (agent.status === "running") {
          agent.busyResource = agent.id === ownerId ? (label ?? null) : null;
        } else if (agent.busyResource) {
          agent.busyResource = null;
        }
      }
      this.emitTree();
    };
  }

  private get runningCount(): number {
    let n = 0;
    for (const node of this.nodes.values()) {
      if (node.status === "running") {
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
      status: dependsOn.length ? "waiting" : "queued",
      dependsOn,
      attempts: 0,
      maxAttempts: Math.min(Math.max(input.maxAttempts ?? 1, 1), MAX_RETRY + 1),
      log: [],
      busyResource: null,
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
          if (agent.status === "waiting" && this.hasFailedDependency(agent)) {
            agent.status = "error";
            agent.error = "依赖的子任务失败，未执行";
            agent.endedAt = now();
            this.appendLog(agent, agent.error);
            this.emitStatus(agent);
          } else if (agent.status === "waiting" && this.dependenciesMet(agent)) {
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
    if (agent.status !== "queued") {
      return;
    }
    agent.status = "running";
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
      // 超时兜底：子任务挂死时中断本轮，按可重试失败处理
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          // 中断子会话（runChild 内部监听 signal 并取消子 Agent）
          controller.abort();
          resolve("timeout");
        }, this.timeoutMs);
      });
      try {
        const raced = await Promise.race([
          this.deps.runChild({
            agentId: agent.id,
            name: agent.name,
            task: agent.task,
            signal: controller.signal,
            onLog: (text) => {
              this.appendLog(agent, text);
              this.emitStatus(agent);
            },
          }),
          timeoutPromise,
        ]);
        if (raced === "timeout") {
          const message = `子任务执行超时（超过 ${Math.round(this.timeoutMs / 60_000)} 分钟），已自动取消`;
          agent.error = message;
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
          agent.endedAt = now();
          this.appendLog(agent, agent.error);
          return;
        }
        if (result.ok) {
          agent.status = "done";
          agent.reason = "stop";
          agent.result = truncate(result.text, 2000);
          agent.endedAt = now();
          this.appendLog(agent, "执行完成");
          return;
        }
        agent.error = result.error || "子任务失败";
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
        agent.error = error instanceof Error ? error.message : String(error);
        agent.status = controller.signal.aborted && !timedOut ? "cancelled" : "error";
        agent.reason = controller.signal.aborted && !timedOut ? "cancelled" : "error";
        agent.endedAt = now();
        this.appendLog(agent, `异常：${agent.error}`);
      } finally {
        if (timeoutTimer != null) {
          clearTimeout(timeoutTimer);
        }
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
      const pending = targets.filter(
        (item) =>
          item.status === "queued" ||
          item.status === "running" ||
          item.status === "waiting",
      );
      if (!pending.length) {
        return this.collect(ids);
      }
      await this.pump();
      await Promise.all(
        pending.map((item) => this.runs.get(item.id) ?? Promise.resolve()),
      );
      await new Promise((r) => setTimeout(r, 50));
      if (this.disposed) {
        return this.collect(ids);
      }
    }
  }

  async cancelAll(): Promise<void> {
    for (const agent of this.nodes.values()) {
      if (agent.status === "queued" || agent.status === "waiting" || agent.status === "running") {
        agent.status = "cancelled";
        agent.reason = "cancelled";
        agent.error = "主会话已取消";
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
    const tools: ToolSet = {
      spawnAgent: tool({
        description:
          "Spawn a sub-agent for a focused subtask. Use dependsOn to sequence work. Results appear in the right Agents panel. Max concurrent sub-agents is limited; exclusive resources (write/terminal/browser) are serialized.",
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
        description: "List main/sub agents and their statuses for this session.",
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
            hasResult: Boolean(item.result),
          }));
        },
      }),
      waitForAgents: tool({
        description:
          "Wait until the given sub-agents (or all) reach a terminal state, then return their status list.",
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
