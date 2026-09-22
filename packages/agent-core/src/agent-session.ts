import { isStepCount, ToolLoopAgent } from "ai";

import type { ModelMessage } from "ai";
import type {
  AgentDoneReason,
  AgentStreamEvent,
  ChatTurn,
  ToolApprovalDecision,
  ToolCallState,
} from "@zen/shared";
import { buildProviderOptions, createLanguageModel } from "./agent-model";
import { buildToolSet } from "./agent-tools";
import type { ToolHooks } from "./agent-tools";
import { evaluateApproval, riskForTool } from "./agent-approval";
import { buildInstructions } from "./agent-config";
import type { AgentSessionConfig } from "./agent-config";
import { errorMessage, MAX_RUN_STEPS } from "./agent-parts";
import type { PendingApproval, PendingAsk } from "./agent-parts";
import { processStreamPart } from "./agent-stream";
import type { StreamPartState } from "./agent-stream";
import { subAgentInstructions } from "./multi-agent-instructions";
import { MultiAgentOrchestrator, ResourceLock } from "./multi-agent";

/** 附件图片（data-url），支持视觉的模型按原生多模态 part 随用户消息发出 */
export interface AgentImageAttachment {
  name: string;
  dataUrl: string;
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
  /** askUser 挂起等待（askId → resolver）；支持同会话多问询并发 */
  private readonly pendingAsks = new Map<string, PendingAsk>();
  /** 会话内已放行的工具（「全部允许」记忆；网络类确认一次后同样放行） */
  private readonly rememberedTools = new Set<string>();
  /** 多 Agent：写/终端/浏览器互斥（子会话必须共用父锁）+ 编排器（主会话） */
  private readonly resourceLock: ResourceLock;
  private readonly orchestrator: MultiAgentOrchestrator | null;
  /** 活跃子会话（agentId → session），resolveAsk 按 askId 路由到子会话 */
  private readonly childSessions = new Map<string, AgentSession>();

