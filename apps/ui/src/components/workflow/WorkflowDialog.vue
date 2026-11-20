<script setup lang="ts">
import { CircleHelp, RefreshCw } from "@lucide/vue";
import { computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import type { WorkflowDefinition, WorkflowRun, WorkflowRunSummary, WorkflowSnapshot } from "@/types/zen-api";
import WorkflowEditor from "./WorkflowEditor.vue";
import { toRuntimeWorkflow } from "./graph";
import type { WorkflowGraph, WorkflowNode } from "./graph";
import { buildTemplateGraph, WORKFLOW_TEMPLATE_IDS } from "./templates";
import type { WorkflowTemplateId } from "./templates";

const { t, te } = useI18n();
const { active } = defineProps<{ active: boolean }>();
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
/** 面板分区：编辑器独占画布高度，运行相关的其它功能收进「运行记录」 */
const panelTab = shallowRef<"editor" | "runs">("editor");
/** 会话已落库？草稿会话（还没发过消息）没有工作流记录，主进程会以「Session not found」拒绝查询 */
const sessionExists = shallowRef(false);
const pendingDecision = shallowRef<"skip" | "retry" | null>(null);
/** 待确认的启动：图里有工具/脚本/HTTP 节点时先一次性说明会执行哪些外部操作 */
const pendingStart = shallowRef(false);
/** 工具节点可选项（内置 + 已启用 MCP），进入面板时拉一次 */
const tools = shallowRef<Array<{ name: string; description: string }>>([]);
/** 待确认的模板选择：编辑器已有内容时先确认再替换草稿 */
const pendingTemplate = shallowRef<WorkflowTemplateId | null>(null);
const RETRYING_DETAILS = ["Retrying workflow effect; cancellation is available.", "Retrying model effect; cancellation is available."];
const running = computed(() => run.value?.status === "running" || RETRYING_DETAILS.includes(run.value?.detail ?? ""));
/** 待确认的副作用步骤（模型/工具/脚本/HTTP）：结果不确定，既不自动重放也不静默跳过 */
const EFFECT_NODE_TYPES = ["model", "tool", "script", "http"];
const uncertainEffect = computed(() => {
  const last = run.value?.journal.at(-1);
  const node = last ? run.value?.snapshot.graph.nodes.find((item) => item.id === last.nodeId) : undefined;
  return run.value?.status === "pending-review" && last?.type === "before" &&
    EFFECT_NODE_TYPES.includes(node?.type ?? "") &&
    !run.value.outputs.some((output) => output.key === last.key);
});
const modelOptions = computed(() => models.enabledModels.map(({ provider, model }) => ({ providerId: provider.id, modelId: model.id, label: `${provider.name} / ${model.name}` })));
const progress = computed(() => run.value ? t("workflow.progress", {
  steps: run.value.journal.filter((event) => event.type === "transition").length,
  maxSteps: run.value.snapshot.budgets.maxSteps,
  effects: run.value.journal.filter((event) => event.type === "before").length,
  maxEffects: run.value.snapshot.budgets.maxEffects,
}) : "");
function nodeName(node: WorkflowNode) { return node.label === node.type ? t(`workflow.nodeType.${node.type}`) : node.label; }
function localizedStatus(status: string) { return te(`workflow.status.${status}`) ? t(`workflow.status.${status}`) : status; }
function localizedDetail(detail: string) { return RETRYING_DETAILS.includes(detail) ? t("workflow.detailRetrying") : detail; }
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

watch(() => chat.sessionId, () => {
  newGraph();
  run.value = null;
  runId.value = "";
  recentRuns.value = [];
  pendingDecision.value = null;
});

watch([() => active, () => chat.sessionId], ([visible], _, onCleanup) => {
  if (!visible) return;
  void refreshList();
  const timer = setInterval(() => { void pollRun(); }, 1000);
  onCleanup(() => clearInterval(timer));
}, { immediate: true });

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
    sessionExists.value = Boolean(exists && sessionId);
    items.value = sessionExists.value && sessionId ? await api().list(sessionId) : [];
    recentRuns.value = sessionExists.value && sessionId ? await api().listRuns(sessionId) : [];
    // 工具清单是全局配置（不依赖会话落库），失败不影响编辑器其它部分（例如 MCP 未就绪）
    tools.value = sessionId ? await api().listTools(sessionId).catch(() => []) : [];
  });
}
let polling = false;
async function pollRun() {
  // 草稿会话未落库时主进程会拒绝查询，这里直接跳过（避免每秒弹一次 Session not found）
  if (polling || !active || !chat.sessionId || !sessionExists.value) return;
  const sessionId = chat.sessionId;
  const id = run.value?.id;
  polling = true;
  try {
    const [runs, latest] = await Promise.all([api().listRuns(sessionId), id ? api().get(id, sessionId) : Promise.resolve(null)]);
    if (active && chat.sessionId === sessionId) {
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
/** 选择默认配置：编辑器已有内容时先确认，避免静默覆盖草稿 */
function chooseTemplate(value: unknown) {
  const template = WORKFLOW_TEMPLATE_IDS.find((id) => id === value);
  if (!template) return;
  if (graph.value.nodes.length || dirty.value) {
    pendingTemplate.value = template;
    return;
  }
  applyTemplate(template);
}
function applyTemplate(template: WorkflowTemplateId) {
  const model = modelOptions.value[0];
  graph.value = buildTemplateGraph(template, {
    translate: t,
    ...(model ? { model: { providerId: model.providerId, modelId: model.modelId } } : {}),
  });
  name.value = t(`workflow.templateName.${template}`);
  id.value = null;
  version.value = null;
  wallMs.value = "120000";
  dirty.value = true;
  error.value = "";
  notice.value = t("workflow.templateLoaded", { name: t(`workflow.templateName.${template}`) });
}
function confirmTemplate() {
  const template = pendingTemplate.value;
  pendingTemplate.value = null;
  if (template) applyTemplate(template);
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
    else if (node.type === "tool") nodeSettings[node.id] = { toolName: settings.toolName, toolInput: settings.toolInput };
    else if (node.type === "script") nodeSettings[node.id] = { script: settings.script, runtime: settings.runtime ?? "shell" };
    else if (node.type === "http") nodeSettings[node.id] = { url: settings.url, method: (settings.method ?? "GET").toUpperCase(), headers: settings.headers, body: settings.body };
    else nodeSettings[node.id] = {};
  }
  // 画布位置随版本保存：重新打开时节点还在原来的位置
  const layout: NonNullable<WorkflowSnapshot["layout"]> = {};
  for (const node of graph.value.nodes) {
    layout[node.id] = { x: node.x, y: node.y };
  }
  return { graph: runtime.graph, nodeSettings, layout, budgets: { ...runtime.budgets, maxWallMs } };
}
async function load(itemId: string) {
  await action(async () => {
    if (!chat.sessionId) throw new Error(t("workflow.errSession"));
    const found = await api().open(itemId, chat.sessionId);
    if (!found) throw new Error(t("workflow.errNotFound"));
    applyDefinition(found);
    panelTab.value = "editor";
  });
}
function applyDefinition(found: WorkflowDefinition) {
  const { snapshot } = found;
  const settings = snapshot.nodeSettings;
  graph.value = {
    nodes: snapshot.graph.nodes.map((node, index) => ({
      id: node.id, type: node.type, label: node.type,
      x: snapshot.layout?.[node.id]?.x ?? 40 + (index % 3) * 260,
      y: snapshot.layout?.[node.id]?.y ?? 60 + Math.floor(index / 3) * 140,
      settings: { ...(node.type === "model" ? { instructions: settings[node.id]?.prompt, providerId: settings[node.id]?.providerId, modelId: settings[node.id]?.modelId } : {}),
        ...(node.type === "condition" ? { left: settings[node.id]?.left, right: settings[node.id]?.right, operator: settings[node.id]?.operator } : {}),
        ...(node.type === "tool" ? { toolName: settings[node.id]?.toolName, toolInput: settings[node.id]?.toolInput } : {}),
        ...(node.type === "script" ? { script: settings[node.id]?.script, runtime: settings[node.id]?.runtime } : {}),
        ...(node.type === "http" ? { url: settings[node.id]?.url, method: settings[node.id]?.method, headers: settings[node.id]?.headers, body: settings[node.id]?.body } : {}),
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
    sessionExists.value = true;
    id.value = saved.id;
    version.value = saved.version;
    dirty.value = false;
    items.value = await api().list(sessionId);
    notice.value = t("workflow.savedVersion", { version: saved.version });
  });
}
/** 需要人工确认的外部操作（工具/脚本/HTTP）：启动前一次性列出，运行中不再逐个打断 */
const externalEffects = computed(() =>
  graph.value.nodes.filter((node) => ["tool", "script", "http"].includes(node.type)),
);

/** 确认框里的外部操作清单：类型 · 名称 */
const externalEffectList = computed(() =>
  externalEffects.value
    .map((node) => `${t(`workflow.nodeType.${node.type}`)} · ${nodeName(node)}`)
    .join("，"),
);

function start() {
  if (externalEffects.value.length) {
    pendingStart.value = true;
    return;
  }
  void startRun();
}

function confirmStart() {
  pendingStart.value = false;
  void startRun();
}

async function startRun() {
  await action(async () => {
    if (!id.value || dirty.value) throw new Error(t("workflow.errSaveFirst"));
    if (!chat.sessionId) throw new Error(t("workflow.errSession"));
    const existing = await window.zen!.session.snapshot(chat.sessionId);
    if (!existing) await window.zen!.session.create(chat.sessionWorkspaceId === "common" ? null : chat.sessionWorkspaceId, chat.sessionId);
    run.value = await api().start(id.value, chat.sessionId);
    if (!run.value) throw new Error(t("workflow.errRunStart"));
    sessionExists.value = true;
    runId.value = run.value.id;
    panelTab.value = "runs";
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
    if (!run.value || !chat.sessionId || !uncertainEffect.value) throw new Error(t("workflow.errUncertain"));
    const id = run.value.id;
    run.value = await api().review(id, decision, chat.sessionId, `${decision}:${id}`);
    notice.value = t(decision === "retry" ? "workflow.retryNotice" : "workflow.skipNotice");
  });
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-[var(--color-txt)]">
    <!-- 头行：标题 + 说明（悬浮查看）+ 分区 tab；说明不再常驻占高度 -->
    <header class="flex flex-none items-center gap-0.5 pb-2 pt-1">
      <h2 class="m-0 text-sm font-semibold">{{ t('workflow.title') }}</h2>
      <HoverCard :open-delay="120" :close-delay="80">
        <HoverCardTrigger as-child>
          <Button variant="ghost" size="icon-xs" class="rounded-full text-[var(--color-mut)]" :aria-label="t('workflow.guideTitle')" :title="t('workflow.guideTitle')">
            <CircleHelp class="size-3.5" aria-hidden="true" />
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="bottom" align="start" class="w-[320px] text-[12px] leading-5">
          <p class="m-0">{{ t('workflow.description') }}</p>
          <ol class="mb-0 mt-2 list-decimal space-y-1 pl-4 text-[var(--color-mut)]">
            <li>{{ t('workflow.guideStep1') }}</li>
            <li>{{ t('workflow.guideStep2') }}</li>
            <li>{{ t('workflow.guideStep3') }}</li>
            <li>{{ t('workflow.guideStep4') }}</li>
          </ol>
          <p class="mb-0 mt-2 text-[var(--color-mut)]">{{ t('workflow.guideSafety') }}</p>
          <p class="mb-0 mt-1 text-[var(--color-mut)]">{{ t('workflow.guideCapabilities') }}</p>
          <p class="mb-0 mt-1 text-[var(--color-mut)]">{{ t('workflow.guideRecovery') }}</p>
        </HoverCardContent>
      </HoverCard>
      <div class="ml-auto flex flex-none items-center gap-0.5 rounded-lg bg-[var(--color-sunken)] p-0.5" role="tablist" :aria-label="t('workflow.title')">
        <Button
          v-for="tab in [{ id: 'editor', label: 'workflow.editorTab' }, { id: 'runs', label: 'workflow.runsTab' }]"
          :key="tab.id"
          variant="ghost"
          role="tab"
          class="h-6 rounded-md px-2 text-[11px] font-normal"
          :class="panelTab === tab.id ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
          :aria-selected="panelTab === tab.id"
          @click="panelTab = tab.id as 'editor' | 'runs'"
        >
          {{ t(tab.label) }}
        </Button>
      </div>
    </header>

    <p v-if="error" role="alert" class="m-0 flex-none pb-2 text-xs text-[var(--color-danger-fg)]">{{ error }}</p>
    <p v-if="notice" role="status" class="m-0 flex-none pb-2 text-xs text-[var(--color-accent)]">{{ notice }}</p>

    <!-- 编辑器：工具栏压成两行，其余高度全部留给画布 -->
    <div v-if="panelTab === 'editor'" class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex flex-none items-end gap-1.5">
        <div class="flex min-w-0 flex-[3] flex-col gap-1">
          <Label for="workflow-template" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.templateLabel') }}</Label>
          <!-- 模板选择是一次性动作而非受控状态：选中后立刻生成草稿，触发器保持占位提示 -->
          <Select :model-value="undefined" :disabled="busy || running" @update:model-value="chooseTemplate">
            <SelectTrigger id="workflow-template" class="w-full"><SelectValue :placeholder="t('workflow.templatePlaceholder')" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="template in WORKFLOW_TEMPLATE_IDS" :key="template" :value="template">
                  <span class="flex min-w-0 flex-col items-start">
                    <span>{{ t(`workflow.templateName.${template}`) }}</span>
                    <span class="text-[11px] text-[var(--color-mut)]">{{ t(`workflow.templateDesc.${template}`) }}</span>
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div class="flex min-w-0 flex-[3] flex-col gap-1"><Label for="workflow-name" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.name') }}</Label><Input id="workflow-name" v-model="name" :disabled="running" maxlength="120" @update:model-value="dirty = true" /></div>
        <div class="flex w-24 flex-none flex-col gap-1"><Label for="workflow-wall" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.wallTime') }}</Label><Input id="workflow-wall" v-model="wallMs" :disabled="running" type="number" min="1000" max="86400000" step="1000" @update:model-value="dirty = true" /></div>
      </div>
      <div class="flex flex-none flex-wrap items-center gap-1.5">
        <div class="flex min-w-[160px] flex-1 flex-col">
          <!-- 已保存的工作流：一次点击就把选中版本载入编辑器，不再用一排按钮占宽 -->
          <Select :model-value="undefined" :disabled="busy || running || !items.length" @update:model-value="(value) => load(String(value))">
            <SelectTrigger class="w-full" :aria-label="t('workflow.savedWorkflows')">
              <SelectValue :placeholder="items.length ? t('workflow.savedWorkflows') : t('workflow.noSaved')" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="item in items" :key="item.id" :value="item.id">{{ t('workflow.openWorkflow', { name: item.name, version: item.current_version }) }}{{ dirty ? t('workflow.replaceDraft') : '' }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" :disabled="busy || running" @click="newGraph">{{ t('workflow.newDraft') }}</Button>
        <Button size="sm" :disabled="busy || running" @click="save">{{ t('workflow.save') }}</Button>
        <Button size="sm" :disabled="busy || running || !id || dirty" :title="t('workflow.start')" @click="start">{{ t('workflow.startShort') }}</Button>
      </div>
      <span v-if="version" class="flex-none text-[11px] text-[var(--color-mut)]">{{ t('workflow.version', { version }) }}{{ dirty ? t('workflow.unsaved') : '' }}</span>
      <WorkflowEditor class="min-h-0 flex-1" :model-value="graph" :models="modelOptions" :tools="tools" @update:model-value="updateGraph" />
    </div>

    <!-- 运行记录：最近运行 / 运行控制 / 日志与输出 -->
    <div v-else class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
      <section class="flex flex-col gap-1" :aria-label="t('workflow.recentRuns')">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium">{{ t('workflow.recentRuns') }}</span>
          <Button variant="ghost" size="icon-xs" class="ml-auto text-[var(--color-mut)]" :aria-label="t('workflow.refresh')" :title="t('workflow.refresh')" :disabled="busy || running" @click="refreshList">
            <RefreshCw class="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <span v-if="!recentRuns.length" class="text-xs text-[var(--color-mut)]">{{ t('workflow.noRuns') }}</span>
        <ul v-else class="m-0 flex list-none flex-col gap-0.5 p-0">
          <li v-for="recent in recentRuns" :key="recent.id">
            <Button
              variant="ghost"
              class="h-7 w-full justify-start gap-2 rounded-md px-1.5 text-[11px] font-normal hover:bg-[var(--color-menu-hover)]"
              :class="recent.id === run?.id ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]' : 'text-[var(--color-txt)]'"
              :disabled="busy"
              @click="getRun(recent.id)"
            >
              <span class="font-mono">{{ recent.id.slice(0, 8) }}</span>
              <span class="text-[var(--color-mut)]">v{{ recent.version }}</span>
              <span class="ml-auto">{{ localizedStatus(recent.status) }}</span>
            </Button>
          </li>
        </ul>
      </section>

      <section class="flex flex-col gap-1.5 border-t border-[var(--color-line)] pt-2" :aria-label="t('workflow.journal')">
        <div class="flex items-end gap-1.5">
          <div class="flex min-w-0 flex-1 flex-col gap-1"><Label for="workflow-run-id" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.runId') }}</Label><Input id="workflow-run-id" v-model="runId" class="h-8" :placeholder="t('workflow.runIdPlaceholder')" /></div>
          <Button variant="outline" size="sm" :disabled="busy || running" @click="getRun()">{{ t('workflow.getRun') }}</Button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" :disabled="busy || running || !canResume" @click="resume">{{ t('workflow.resume') }}</Button>
          <Button variant="destructive" size="sm" :disabled="busy || !run || !['running', 'interrupted', 'pending-review'].includes(run.status)" @click="cancel">{{ t('workflow.cancel') }}</Button>
          <Button variant="outline" size="sm" :disabled="busy || running || !isApproval" @click="review(true)">{{ t('workflow.approve') }}</Button>
          <Button variant="outline" size="sm" :disabled="busy || running || !isApproval" @click="review(false)">{{ t('workflow.deny') }}</Button>
          <Button variant="outline" size="sm" :disabled="busy || running || !uncertainEffect" @click="pendingDecision = 'skip'">{{ t('workflow.skipEffect') }}</Button>
          <Button variant="outline" size="sm" :disabled="busy || running || !uncertainEffect" @click="pendingDecision = 'retry'">{{ t('workflow.retryEffect') }}</Button>
        </div>
        <p v-if="running" role="status" class="m-0 text-xs">{{ t('workflow.active') }}</p>
        <template v-if="run">
          <p role="status" class="m-0 text-xs">{{ t('workflow.runSummary', { id: run.id, version: run.version, status: localizedStatus(run.status), progress }) }}{{ run.detail ? t('workflow.runDetail', { detail: localizedDetail(run.detail) }) : '' }}</p>
          <p v-if="uncertainEffect" role="alert" class="m-0 text-xs text-[var(--color-danger-fg)]">{{ t('workflow.uncertain') }}</p>
          <ol class="m-0 max-h-56 overflow-auto rounded border border-[var(--color-line)] p-2 text-[11px] text-[var(--color-mut)]" :aria-label="t('workflow.journal')">
            <li v-for="(event, index) in run.journal" :key="index">{{ event.step }} · {{ event.nodeId }} · {{ event.type }}{{ event.outcome ? ` · ${event.outcome}` : '' }}{{ event.nextId ? ` → ${event.nextId}` : '' }}</li>
            <li v-if="!run.journal.length">{{ t('workflow.noJournal') }}</li>
          </ol>
          <div v-for="output in run.outputs" :key="output.key" class="break-words text-[11px]">{{ output.node_id }}: {{ output.output }}</div>
        </template>
      </section>
    </div>

    <ConfirmDialog
      :open="pendingTemplate !== null"
      :title="t('workflow.templateConfirmTitle')"
      :description="t('workflow.templateConfirmDesc')"
      :confirm-label="t('workflow.templateConfirm')"
      :pending="busy"
      @update:open="(value) => { if (!value) pendingTemplate = null; }"
      @confirm="confirmTemplate"
    />
    <ConfirmDialog
      :open="pendingStart"
      :title="t('workflow.startConfirmTitle')"
      :description="t('workflow.startConfirmDesc', { count: externalEffects.length, nodes: externalEffectList })"
      :confirm-label="t('workflow.startShort')"
      :pending="busy"
      @update:open="(value) => { if (value === false) pendingStart = false; }"
      @confirm="confirmStart"
    />
    <ConfirmDialog :open="pendingDecision !== null" :title="t(pendingDecision === 'retry' ? 'workflow.retryEffect' : 'workflow.skipEffect')" :description="t(pendingDecision === 'retry' ? 'workflow.retryWarning' : 'workflow.skipWarning')" :confirm-label="t(pendingDecision === 'retry' ? 'workflow.confirmRetry' : 'workflow.confirmSkip')" :pending="busy" @update:open="(value) => { if (value === false) pendingDecision = null; }" @confirm="resolveUncertain" />
  </div>
</template>
