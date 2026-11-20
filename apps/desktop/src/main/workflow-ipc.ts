import { ipcMain } from "electron";

import { runWorkflow } from "@zen/agent-core";

import { completeOnce } from "./model-api";
import { listProviders } from "./model-db";
import { getSession } from "./workspace-db";
import {
  commitPersistedEffectOutput, createWorkflowRun, getWorkflowRun, listWorkflowRuns, listWorkflows, openWorkflow, pendingEffectStep, recordApproval,
  recoverWorkflowRuns, recordWorkflowOutput, resolveWorkflowValue, saveWorkflow, skipUncertainEffect, updateWorkflowRun, workflowJournal,
} from "./workflow-store";
import { createWorkflowEffectRunner, interpolateOutputs, listWorkflowTools, MAX_EFFECT_TIMEOUT_MS } from "./workflow-effects";
import type { WorkflowEffectRunner } from "./workflow-effects";

/** getWorkflowRun 的返回形态（summary + 快照/日志/输出） */
type WorkflowRunRecord = NonNullable<ReturnType<typeof getWorkflowRun>>;

const active = new Map<string, AbortController>();
const activeSessions = new Set<string>();
/** 重试中的运行标记：UI 依据它显示「重试中，可取消」（旧记录仍可能带 model 版文案） */
const RETRYING_DETAIL = "Retrying workflow effect; cancellation is available.";