  constructor(config: AgentSessionConfig) {
    this.config = config;
    this.resourceLock = config.resourceLock ?? new ResourceLock();
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
        ownerLabel: config.ownerLabel ?? config.sessionId,
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
    onProgress: () => void;
    onToolRunning: (running: boolean) => void;
    onWaitingUser: (waiting: boolean) => void;
  }): Promise<{ ok: boolean; text: string; error?: string }> {
    if (spec.signal.aborted) {
      return { ok: false, text: "", error: "cancelled" };
    }
    let collected = "";
    let childError = "";
    let openTools = 0;
    let waitingAsks = 0;
    const child = new AgentSession({
      ...this.config,
      sessionId: `${this.config.sessionId}::${spec.agentId}`,
      multiAgent: false,
      permissionMode: "full",
      // 共享父资源锁 + owner 对齐节点 id，保证写/终端/浏览器跨 Agent 互斥且 UI 可显示占用
      resourceLock: this.resourceLock,
      ownerLabel: spec.agentId,
      systemPrompt: `${subAgentInstructions({
        name: spec.name,
        parentSessionId: this.config.sessionId,
      })}\n\n${this.config.systemPrompt ?? ""}`.trim(),
      browserBridge: this.config.browserBridge,
      emit: (event) => {
        if (event.type === "delta" && event.text) {
          collected += event.text;
          spec.onProgress();
          spec.onLog(event.text.slice(0, 120));
          return;
        }
        if (
          event.type === "reasoning_delta" ||
          event.type === "usage" ||
          event.type === "step_start"
        ) {
          spec.onProgress();
          return;
        }
        if (event.type === "error") {
          childError = event.message;
          spec.onProgress();
          spec.onLog(`错误：${event.message}`);
          return;
        }
        if (event.type === "tool_input_start") {
          spec.onProgress();
          return;
        }
        if (event.type === "tool_start") {
          openTools += 1;
          spec.onProgress();
          spec.onToolRunning(true);
          spec.onLog(`工具 ${event.toolName}`);
          return;
        }
        if (event.type === "tool_end") {
          openTools = Math.max(0, openTools - 1);
          if (openTools === 0) {
            spec.onToolRunning(false);
          }
          spec.onProgress();
          return;
        }
        if (event.type === "ask_user") {
          // 多问询关键：子 ask 上抛父会话 sessionId，UI 才能渲染；附 agentName 便于区分
          waitingAsks += 1;
          spec.onProgress();
          spec.onWaitingUser(true);
          spec.onLog(`提问：${event.question.question.slice(0, 80)}`);
          this.config.emit({
            type: "ask_user",
            sessionId: this.config.sessionId,
            question: {
              ...event.question,
              agentName: spec.name,
              sourceSessionId: event.sessionId,
            },
          });
          return;
        }
        if (event.type === "ask_resolved") {
          waitingAsks = Math.max(0, waitingAsks - 1);
          spec.onProgress();
          this.config.emit({
            type: "ask_resolved",
            sessionId: this.config.sessionId,
            askId: event.askId,
            toolCallId: event.toolCallId,
            answer: event.answer,
          });
          if (waitingAsks === 0) {
            spec.onWaitingUser(false);
          }
          return;
        }
        if (event.type === "done" && event.reason === "error") {
          childError = childError || "子任务失败";
        }
      },
    });
    this.childSessions.set(spec.agentId, child);
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
      this.childSessions.delete(spec.agentId);
      spec.signal.removeEventListener("abort", onAbort);
    }
  }

  async start(
    userMessage: string,
    history?: ChatTurn[],
    images?: AgentImageAttachment[],
  ): Promise<void> {
    this.messages = (history ?? []).map((item) => ({
      role: item.role as "system" | "user" | "assistant",
      content: item.content,
    }));
    // 支持视觉的模型：附件图片作为原生多模态 part 随用户消息发出
    if (images?.length) {
      const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
        { type: "text", text: userMessage },
      ];
      for (const image of images) {
        parts.push({ type: "image", image: image.dataUrl });
      }
      this.messages.push({ role: "user", content: parts });
    } else {
      this.messages.push({ role: "user", content: userMessage });
    }
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

  /**
   * 渲染层回答 askUser 提问。
   * 多问询：按 askId 路由到本会话或任一子会话，回答一个推进一个。
   */
  resolveAsk(askId: string, answer: string): boolean {
    const pending = this.pendingAsks.get(askId);
    if (pending) {
      this.pendingAsks.delete(askId);
      pending.resolve(answer);
      return true;
    }
    for (const child of this.childSessions.values()) {
      if (child.resolveAsk(askId, answer)) {
        return true;
      }
    }
    return false;
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
    // 子会话一并取消，避免其 pendingAsks 悬挂
    for (const child of this.childSessions.values()) {
      void child.cancel();
    }
    this.childSessions.clear();
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

    let stream: Awaited<ReturnType<ToolLoopAgent["stream"]>>;
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

    let aborted = false;
    const state: StreamPartState = {
      step: this.step,
      finishReason: null,
      lastStepHadToolCalls: false,
      approvalRequested: false,
      streamError: null,
    };

    try {
      for await (const part of stream.fullStream) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        processStreamPart(part, {
          sessionId: this.sessionId,
          emit: this.config.emit,
          openTools: this.openTools,
          state,
          setPendingApproval: (pending) => {
            this.pending = pending;
          },
        });
      }
    } catch (error) {
      state.streamError = errorMessage(error);
      this.config.emit({
        type: "error",
        sessionId: this.sessionId,
        message: state.streamError,
      });
    }

    this.step = state.step;

    if (aborted) {
      if (this.paused) {
        this.config.emit({ type: "status", sessionId: this.sessionId, status: "paused" });
        return;
      }
      this.finishRun("cancelled");
      return;
    }

    // 错误终态：不得再发 done(stop) 覆盖
    if (state.streamError) {
      this.finishRun("error");
      return;
    }

    // 完整 step 才落 checkpoint，避免把半截 step 写入后续上下文。
    const responseMessages = await stream.responseMessages;
    if (responseMessages.length) {
      this.messages.push(...responseMessages);
    }

    if (state.approvalRequested) {
      return;
    }

    // stopWhen（单次 stream 的步数预算）耗尽时，最后一步的 finishReason 仍是
    // "tool-calls"（模型还想继续调工具）——任务并未完成。此时继续开新一轮
    // stream（步数预算重置），而不是伪装成正常完成；超过整个 run 的步数
    // 上限才以 max_steps 终止（UI 显示「已达到步骤上限」）。
    if (state.finishReason === "tool-calls" || state.lastStepHadToolCalls) {
      if (this.step >= MAX_RUN_STEPS) {
        this.finishRun("max_steps");
        return;
      }
      await this.continueLoop();
      return;
    }

    this.finishRun("stop");
  }
}
