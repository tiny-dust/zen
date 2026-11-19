<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import type { WorkflowDefinition, WorkflowRun, WorkflowRunSummary, WorkflowSnapshot } from "@/types/zen-api";
import WorkflowEditor from "./WorkflowEditor.vue";
import { toRuntimeWorkflow } from "./graph";
import type { WorkflowGraph, WorkflowNode } from "./graph";

const { t, te } = useI18n();
const open = defineModel<boolean>("open", { required: true });
const chat = useChatStore();
const models = useModelsStore();
const graph = shallowRef<WorkflowGraph>({ nodes: [], edges: [], budgets: { maxSteps: 100, maxEffects: 10 } });
const name = shallowRef("");
const id = shallowRef<string | null>(null);
const version = shallowRef<number | null>(null);
const wallMs = shallowRef("120000");
const items = shallowRef<Array<{ id: string; name: string; current_version: number }>>([]);
const recentRuns = shallowRef<WorkflowRunSummary[]>([]);
const run = shallowRef<WorkflowRun | null>(null);
const runId = shallowRef("");
const error = shallowRef("");
const notice = shallowRef("");
const busy = shallowRef(false);
const pendingDecision = shallowRef<"skip" | "retry" | null>(null);
const running = computed(() => run.value?.status === "running" || run.value?.detail === "Retrying model effect; cancellation is available.");
const uncertainModel = computed(() => {
  const last = run.value?.journal.at(-1);
  return run.value?.status === "pending-review" && last?.type === "before" &&
    run.value.snapshot.graph.nodes.some((node) => node.id === last.nodeId && node.type === "model") &&
    !run.value.outputs.some((output) => output.key === last.key);
});
const modelOptions = computed(() => models.enabledModels.map(({ provider, model }) => ({ providerId: provider.id, modelId: model.id, label: `${provider.name} / ${model.name}` })));
const progress = computed(() => run.value ? t("workflow.progress", {
  steps: run.value.journal.filter((event) => event.type === "transition").length,
  maxSteps: run.value.snapshot.budgets.maxSteps,
  effects: run.value.journal.filter((event) => event.type === "before").length,
  maxEffects: run.value.snapshot.budgets.maxEffects,
}) : "");
const unsupported = computed(() => graph.value.nodes.filter((node) => ["tool", "script", "http"].includes(node.type)).map(nodeName));
function nodeName(node: WorkflowNode) { return node.label === node.type ? t(`workflow.nodeType.${node.type}`) : node.label; }
function localizedStatus(status: string) { return te(`workflow.status.${status}`) ? t(`workflow.status.${status}`) : status; }
function localizedDetail(detail: string) { return detail === "Retrying model effect; cancellation is available." ? t("workflow.detailRetrying") : detail; }
const isApproval = computed(() => {
  const last = run.value?.journal.at(-1);
  return run.value?.status === "pending-review" && last?.type === "before" && run.value.snapshot.graph.nodes.some((node) => node.id === last.nodeId && node.type === "approval");
});
const canResume = computed(() => {
  if (!run.value || !["interrupted", "pending-review"].includes(run.value.status)) return false;
  const last = run.value.journal.at(-1);
  return !isApproval.value && !(run.value.status === "pending-review" && last?.type === "before");
});
const dirty = shallowRef(false);

watch([open, () => chat.sessionId], ([visible, sessionId], previous, onCleanup) => {
  if (previous && previous[1] !== sessionId) newGraph();
  run.value = null;
  runId.value = "";
  recentRuns.value = [];
  pendingDecision.value = null;
  if (!visible) return;
  void refreshList();
  const timer = setInterval(() => { void pollRun(); }, 1000);
  onCleanup(() => clearInterval(timer));
});

