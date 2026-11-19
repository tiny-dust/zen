import { ipcMain } from "electron";

import { runWorkflow } from "@zen/agent-core/src/workflow";

import { completeOnce } from "./model-api";
import { listProviders } from "./model-db";
import { getSession } from "./workspace-db";
import {
  commitPersistedModelOutput, createWorkflowRun, getWorkflowRun, listWorkflowRuns, listWorkflows, openWorkflow, pendingModelStep, recordApproval,
  recoverWorkflowRuns, recordWorkflowOutput, resolveWorkflowValue, saveWorkflow, skipUncertainModel, updateWorkflowRun, workflowJournal,
} from "./workflow-store";

const active = new Map<string, AbortController>();
const activeSessions = new Set<string>();

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
  try {
    commitPersistedModelOutput(id);
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
          if (node.type !== "model") throw new Error("Unsafe effect adapter disabled");
          const setting = run.snapshot.nodeSettings[node.id];
          const prompt = setting?.instructions ?? setting?.prompt;
          if (!prompt) throw new Error("Missing model instructions");
          const timeLeft = run.snapshot.budgets.maxWallMs - (Date.now() - run.created_at);
          if (context.signal?.aborted || timeLeft <= 0) throw new Error("Wall-time budget expired");
          // No external exactly-once guarantee: before is durable, an uncertain completion needs review.
          const output = await completeWorkflowModel(prompt, setting, Math.min(timeLeft, 120_000), controller.signal);
          if (controller.signal.aborted) throw new Error("Workflow cancelled or wall-time budget expired");
          recordWorkflowOutput(context.runId, context.key, node.id, output);
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
      skipUncertainModel(id);
    } else if (decision === "retry" && confirmation === `retry:${id}`) {
      const pending = pendingModelStep(id);
      if (!pending || pending.run.status !== "pending-review" || pending.output) throw new Error("No uncertain model effect to retry");
      const remaining = run.snapshot.budgets.maxWallMs - (Date.now() - run.created_at);
      if (remaining <= 0) throw new Error("Wall-time budget expired");
      const setting = run.snapshot.nodeSettings[pending.before.nodeId];
      const prompt = setting?.instructions ?? setting?.prompt;
      if (!prompt) throw new Error("Missing model instructions");
      const controller = new AbortController();
      active.set(id, controller);
      activeSessions.add(run.session_id);
      const timer = setTimeout(() => controller.abort(), remaining);
      updateWorkflowRun(id, "pending-review", "Retrying model effect; cancellation is available.");
      void (async () => {
        try {
          const output = await completeWorkflowModel(prompt, setting, Math.min(remaining, 120_000), controller.signal);
          if (controller.signal.aborted) throw new Error("Workflow cancelled or wall-time budget expired");
          recordWorkflowOutput(id, pending.before.key, pending.before.nodeId, output);
          commitPersistedModelOutput(id);
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
