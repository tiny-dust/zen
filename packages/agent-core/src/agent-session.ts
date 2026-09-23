import { isStepCount, ToolLoopAgent } from "ai";

import type { ModelMessage } from "ai";
import type {
  AgentDoneReason,
  AgentStreamEvent,
  AgentTranscriptEntry,
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
import { SubAgentTranscript } from "./sub-agent-transcript";

/** 附件图片（data-url），支持视觉的模型按原生多模态 part 随用户消息发出 */
export interface AgentImageAttachment {
  name: string;
  dataUrl: string;
}

/**
 * 插入消息的模型侧包装：原始文本保留在末尾，前置一段最高优先级指令。
 * 渲染层气泡与落库均为原始文本，只有发给模型的 messages 带这段指令。
 */
export function insertUserContent(text: string): string {
  return [
    "【用户插入 · 最高优先级】用户在原任务执行过程中插入了以下信息。",
    "请先处理这条插入信息（按它的要求行动）；处理完成后，再结合原任务的上下文继续推进原任务，并在回复中简要汇总当前进展。",
    "",
    "-----",
    "",
    text,
  ].join("\n");
}

/**
 * 子会话面板侧信道事件改写：把子 Agent 的 tasks_updated / reference_found
 * 改挂到父会话（sessionId=父），并打上 agent 标识供 UI 区分来源。
 * 返回 null 表示不是面板侧信道事件（调用方按原路径处理，一字不动）。
 */
export function rewriteSubAgentPanelEvent(
  event: AgentStreamEvent,
  parentSessionId: string,
  agentId: string,
  agentName: string,
): AgentStreamEvent | null {
  if (event.type === "tasks_updated") {
    return {
      type: "tasks_updated",
      sessionId: parentSessionId,
      // version=0 走父侧「更新当前版」语义：父无清单则建 v1，有则更新当前版
      version: 0,
      agentName,
      // item id 加 agentId 前缀，避免与主 Agent 的 t1/t2 等条目 id 冲突
      items: event.items.map((item) => ({
        ...item,
        id: `${agentId}-${item.id}`,
        agentName,
      })),
    };
  }
  if (event.type === "reference_found") {
    return {
      type: "reference_found",
      sessionId: parentSessionId,
      reference: { ...event.reference, agent: agentName },
    };
  }
  return null;
}

/**
 * 单个会话的有状态 Agent 运行时。
 *
 * 通过 AI SDK `ToolLoopAgent` 完成多步工具循环，并在需要审批的工具调用处暂停。
 * 审批通过/拒绝后，把 `tool-approval-response` 追加回消息并继续 loop。
 * `pause` 会中断当前流，`resume` 从最近一次完整 step 的 checkpoint 继续。
 * `insert` 在 run 进行中插入高优先级消息：暂停原 run → 执行插入 run → 自动恢复原 run。
 */
export class AgentSession {
  private readonly config: AgentSessionConfig;
  private readonly agent: ToolLoopAgent;
  private messages: ModelMessage[] = [];
  /**
   * history 里的 system 轮（如压缩摘要）不能进 messages：AI SDK v7 会抛
   * "System messages are not allowed in the prompt or messages fields"。
   * start() 把它们抽出，经 prepareCall 并入每次 stream 的 instructions。
   */
  private historyInstructions: string | null = null;
  private controller: AbortController | null = null;
  private paused = false;
  private step = 0;
  /** run 是否仍活跃：暂停/等审批时 start/runStep 已返回，但 run 未结束 */
  private runActive = false;
  /**
   * 插入执行进行中：原 run 被暂停（checkpoint 保留），当前 controller 驱动插入 run。
   * 插入 run 终态后由 finishInsertPhase 恢复原 run；期间禁止再次插入/暂停/恢复。
   */
  private inserting = false;
  /** insert 暂停原 run 的落点等待：runStep 走到 paused 分支时放行 */
  private pauseWaiters: Array<() => void> = [];
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
  /** tasks_updated 版本归一化的 emit：子会话侧信道事件复用「更新当前版」语义 */
  private readonly emitNormalized: (event: AgentStreamEvent) => void;

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
          // 子会话侧信道事件的 agentName 必须透传，UI 才能走 upsert 合并分支
          ...(event.agentName ? { agentName: event.agentName } : {}),
        });
        return;
      }
      config.emit(event);
    };
    this.emitNormalized = emit;
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
            // 父会话暂停/取消时级联中断子 Agent：node controller 随父 signal abort
            getParentSignal: () => this.controller?.signal ?? null,
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
      prepareCall: (options) => {
        // history 的 system 轮并入 instructions（排在主指令之后），messages 保持无 system
        const base = typeof options.instructions === "string" ? options.instructions : undefined;
        const merged = [base, this.historyInstructions ?? undefined]
          .filter((part): part is string => !!part)
          .join("\n\n");
        return { ...options, instructions: merged || undefined };
      },
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

  /** 只读运行状态快照（外部集成如飞书桥接展示会话状态用，不改变任何行为） */
  getRunState(): {
    runActive: boolean;
    paused: boolean;
    waitingApproval: boolean;
    waitingAskCount: number;
    inserting: boolean;
  } {
    return {
      runActive: this.runActive,
      paused: this.paused,
      waitingApproval: this.pending !== null,
      waitingAskCount: this.pendingAsks.size,
      inserting: this.inserting,
    };
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
    onTranscript?: (entries: AgentTranscriptEntry[]) => void;
  }): Promise<{ ok: boolean; text: string; error?: string }> {
    if (spec.signal.aborted) {
      return { ok: false, text: "", error: "cancelled" };
    }
    let collected = "";
    let childError = "";
    let openTools = 0;
    let waitingAsks = 0;
    // 消息流时间线：子会话流事件 → 结构化 transcript（面板展示完整执行记录）
    const transcript = new SubAgentTranscript();
    let lastTranscriptFlush = 0;
    const flushTranscript = (force = false) => {
      if (!spec.onTranscript) {
        return;
      }
      const nowMs = Date.now();
      // delta 高频：400ms 节流；工具 / ask / 错误等关键事件强制立即 flush
      if (!force && nowMs - lastTranscriptFlush < 400) {
        return;
      }
      lastTranscriptFlush = nowMs;
      spec.onTranscript(transcript.snapshot());
    };
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
        // 消息流时间线：先喂收集器，再做既有控制流（collected / waitingUser / ask 上抛）
        if (transcript.push(event)) {
          const throttled =
            event.type === "delta" || event.type === "reasoning_delta" || event.type === "tool_progress";
          flushTranscript(!throttled);
        }
        if (event.type === "delta" && event.text) {
          collected += event.text;
          spec.onProgress();
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
          return;
        }
        if (event.type === "tool_input_start") {
          spec.onProgress();
          return;
        }
        // 面板侧信道改写（tasks_updated / reference_found）：改挂父会话，
        // 其余事件路径一字不动，避免污染父会话消息流
        const rewritten = rewriteSubAgentPanelEvent(
          event,
          this.config.sessionId,
          spec.agentId,
          spec.name,
        );
        if (rewritten) {
          if (rewritten.type === "tasks_updated") {
            // 经父侧归一化：version=0 → 「更新当前版」（父无清单则建 v1）
            this.emitNormalized(rewritten);
          } else {
            this.config.emit(rewritten);
          }
          return;
        }
        if (event.type === "tool_start") {
          openTools += 1;
          spec.onProgress();
          spec.onToolRunning(true);
          // 子会话 runTerminal 进程事件原样上抛（sessionId 带 ::，UI 侧改归属），
          // 供悬浮卡「进程」节展示子 Agent 的常驻命令
          this.config.emit(event);
          return;
        }
        if (event.type === "tool_progress") {
          spec.onProgress();
          this.config.emit(event);
          return;
        }
        if (event.type === "tool_end") {
          openTools = Math.max(0, openTools - 1);
          if (openTools === 0) {
            spec.onToolRunning(false);
          }
          spec.onProgress();
          this.config.emit(event);
          return;
        }
        if (event.type === "ask_user") {
          // 多问询关键：子 ask 上抛父会话 sessionId，UI 才能渲染；附 agentName 便于区分
          waitingAsks += 1;
          spec.onProgress();
          spec.onWaitingUser(true);
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
      // 收尾强制 flush：节流窗口内未发出的尾部 delta / 工具终态也要进时间线
      flushTranscript(true);
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
    // system 轮（如压缩摘要）抽出并入 instructions，messages 只留 user/assistant
    const systemTurns = (history ?? []).filter((item) => item.role === "system");
    this.historyInstructions =
      systemTurns
        .map((item) => item.content.trim())
        .filter(Boolean)
        .join("\n\n") || null;
    this.messages = (history ?? [])
      .filter((item) => item.role !== "system")
      .map((item) => ({
        role: item.role as "user" | "assistant",
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
    // 插入 run 的审批链走完且到达终态：在这里恢复原 run
    //（insert() 在等审批时提前返回，插入 run 的收尾由 approve 驱动）
    if (this.inserting && !this.pending) {
      await this.finishInsertPhase();
    }
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
    // 插入执行期间不允许暂停：paused 标志此刻表示「原 run 被插入挂起」
    if (!this.controller || this.paused || this.inserting) {
      return;
    }
    this.paused = true;
    this.controller.abort();
  }

  async resume(): Promise<void> {
    // 插入执行期间原 run 的恢复由 finishInsertPhase 自动驱动，手动 resume 会与之冲突
    if (!this.paused || this.inserting) {
      return;
    }
    this.paused = false;
    await this.continueLoop();
  }

  /** 插入执行前置检查：main 侧在落库插入消息前先调用，失败不产生副作用 */
  canInsert(): { ok: boolean; error?: string } {
    if (this.inserting) {
      return { ok: false, error: "已有插入任务在执行，请等它完成后再插入" };
    }
    if (this.pending) {
      return { ok: false, error: "正在等待工具审批，暂时不能插入执行" };
    }
    if (this.pendingAsks.size > 0) {
      return { ok: false, error: "正在等待你回答提问，暂时不能插入执行" };
    }
    if (!this.runActive) {
      return { ok: false, error: "当前没有运行中的任务" };
    }
    return { ok: true };
  }

  /**
   * 插入执行：打断当前 run（保留 checkpoint）→ 追加最高优先级插入消息 →
   * 执行插入 run → 结束后自动从断点恢复原 run。
   * main 侧应先 canInsert() 校验并落库用户消息，再 fire-and-forget 调用本方法。
   */
  async insert(text: string): Promise<{ ok: boolean; error?: string }> {
    const guard = this.canInsert();
    if (!guard.ok) {
      return guard;
    }
    // 1. 暂停原 run：abort 当前流，checkpoint 停在最近一次完整 step
    if (!this.paused) {
      await this.suspendForInsert();
      // 暂停落点等待期间可能被取消
      if (!this.runActive) {
        return { ok: false, error: "会话已取消" };
      }
    }
    // 2. 追加插入消息（模型侧带最高优先级指令，原始文本保留）
    this.messages.push({ role: "user", content: insertUserContent(text) });
    this.inserting = true;
    this.config.emit({ type: "insert_started", sessionId: this.sessionId, text });
    // 3. 执行插入 run：正常流式 emit 各类事件
    this.controller = new AbortController();
    this.config.emit({ type: "status", sessionId: this.sessionId, status: "thinking" });
    await this.runStep();
    // 等审批时 runStep 已返回：插入 run 的续跑与收尾由 approve() 驱动
    if (this.pending) {
      return { ok: true };
    }
    // 4. 插入 run 终态：恢复原 run（cancel 后 runActive=false，跳过恢复）
    await this.finishInsertPhase();
    return { ok: true };
  }

  /** 暂停原 run 并等待 runStep 走到 paused 分支（checkpoint 落定） */
  private async suspendForInsert(): Promise<void> {
    const settled = new Promise<void>((resolve) => {
      this.pauseWaiters.push(resolve);
    });
    this.paused = true;
    this.controller?.abort();
    // 兜底：runStep 已在收尾路径时 abort 分支可能不再走 paused 分支
    await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    // continueLoop 可能在首次 abort 后才换新 controller，再补一次确保停住
    this.controller?.abort();
  }

  /** 插入 run 结束后恢复原 run：从 checkpoint 续跑（continueLoop） */
  private async finishInsertPhase(): Promise<void> {
    this.inserting = false;
    if (this.runActive && this.paused) {
      this.config.emit({ type: "original_resumed", sessionId: this.sessionId });
      this.paused = false;
      await this.continueLoop();
    }
  }

  private resolvePauseWaiters(): void {
    const waiters = this.pauseWaiters;
    this.pauseWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  async cancel(): Promise<void> {
    const waiting = this.paused || this.pending != null || this.pendingAsks.size > 0;
    this.orchestrator?.dispose();
    if (this.controller) {
      this.controller.abort();
    }
    this.paused = false;
    // 插入执行中取消：插入 run 与原 run 一并终止，不再恢复
    this.inserting = false;
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
    this.resolvePauseWaiters();
    // runStep 已因暂停/等审批返回时，abort 不会再触发 done，这里补终态
    if (this.runActive && waiting) {
      this.finishRun("cancelled");
    }
  }

  private finishRun(reason: AgentDoneReason): void {
    // 插入 run 的终态：只收尾插入 run 自己（补工具终态 + insert 阶段 done），
    // runActive 保持 true——原 run 仍待 finishInsertPhase 恢复
    if (this.inserting) {
      this.emitUnfinishedTools(reason);
      this.config.emit({ type: "done", sessionId: this.sessionId, reason, phase: "insert" });
      return;
    }
    this.runActive = false;
    this.pending = null;
    this.emitUnfinishedTools(reason);
    this.config.emit({ type: "done", sessionId: this.sessionId, reason });
  }

  private emitUnfinishedTools(reason: AgentDoneReason): void {
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
      // 暂停/取消触发的 abort 可能让流在 part 之间抛 AbortError：
      // 这是中断不是运行错误，走 aborted 终态（paused/cancelled），避免误报 error
      if (signal.aborted) {
        aborted = true;
      } else {
        state.streamError = errorMessage(error);
        this.config.emit({
          type: "error",
          sessionId: this.sessionId,
          message: state.streamError,
        });
      }
    }

    this.step = state.step;

    // signal.aborted 兜底：abort 发生在工具执行中时，fullStream 可能直接结束
    // 而不再来 part（循环顶检查不到），这里仍按中断处理
    if (aborted || signal.aborted) {
      // cancel() 已同步补发终态 done（runActive 已复位）：本次 runStep 静默退出
      if (!this.runActive) {
        this.resolvePauseWaiters();
        return;
      }
      if (this.paused) {
        this.config.emit({ type: "status", sessionId: this.sessionId, status: "paused" });
        // insert 的 suspendForInsert 在等这个落点
        this.resolvePauseWaiters();
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