export function isWorkflowSessionActive(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

function ownedRun(id: string, sessionId: string) {
  const run = getWorkflowRun(id);
  if (!run || run.session_id !== sessionId || !getSession(sessionId)) throw new Error("Run not found or session unavailable");
  return run;
}

function validId(input: unknown): input is string {
  return typeof input === "string" && input.length > 0 && input.length <= 128;
}

function ownedSession(input: unknown): string {
  if (!validId(input) || !getSession(input)) throw new Error("Session not found");
  return input;
}

async function completeWorkflowModel(prompt: string, setting: { providerId?: string; modelId?: string } | undefined, timeoutMs: number, signal: AbortSignal): Promise<string> {
  const { providerId, modelId } = setting ?? {};
  const provider = (await listProviders()).find((item) => item.id === providerId && item.enabled);
  if (!provider || !provider.models.some((model) => model.id === modelId && model.enabled)) {
    throw new Error(`Configured workflow model is unavailable: ${providerId ?? "(none)"} / ${modelId ?? "(none)"}`);
  }
  if (signal.aborted) throw new Error("Workflow cancelled or wall-time budget expired");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Workflow cancelled or wall-time budget expired"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Stops awaiting the result; completeOnce has no abort signal, so remote cancellation is not guaranteed.
    return await Promise.race([completeOnce(prompt, { providerId, modelId, timeoutMs }), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * 执行一个副作用节点并把输出落库：模型走 completeOnce，工具/脚本/HTTP 走工作流执行器。
 * `$node-id` 在上游节点有输出时替换为该输出，否则保留原样（不会静默丢内容）。
 */
async function executeEffectNode(options: {
  run: WorkflowRunRecord;
  node: { id: string; type: "model" | "tool" | "script" | "http" };
  key: string;
  signal: AbortSignal;
  effects: () => Promise<WorkflowEffectRunner>;
}): Promise<void> {
  const { run, node, key, signal } = options;
  const setting = run.snapshot.nodeSettings[node.id];
  const timeLeft = run.snapshot.budgets.maxWallMs - (Date.now() - run.created_at);
  if (signal.aborted || timeLeft <= 0) throw new Error("Wall-time budget expired");
  const resolveNode = (nodeId: string): string | undefined => {
    try {
      return resolveWorkflowValue(run.id, `$${nodeId}`);
    } catch {
      return undefined;
    }
  };
  let output: string;
  if (node.type === "model") {
    const prompt = setting?.instructions ?? setting?.prompt;
    if (!prompt) throw new Error("Missing model instructions");
    output = await completeWorkflowModel(
      interpolateOutputs(prompt, resolveNode),
      setting,
      Math.min(timeLeft, MAX_EFFECT_TIMEOUT_MS),
      signal,
    );
  } else {
    const runner = await options.effects();
    output = await runner.run({ type: node.type, setting: setting ?? {}, resolve: resolveNode, signal, timeoutMs: timeLeft });
  }
  if (signal.aborted) throw new Error("Workflow cancelled or wall-time budget expired");
  recordWorkflowOutput(run.id, key, node.id, output);
}

/** A run is always resumed from its immutable version and committed journal. */
async function driveRun(id: string) {
  const run = getWorkflowRun(id);
  if (!run) throw new Error("Run not found");
  const remaining = run.snapshot.budgets.maxWallMs - (Date.now() - run.created_at);
  if (remaining <= 0) {
    updateWorkflowRun(id, "budget-exhausted", "Wall-time budget expired");
    return getWorkflowRun(id);
  }
  const controller = new AbortController();
  active.set(id, controller);
  activeSessions.add(run.session_id);
  const timer = setTimeout(() => controller.abort(), remaining);
  // 工具/脚本/HTTP 各共用一次工具集；只有真正跑副作用节点时才解析工作区与 MCP 工具
  let effectRunner: Promise<WorkflowEffectRunner> | null = null;
  const effects = () => (effectRunner ??= createWorkflowEffectRunner(run.session_id));
  try {
    commitPersistedEffectOutput(id);
    updateWorkflowRun(id, "running");
    const providers = await listProviders();
    for (const node of run.snapshot.graph.nodes) {
      if (node.type !== "model") continue;
      const setting = run.snapshot.nodeSettings[node.id];
      const provider = providers.find((item) => item.id === setting?.providerId && item.enabled);
      if (!provider?.models.some((model) => model.id === setting?.modelId && model.enabled)) {
        throw new Error(`Configured workflow model is unavailable: ${setting?.providerId ?? "(none)"} / ${setting?.modelId ?? "(none)"}`);
      }
    }
    const result = await runWorkflow({
      graph: run.snapshot.graph, runId: id, budgets: run.snapshot.budgets,
      journal: workflowJournal, signal: controller.signal,
      adapters: {
        async execute(node, context) {
          // No external exactly-once guarantee: before is durable, an uncertain completion needs review.
          await executeEffectNode({ run, node, key: context.key, signal: controller.signal, effects });
        },
        async requestApproval() {
          // Approval is resolved by review IPC, which commits the outcome before resuming.
          throw new Error("Awaiting human approval");
        },
        async evaluateCondition(node) {
          const setting = run.snapshot.nodeSettings[node.id];
          if (!setting || typeof setting.left !== "string" || typeof setting.right !== "string") throw new Error("Missing condition");
          const left = resolveWorkflowValue(id, setting.left);
          const right = resolveWorkflowValue(id, setting.right);
          return setting.operator === "equals" ? left === right : left !== right;
        },
        async shouldContinue() { return true; },
      },
    });
    const status = controller.signal.aborted && result.status === "cancelled" && Date.now() - run.created_at >= run.snapshot.budgets.maxWallMs
      ? "budget-exhausted" : result.status;
    updateWorkflowRun(id, status, result.status === "pending-review" ? "Uncertain effect or approval requires human review; never replay automatically" : null);
  } catch (error) {
    console.error(`Workflow run ${id} failed`, error);
    updateWorkflowRun(id, "failed", error instanceof Error ? error.message : "Workflow execution failed");
  } finally {
    clearTimeout(timer);
    active.delete(id);
    activeSessions.delete(run.session_id);
  }
  return getWorkflowRun(id);
}

function launchRun(id: string, sessionId: string, isSessionRunning: (id: string) => boolean) {
  const run = ownedRun(id, sessionId);
  if (activeSessions.has(sessionId) || isSessionRunning(sessionId)) throw new Error("Session already running");
  if (!["running", "interrupted", "pending-review"].includes(run.status)) throw new Error("Run cannot resume");
  void driveRun(id).catch((error) => {
    console.error(`Workflow run ${id} failed`, error);
    updateWorkflowRun(id, "failed", error instanceof Error ? error.message : "Workflow execution failed");
  });
  return getWorkflowRun(id);
}

export function registerWorkflowIpc(isSessionRunning: (id: string) => boolean): void {
  recoverWorkflowRuns();
  ipcMain.handle("workflow:save", (_event, name: unknown, snapshot: unknown, id: unknown, sessionId: unknown) =>
    saveWorkflow(name, snapshot, ownedSession(sessionId), id));
  ipcMain.handle("workflow:list", (_event, sessionId: unknown) => listWorkflows(ownedSession(sessionId)));
  ipcMain.handle("workflow:list-runs", (_event, sessionId: unknown) => listWorkflowRuns(ownedSession(sessionId)));
  // 工具清单是全局配置（内置 + 已启用 MCP），不依赖会话归属：草稿会话也能挑工具
  ipcMain.handle("workflow:list-tools", (_event, sessionId: unknown) => listWorkflowTools(validId(sessionId) ? sessionId : "session-less"));
  ipcMain.handle("workflow:open", (_event, id: unknown, version: unknown, sessionId: unknown) => {
    if (!validId(id) || (version !== undefined && (!Number.isSafeInteger(version) || (version as number) < 1))) throw new Error("Invalid workflow identifier");
    return openWorkflow(id, ownedSession(sessionId), version as number | undefined);
  });
  ipcMain.handle("workflow:start", (_event, workflowId: unknown, sessionId: unknown) => {
    if (!validId(workflowId) || !validId(sessionId) || !getSession(sessionId)) throw new Error("Invalid workflow or session");
    if (activeSessions.has(sessionId) || isSessionRunning(sessionId)) throw new Error("Session already running");
    const run = createWorkflowRun(workflowId, sessionId);
    return launchRun(run.id, sessionId, isSessionRunning);
  });
  ipcMain.handle("workflow:get", (_event, id: unknown, sessionId: unknown) => {
    if (!validId(id)) throw new Error("Invalid run identifier");
    return ownedRun(id, ownedSession(sessionId));
  });
  ipcMain.handle("workflow:resume", (_event, id: unknown, sessionId: unknown) => {
    if (!validId(id)) throw new Error("Invalid run identifier");
    return launchRun(id, ownedSession(sessionId), isSessionRunning);
  });
  ipcMain.handle("workflow:cancel", (_event, id: unknown, sessionId: unknown) => {
    if (!validId(id)) throw new Error("Invalid run identifier");
    const run = ownedRun(id, ownedSession(sessionId));
    if (active.has(id)) {
      active.get(id)?.abort();
      return { ok: true, status: "cancelling" };
    }
    if (!["interrupted", "pending-review"].includes(run.status)) throw new Error("Run cannot be cancelled");
    updateWorkflowRun(id, "cancelled", "Cancelled by user; uncertain external effects may have completed");
    return { ok: true, status: "cancelled" };
  });
  ipcMain.handle("workflow:review", async (_event, id: unknown, decision: unknown, confirmation: unknown, sessionId: unknown) => {
    if (!validId(id)) throw new Error("Invalid run identifier");
    const run = ownedRun(id, ownedSession(sessionId));
    if (active.has(id) || activeSessions.has(run.session_id) || isSessionRunning(run.session_id)) throw new Error("Session already running");
    if (typeof decision === "boolean") {
      recordApproval(id, decision);
    } else if (decision === "skip" && confirmation === `skip:${id}`) {
      skipUncertainEffect(id);
    } else if (decision === "retry" && confirmation === `retry:${id}`) {
      const pending = pendingEffectStep(id);
      if (!pending || pending.run.status !== "pending-review" || pending.output) throw new Error("No uncertain effect to retry");
      const remaining = run.snapshot.budgets.maxWallMs - (Date.now() - run.created_at);
      if (remaining <= 0) throw new Error("Wall-time budget expired");
      const controller = new AbortController();
      active.set(id, controller);
      activeSessions.add(run.session_id);
      const timer = setTimeout(() => controller.abort(), remaining);
      updateWorkflowRun(id, "pending-review", RETRYING_DETAIL);
      let effectRunner: Promise<WorkflowEffectRunner> | null = null;
      const effects = () => (effectRunner ??= createWorkflowEffectRunner(pending.run.session_id));
      void (async () => {
        try {
          await executeEffectNode({
            run: pending.run,
            node: { id: pending.node.id, type: pending.node.type as "model" | "tool" | "script" | "http" },
            key: pending.before.key,
            signal: controller.signal,
            effects,
          });
          commitPersistedEffectOutput(id);
          updateWorkflowRun(id, "pending-review", "Retry committed. Select Resume to continue.");
        } catch (error) {
          console.error(`Workflow retry ${id} failed`, error);
          updateWorkflowRun(id, "pending-review", "Retry did not commit; external effect may have completed. Inspect before deciding again.");
        } finally {
          clearTimeout(timer);
          active.delete(id);
          activeSessions.delete(run.session_id);
        }
      })();
    } else {
      throw new Error("Invalid review decision or missing explicit confirmation");
    }
    return ownedRun(id, run.session_id);
  });
}