function api() {
  if (!window.zen?.workflow) throw new Error(t("workflow.errApi"));
  return window.zen.workflow;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
async function action(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try { await work(); }
  catch (cause) { error.value = message(cause); }
  finally { busy.value = false; }
}
async function refreshList() {
  await action(async () => {
    const sessionId = chat.sessionId;
    const exists = sessionId ? await window.zen!.session.snapshot(sessionId) : null;
    items.value = exists && sessionId ? await api().list(sessionId) : [];
    recentRuns.value = exists && sessionId ? await api().listRuns(sessionId) : [];
  });
}
let polling = false;
async function pollRun() {
  if (polling || !open.value || !chat.sessionId) return;
  const sessionId = chat.sessionId;
  const id = run.value?.id;
  polling = true;
  try {
    const [runs, latest] = await Promise.all([api().listRuns(sessionId), id ? api().get(id, sessionId) : Promise.resolve(null)]);
    if (open.value && chat.sessionId === sessionId) {
      recentRuns.value = runs;
      if (id && run.value?.id === id && latest) run.value = latest;
    }
  } catch (cause) { error.value = message(cause); }
  finally { polling = false; }
}
function newGraph() {
  graph.value = { nodes: [], edges: [], budgets: { maxSteps: 100, maxEffects: 10 } };
  id.value = null;
  version.value = null;
  name.value = "";
  wallMs.value = "120000";
  dirty.value = false;
  error.value = "";
}
function convert(): WorkflowSnapshot {
  const runtime = toRuntimeWorkflow(graph.value);
  for (const node of graph.value.nodes) {
    if (node.type === "model" && !modelOptions.value.some((model) => model.providerId === node.settings.providerId && model.modelId === node.settings.modelId)) {
      throw new Error(t("workflow.errModel", { node: nodeName(node) }));
    }
  }
  const maxWallMs = wallMs.value.trim() ? Number(wallMs.value) : NaN;
  if (!Number.isSafeInteger(maxWallMs) || maxWallMs < 1000 || maxWallMs > 86_400_000 ||
      runtime.budgets.maxSteps > 10_000 || runtime.budgets.maxEffects > 1_000) throw new Error(t("workflow.errBudgets"));
  const nodeSettings: WorkflowSnapshot["nodeSettings"] = {};
  for (const node of graph.value.nodes) {
    const { settings } = node;
    if (node.type === "model") {
      const modelSettings = { prompt: settings.instructions!.trim(), providerId: settings.providerId, modelId: settings.modelId };
      nodeSettings[node.id] = modelSettings;
    } else if (node.type === "condition") nodeSettings[node.id] = { left: settings.left, right: settings.right, operator: settings.operator };
    else nodeSettings[node.id] = {};
  }
  return { graph: runtime.graph, nodeSettings, budgets: { ...runtime.budgets, maxWallMs } };
}
async function load(itemId: string) {
  await action(async () => {
    if (!chat.sessionId) throw new Error(t("workflow.errSession"));
    const found = await api().open(itemId, chat.sessionId);
    if (!found) throw new Error(t("workflow.errNotFound"));
    applyDefinition(found);
  });
}
function applyDefinition(found: WorkflowDefinition) {
  const { snapshot } = found;
  const settings: Record<string, { prompt?: string; providerId?: string; modelId?: string; left?: string; right?: string; operator?: "equals" | "not-equals" }> = snapshot.nodeSettings;
  graph.value = {
    nodes: snapshot.graph.nodes.map((node, index) => ({
      id: node.id, type: node.type, label: node.type, x: 48 + (index % 3) * 260, y: 56 + Math.floor(index / 3) * 150,
      settings: { ...(node.type === "model" ? { instructions: settings[node.id]?.prompt, providerId: settings[node.id]?.providerId, modelId: settings[node.id]?.modelId } : {}),
        ...(node.type === "condition" ? { left: settings[node.id]?.left, right: settings[node.id]?.right, operator: settings[node.id]?.operator } : {}),
        ...(node.type === "loop" ? { maxIterations: node.maxIterations } : {}) },
    })),
    edges: snapshot.graph.edges.map((edge, index) => ({ id: `edge-${index}`, source: edge.from, target: edge.to, type: edge.label })),
    budgets: { maxSteps: snapshot.budgets.maxSteps, maxEffects: snapshot.budgets.maxEffects },
  };
  name.value = found.name;
  id.value = found.id;
  version.value = found.version;
  wallMs.value = String(snapshot.budgets.maxWallMs);
  dirty.value = false;
}
function updateGraph(value: WorkflowGraph) { graph.value = value; dirty.value = true; }
async function save() {
  await action(async () => {
    if (!name.value.trim()) throw new Error(t("workflow.errName"));
    const snapshot = convert();
    // Vue proxies cannot cross Electron's structured-clone IPC boundary.
    if (!chat.sessionId) throw new Error(t("workflow.errSession"));
    const sessionId = chat.sessionId;
    if (!await window.zen!.session.snapshot(sessionId)) await window.zen!.session.create(chat.sessionWorkspaceId, sessionId);
    const saved = await api().save(name.value.trim(), JSON.parse(JSON.stringify(snapshot)) as WorkflowSnapshot, sessionId, id.value ?? undefined);
    id.value = saved.id;
    version.value = saved.version;
    dirty.value = false;
    items.value = await api().list(chat.sessionId);
    notice.value = t("workflow.savedVersion", { version: saved.version });
  });
}
async function start() {
  await action(async () => {
    if (!id.value || dirty.value) throw new Error(t("workflow.errSaveFirst"));
    if (!chat.sessionId) throw new Error(t("workflow.errSession"));
    const existing = await window.zen!.session.snapshot(chat.sessionId);
    if (!existing) await window.zen!.session.create(chat.sessionWorkspaceId === "common" ? null : chat.sessionWorkspaceId, chat.sessionId);
    run.value = await api().start(id.value, chat.sessionId);
    if (!run.value) throw new Error(t("workflow.errRunStart"));
    runId.value = run.value.id;
    await pollRun();
  });
}
async function getRun(selectedId?: string) {
  await action(async () => {
    const sessionId = chat.sessionId;
    if (!sessionId || !(selectedId ?? runId.value.trim())) throw new Error(t("workflow.errRunSelection"));
    const found = await api().get(selectedId ?? runId.value.trim(), sessionId);
    if (!found) throw new Error(t("workflow.errRunNotFound"));
    run.value = found;
    runId.value = found.id;
  });
}
async function resume() {
  await action(async () => {
    if (!run.value || !chat.sessionId) throw new Error(t("workflow.errLoadRun"));
    const started = await api().resume(run.value.id, chat.sessionId);
    if (!started) throw new Error(t("workflow.errRunResume"));
    run.value = started;
    await pollRun();
  });
}
async function cancel() {
  await action(async () => {
    if (!run.value || !chat.sessionId) throw new Error(t("workflow.errLoadRun"));
    const result = await api().cancel(run.value.id, chat.sessionId);
    notice.value = t("workflow.cancelNotice", { status: localizedStatus(result.status) });
    run.value = await api().get(run.value.id, chat.sessionId);
  });
}
async function review(approved: boolean) {
  await action(async () => {
    if (!run.value || !chat.sessionId || !isApproval.value) throw new Error(t("workflow.errApproval"));
    run.value = await api().review(run.value.id, approved, chat.sessionId);
    notice.value = t("workflow.decisionRecorded");
  });
}
async function resolveUncertain() {
  const decision = pendingDecision.value;
  pendingDecision.value = null;
  if (!decision) return;
  await action(async () => {
    if (!run.value || !chat.sessionId || !uncertainModel.value) throw new Error(t("workflow.errUncertain"));
    const id = run.value.id;
    run.value = await api().review(id, decision, chat.sessionId, `${decision}:${id}`);
    notice.value = t(decision === "retry" ? "workflow.retryNotice" : "workflow.skipNotice");
  });
}
function onOpenChange(value: boolean) { open.value = value; }
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent data-large-panel="true" class="flex h-[min(90vh,900px)] w-[min(1400px,96vw)] max-w-none flex-col overflow-hidden bg-[var(--color-panel)] text-[var(--color-txt)]">
      <DialogHeader>
        <DialogTitle>{{ t('workflow.title') }}</DialogTitle>
        <DialogDescription>{{ t('workflow.description') }}</DialogDescription>
      </DialogHeader>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        <div class="flex flex-wrap items-end gap-2">
          <div class="flex min-w-48 flex-col gap-1"><Label for="workflow-name">{{ t('workflow.name') }}</Label><Input id="workflow-name" v-model="name" :disabled="running" maxlength="120" @update:model-value="dirty = true" /></div>
          <div class="flex w-44 flex-col gap-1"><Label for="workflow-wall">{{ t('workflow.wallTime') }}</Label><Input id="workflow-wall" v-model="wallMs" :disabled="running" type="number" min="1000" max="86400000" step="1000" @update:model-value="dirty = true" /></div>
          <Button variant="outline" :disabled="busy || running" @click="newGraph">{{ t('workflow.newDraft') }}</Button>
          <Button variant="outline" :disabled="busy || running" @click="refreshList">{{ t('workflow.refresh') }}</Button>
          <Button :disabled="busy || running || unsupported.length > 0" @click="save">{{ t('workflow.save') }}</Button>
          <Button :disabled="busy || running || !id || dirty" @click="start">{{ t('workflow.start') }}</Button>
          <span v-if="version" class="text-xs text-[var(--color-mut)]">{{ t('workflow.version', { version }) }}{{ dirty ? t('workflow.unsaved') : '' }}</span>
        </div>
        <p class="text-xs text-[var(--color-mut)]">{{ t('workflow.guidance') }}</p>
        <p v-if="unsupported.length" role="alert" class="text-sm text-[var(--color-danger-fg)]">{{ t('workflow.unsupportedSave', { nodes: unsupported.join(', ') }) }}</p>
        <p v-if="error" role="alert" class="text-sm text-[var(--color-danger-fg)]">{{ error }}</p>
        <p v-if="notice" role="status" class="text-sm text-[var(--color-accent)]">{{ notice }}</p>
        <section class="flex flex-wrap items-center gap-2" :aria-label="t('workflow.savedWorkflows')">
          <span class="text-xs font-medium">{{ t('workflow.savedWorkflows') }}</span>
          <span v-if="!items.length" class="text-xs text-[var(--color-mut)]">{{ t('workflow.noSaved') }}</span>
          <Button v-for="item in items" :key="item.id" variant="outline" size="sm" :disabled="busy || running" @click="load(item.id)">{{ t('workflow.openWorkflow', { name: item.name, version: item.current_version }) }}{{ dirty ? t('workflow.replaceDraft') : '' }}</Button>
        </section>
        <WorkflowEditor :model-value="graph" :models="modelOptions" @update:model-value="updateGraph" />
        <section class="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3" :aria-label="t('workflow.recentRuns')">
          <span class="text-xs font-medium">{{ t('workflow.recentRuns') }}</span>
          <span v-if="!recentRuns.length" class="text-xs text-[var(--color-mut)]">{{ t('workflow.noRuns') }}</span>
          <Button v-for="recent in recentRuns" :key="recent.id" variant="outline" size="sm" :disabled="busy" @click="getRun(recent.id)">
            {{ recent.id.slice(0, 8) }} · v{{ recent.version }} · {{ localizedStatus(recent.status) }}
          </Button>
        </section>
        <section class="flex flex-col gap-2 border-t border-[var(--color-line)] pt-3" :aria-label="t('workflow.journal')">
          <div class="flex flex-wrap items-end gap-2">
            <div class="flex min-w-64 flex-col gap-1"><Label for="workflow-run-id">{{ t('workflow.runId') }}</Label><Input id="workflow-run-id" v-model="runId" :placeholder="t('workflow.runIdPlaceholder')" /></div>
            <Button variant="outline" :disabled="busy || running" @click="getRun()">{{ t('workflow.getRun') }}</Button>
            <Button variant="outline" :disabled="busy || running || !canResume" @click="resume">{{ t('workflow.resume') }}</Button>
            <Button variant="destructive" :disabled="busy || !run || !['running', 'interrupted', 'pending-review'].includes(run.status)" @click="cancel">{{ t('workflow.cancel') }}</Button>
            <Button variant="outline" :disabled="busy || running || !isApproval" @click="review(true)">{{ t('workflow.approve') }}</Button>
            <Button variant="outline" :disabled="busy || running || !isApproval" @click="review(false)">{{ t('workflow.deny') }}</Button>
            <Button variant="outline" :disabled="busy || running || !uncertainModel" @click="pendingDecision = 'skip'">{{ t('workflow.skipModel') }}</Button>
            <Button variant="outline" :disabled="busy || running || !uncertainModel" @click="pendingDecision = 'retry'">{{ t('workflow.retryModel') }}</Button>
          </div>
          <p v-if="running" role="status">{{ t('workflow.active') }}</p>
          <template v-if="run">
            <p role="status">{{ t('workflow.runSummary', { id: run.id, version: run.version, status: localizedStatus(run.status), progress }) }}{{ run.detail ? t('workflow.runDetail', { detail: localizedDetail(run.detail) }) : '' }}</p>
            <p v-if="uncertainModel" role="alert">{{ t('workflow.uncertain') }}</p>
            <ol class="max-h-40 overflow-auto rounded border border-[var(--color-line)] p-2 text-xs" :aria-label="t('workflow.journal')">
              <li v-for="(event, index) in run.journal" :key="index">{{ event.step }} · {{ event.nodeId }} · {{ event.type }}{{ event.outcome ? ` · ${event.outcome}` : '' }}{{ event.nextId ? ` → ${event.nextId}` : '' }}</li>
              <li v-if="!run.journal.length">{{ t('workflow.noJournal') }}</li>
            </ol>
            <div v-for="output in run.outputs" :key="output.key" class="break-words text-xs">{{ output.node_id }}: {{ output.output }}</div>
          </template>
        </section>
      </div>
    </DialogContent>
  </Dialog>
  <ConfirmDialog :open="pendingDecision !== null" :title="t(pendingDecision === 'retry' ? 'workflow.retryModel' : 'workflow.skipModel')" :description="t(pendingDecision === 'retry' ? 'workflow.retryWarning' : 'workflow.skipWarning')" :confirm-label="t(pendingDecision === 'retry' ? 'workflow.confirmRetry' : 'workflow.confirmSkip')" :pending="busy" @update:open="(value) => { if (!value) pendingDecision = null; }" @confirm="resolveUncertain" />
</template>
