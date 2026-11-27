<script setup lang="ts">
import { IconPlayerPlay as Play, IconFlag as Flag, IconGitBranch as GitBranch, IconWorld as Globe, IconRepeat as Repeat, IconShieldCheck as ShieldCheck, IconSparkles as Sparkles, IconTerminal2 as Terminal, IconTrash as Trash2, IconTool as Wrench } from "@tabler/icons-vue";
import { computed, onBeforeUnmount, ref, shallowRef, useId } from "vue";
import { useI18n } from "vue-i18n";

import type { Component } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canConnect, edgeTypesFor, HTTP_METHODS, NODE_TYPES, removeNode, toRuntimeWorkflow } from "./graph";
import type { WorkflowEdge, WorkflowEdgeType, WorkflowGraph, WorkflowNode, WorkflowNodeType } from "./graph";

/** Controlled JSON graph. The parent must apply update:modelValue. */
const props = defineProps<{
  modelValue: WorkflowGraph;
  models?: { providerId: string; modelId: string; label: string }[];
  /** 工具节点可选项（内置 + 已启用 MCP，来源为主进程工具清单） */
  tools?: { name: string; description: string }[];
}>();
const emit = defineEmits<{ "update:modelValue": [graph: WorkflowGraph]; selectionChange: [id: string | null] }>();
const { t } = useI18n();

/** 节点卡片尺寸与出口锚点（画布坐标，用于连线几何计算） */
const NODE_W = 190;
const NODE_H = 72;
const ANCHOR_Y = 36;

/** 节点类型的外观：图标 + 语义色调（色调只做局部标识，不做大面积铺色） */
const NODE_META: Record<WorkflowNodeType, { icon: Component; tone: string }> = {
  start: { icon: Play, tone: "ok" },
  end: { icon: Flag, tone: "muted" },
  model: { icon: Sparkles, tone: "accent" },
  condition: { icon: GitBranch, tone: "link" },
  loop: { icon: Repeat, tone: "warm" },
  approval: { icon: ShieldCheck, tone: "ok" },
  tool: { icon: Wrench, tone: "dim" },
  script: { icon: Terminal, tone: "dim" },
  http: { icon: Globe, tone: "dim" },
};

function nodeName(node: WorkflowNode) {
  return node.label === node.type ? t(`workflow.nodeType.${node.type}`) : node.label;
}
function graphError(error: unknown): string {
  if (!(error instanceof Error)) return t("workflow.invalidGraph");
  const plain: Record<string, string> = {
    "Invalid run budgets": "budgets", "Workflow needs exactly one start and at least one end": "endpoints",
    "Dangling edge": "dangling", "Unreachable workflow node": "unreachable",
    "Workflow contains a node with no path to end": "noExit",
  };
  if (plain[error.message]) return t(`workflow.graphError.${plain[error.message]}`);
  const patterns: Array<[RegExp, string]> = [
    [/^Invalid or duplicate node id: (.*)$/, "nodeId"], [/^Invalid loop limit: (.*)$/, "loopLimit"],
    [/^Select a provider and model: (.*)$/, "selectModel"], [/^Missing model instructions: (.*)$/, "modelInstructions"],
    [/^Condition needs left, right and operator: (.*)$/, "condition"], [/^Missing or duplicate edge: (.*)$/, "edge"],
    [/^Select a tool: (.*)$/, "tool"], [/^Missing script: (.*)$/, "script"], [/^Invalid HTTP url: (.*)$/, "httpUrl"],
    [/^Invalid HTTP method: (.*)$/, "httpMethod"], [/^Invalid tool input: (.*)$/, "toolInput"],
  ];
  for (const [pattern, key] of patterns) {
    const match = error.message.match(pattern);
    if (match) return t(`workflow.graphError.${key}`, { id: match[1] });
  }
  return error.message;
}

const selectedId = shallowRef<string | null>(null);
const selectedEdgeId = shallowRef<string | null>(null);
/** 连线失败等即时反馈：不阻塞编辑，下一条操作即清除 */
const hint = shallowRef("");
const validation = computed(() => {
  try { toRuntimeWorkflow(props.modelValue); return { valid: true, message: t("workflow.graphReady") }; }
  catch (error) { return { valid: false, message: graphError(error) }; }
});
const valid = computed(() => validation.value.valid);
const selected = computed(() => props.modelValue.nodes.find((node) => node.id === selectedId.value));
const selectedEdge = computed(() => props.modelValue.edges.find((edge) => edge.id === selectedEdgeId.value));
const selectedModel = computed(() => props.models?.find((model) => model.providerId === selected.value?.settings.providerId && model.modelId === selected.value?.settings.modelId));
const selectedModelKey = computed(() => selectedModel.value ? JSON.stringify([selectedModel.value.providerId, selectedModel.value.modelId]) : undefined);
const toolOptions = computed(() => props.tools ?? []);
const selectedTool = computed(() => toolOptions.value.find((item) => item.name === selected.value?.settings.toolName));
const toolUnavailable = computed(() => Boolean(selected.value?.settings.toolName) && !selectedTool.value);
const arrowId = useId();
const canvasWidth = computed(() => Math.max(960, ...props.modelValue.nodes.map((node) => node.x + NODE_W + 120)));
const canvasHeight = computed(() => Math.max(540, ...props.modelValue.nodes.map((node) => node.y + NODE_H + 120)));
const nodeMap = computed(() => new Map(props.modelValue.nodes.map((node) => [node.id, node])));
const connections = computed(() => props.modelValue.edges.flatMap((edge) => {
  const from = nodeMap.value.get(edge.source);
  const to = nodeMap.value.get(edge.target);
  if (!from || !to) {
    return [];
  }
  const outgoing = props.modelValue.edges.filter((item) => item.source === edge.source);
  const index = outgoing.findIndex((item) => item.id === edge.id);
  const offset = outgoing.length > 1 ? (index === 0 ? -10 : 10) : 0;
  return [{ edge, from, to, x1: from.x + NODE_W, y1: from.y + ANCHOR_Y + offset, x2: to.x, y2: to.y + ANCHOR_Y }];
}));
const linkPath = computed(() => {
  if (!link.value) {
    return "";
  }
  const node = nodeMap.value.get(link.value.sourceId);
  if (!node) {
    return "";
  }
  return curve(node.x + NODE_W, node.y + ANCHOR_Y, link.value.x, link.value.y);
});

const canvasEl = ref<HTMLElement | null>(null);
const surfaceEl = ref<HTMLElement | null>(null);
const drag = shallowRef<{ id: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
const link = shallowRef<{ sourceId: string; type: WorkflowEdgeType; x: number; y: number } | null>(null);

function publish(graph: WorkflowGraph) { emit("update:modelValue", graph); }
function select(id: string | null) {
  selectedId.value = id;
  if (id) {
    selectedEdgeId.value = null;
  }
  emit("selectionChange", id);
}
function uniqueId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function addNode(type: WorkflowNodeType) {
  const index = props.modelValue.nodes.length;
  const node: WorkflowNode = {
    id: uniqueId(), type, label: type,
    x: 40 + (index % 3) * 260, y: 60 + Math.floor(index / 3) * 140, settings: {},
  };
  publish({ ...props.modelValue, nodes: [...props.modelValue.nodes, node] });
  select(node.id);
}
function updateNode(patch: Partial<WorkflowNode>) {
  if (!selected.value) return;
  const id = selected.value.id;
  publish({ ...props.modelValue, nodes: props.modelValue.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) });
}
function updateSetting<K extends keyof WorkflowNode["settings"]>(key: K, value: WorkflowNode["settings"][K]) {
  if (!selected.value) return;
  updateNode({ settings: { ...selected.value.settings, [key]: value } });
}
function chooseModel(key: unknown) {
  const model = props.models?.find((item) => JSON.stringify([item.providerId, item.modelId]) === key);
  if (model && selected.value) updateNode({ settings: { ...selected.value.settings, providerId: model.providerId, modelId: model.modelId } });
}
function updatePositiveSetting(value: string | number) {
  const number = Number(value);
  updateSetting("maxIterations", String(value).trim() !== "" && Number.isSafeInteger(number) && number >= 0 ? number : undefined);
}
function updateBudget(key: "maxSteps" | "maxEffects", value: string | number) {
  const number = Number(value);
  publish({ ...props.modelValue, budgets: {
    maxSteps: props.modelValue.budgets?.maxSteps ?? 100,
    maxEffects: props.modelValue.budgets?.maxEffects ?? 10,
    [key]: String(value).trim() !== "" && Number.isSafeInteger(number) && number >= (key === "maxSteps" ? 1 : 0) ? number : -1,
  } });
}
function deleteSelected() {
  if (!selected.value) return;
  publish(removeNode(props.modelValue, selected.value.id));
  select(null);
}
function deleteEdge(id: string) {
  publish({ ...props.modelValue, edges: props.modelValue.edges.filter((edge) => edge.id !== id) });
  selectedEdgeId.value = null;
}

function move(id: string, dx: number, dy: number) {
  publish({ ...props.modelValue, nodes: props.modelValue.nodes.map((node) => node.id === id ? {
    ...node, x: Math.max(0, node.x + dx), y: Math.max(0, node.y + dy),
  } : node) });
}
function onNodeKey(event: KeyboardEvent, id: string) {
  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16],
  };
  const step = steps[event.key];
  if (!step) return;
  event.preventDefault();
  move(id, step[0], step[1]);
}

/** 卡片本体直接拖动：按下即选中，移动超过阈值才算拖动（避免点选误移动） */
function startDrag(event: PointerEvent, node: WorkflowNode) {
  if (event.button !== 0) return;
  select(node.id);
  hint.value = "";
  drag.value = { id: node.id, x: event.clientX, y: event.clientY, originX: node.x, originY: node.y, moved: false };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag, { once: true });
}
function onDragMove(event: PointerEvent) {
  const active = drag.value;
  if (!active) return;
  const dx = event.clientX - active.x;
  const dy = event.clientY - active.y;
  if (!active.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    active.moved = true;
  }
  const x = Math.max(0, Math.round((active.originX + dx) / 8) * 8);
  const y = Math.max(0, Math.round((active.originY + dy) / 8) * 8);
  publish({ ...props.modelValue, nodes: props.modelValue.nodes.map((node) => node.id === active.id ? { ...node, x, y } : node) });
}
function endDrag() {
  drag.value = null;
  window.removeEventListener("pointermove", onDragMove);
}

/** 从卡片右侧出口拖到目标节点：仅建立该出口允许的一条连线 */
function startLink(event: PointerEvent, node: WorkflowNode, type: WorkflowEdgeType) {
  if (event.button !== 0) return;
  event.stopPropagation();
  select(node.id);
  hint.value = "";
  const rect = surfaceEl.value?.getBoundingClientRect();
  link.value = {
    sourceId: node.id,
    type,
    x: event.clientX - (rect?.left ?? 0),
    y: event.clientY - (rect?.top ?? 0),
  };
  window.addEventListener("pointermove", onLinkMove);
  window.addEventListener("pointerup", endLink, { once: true });
}
function onLinkMove(event: PointerEvent) {
  const active = link.value;
  if (!active) return;
  const rect = surfaceEl.value?.getBoundingClientRect();
  link.value = { ...active, x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}
function endLink(event: PointerEvent) {
  const active = link.value;
  window.removeEventListener("pointermove", onLinkMove);
  link.value = null;
  if (!active || typeof document.elementFromPoint !== "function") return;
  const dropped = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  const targetId = dropped?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? "";
  if (!targetId) return;
  if (!canConnect(props.modelValue, active.sourceId, targetId, active.type)) {
    hint.value = t("workflow.linkInvalid");
    return;
  }
  const edge: WorkflowEdge = { id: uniqueId(), source: active.sourceId, target: targetId, type: active.type };
  publish({ ...props.modelValue, edges: [...props.modelValue.edges, edge] });
  selectedId.value = null;
  selectedEdgeId.value = edge.id;
  emit("selectionChange", null);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointermove", onLinkMove);
});

function curve(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(50, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
function edgePath(connection: { x1: number; y1: number; x2: number; y2: number }) {
  return curve(connection.x1, connection.y1, connection.x2, connection.y2);
}
/** 分支出口（成立/不成立/循环体等）标注在连线中点；普通「下一步」不标注以减少噪音 */
function edgeLabel(edge: WorkflowEdge) {
  return edge.type === "next" ? "" : t(`workflow.edgeType.${edge.type}`);
}
function edgeSummary(edge: WorkflowEdge) {
  const from = nodeMap.value.get(edge.source);
  const to = nodeMap.value.get(edge.target);
  return `${from ? nodeName(from) : edge.source} → ${to ? nodeName(to) : edge.target}`;
}
</script>

<template>
  <section class="wf-editor flex min-h-0 flex-col gap-3 text-[var(--color-txt)]" :aria-label="t('workflow.editor')">
    <!-- 单行提示：长说明进 title，纵向高度全部让给画布 -->
    <div class="flex min-w-0 flex-none items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-xs text-[var(--color-mut)]" :title="t('workflow.editorHint')">{{ t('workflow.editorHint') }}</span>
      <span class="max-w-[45%] flex-none truncate text-xs" :title="validation.message" :class="valid ? 'text-[var(--color-mut)]' : 'text-[var(--color-danger-fg)]'" :role="valid ? 'status' : 'alert'">{{ validation.message }}</span>
    </div>
    <p v-if="hint" role="alert" class="m-0 flex-none text-xs text-[var(--color-danger-fg)]">{{ hint }}</p>

    <!-- 画布优先：容器窄时配置面板落到画布下方，宽时才并排第三列 -->
    <div class="wf-layout min-h-0 min-w-0 flex-1 gap-3">
      <!-- 节点库：点击即加入画布，卡片落位后可直接拖动 -->
      <aside class="flex min-h-0 min-w-0 flex-col gap-0.5 overflow-auto rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-1.5" :aria-label="t('workflow.palette')">
        <p class="m-0 px-1.5 pb-1 text-[11px] text-[var(--color-dim)]">{{ t('workflow.palette') }}</p>
        <Button
          v-for="type in NODE_TYPES"
          :key="type"
          variant="ghost"
          class="wf-palette h-8 justify-start gap-2 px-2 text-[12px] font-normal text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
          :data-palette="type"
          :class="`wf-tone-${NODE_META[type].tone}`"
          :aria-label="t('workflow.addNodeOfType', { type: t(`workflow.nodeType.${type}`) })"
          @click="addNode(type)"
        >
          <component :is="NODE_META[type].icon" class="size-3.5 flex-none wf-tone-icon" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left">{{ t(`workflow.nodeType.${type}`) }}</span>
        </Button>
      </aside>

      <!-- 画布：卡片直拖定位；右侧出口拖到目标节点建立连线 -->
      <div
        ref="canvasEl"
        class="wf-canvas min-h-0 overflow-auto rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-sunken)]"
        :aria-label="t('workflow.graph')"
      >
        <div ref="surfaceEl" class="relative" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }">
          <svg class="pointer-events-none absolute inset-0 size-full" :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`" aria-hidden="true">
            <defs>
              <marker :id="arrowId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-mut)" />
              </marker>
            </defs>
            <g v-for="connection in connections" :key="connection.edge.id" class="wf-edge" :class="selectedEdgeId === connection.edge.id ? 'is-selected' : ''">
              <path
                class="wf-edge__hit"
                :d="edgePath(connection)"
                fill="none"
                stroke="transparent"
                stroke-width="16"
                @click.stop="selectedId = null; selectedEdgeId = connection.edge.id"
              />
              <path
                :d="edgePath(connection)"
                fill="none"
                stroke="var(--color-mut)"
                stroke-width="2"
                :marker-end="`url(#${arrowId})`"
              />
            </g>
            <path v-if="link" :d="linkPath" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-dasharray="4 4" />
          </svg>

          <span
            v-for="connection in connections"
            :key="`label-${connection.edge.id}`"
            class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-popover)] px-1.5 text-[10px] text-[var(--color-mut)]"
            :style="{ left: `${(connection.x1 + connection.x2) / 2}px`, top: `${(connection.y1 + connection.y2) / 2 - 10}px` }"
          >{{ edgeLabel(connection.edge) }}</span>

          <!-- 节点卡片：整张卡片可直接拖动；右侧出口拖动即连线（出口与卡片同级，避免按钮嵌套） -->
          <div
            v-for="node in modelValue.nodes"
            :key="node.id"
            class="absolute"
            :style="{ left: `${node.x}px`, top: `${node.y}px` }"
          >
            <Button
              variant="ghost"
              class="wf-node h-auto min-h-[72px] w-[190px] flex-col items-stretch justify-start gap-0 overflow-visible rounded-[var(--radius-sm)] border p-0 text-left font-normal hover:bg-transparent"
              :class="[`wf-tone-${NODE_META[node.type].tone}`, selectedId === node.id ? 'is-selected' : '']"
              :data-node-id="node.id"
              :aria-pressed="selectedId === node.id"
              :aria-label="t('workflow.inspectNode', { name: nodeName(node), type: t(`workflow.nodeType.${node.type}`) })"
              @pointerdown="startDrag($event, node)"
              @click="select(node.id)"
              @keydown="onNodeKey($event, node.id)"
            >
              <span class="flex w-full items-center gap-1.5 py-1.5 pl-2 pr-[96px]">
                <component :is="NODE_META[node.type].icon" class="size-3.5 flex-none wf-tone-icon" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-[12px] font-medium">{{ nodeName(node) }}</span>
              </span>
              <span class="flex w-full items-center gap-1 pb-1.5 pl-2 pr-[96px] text-[10px] text-[var(--color-mut)]">
                <span class="truncate">{{ t(`workflow.nodeHint.${node.type}`) }}</span>
              </span>
            </Button>
            <div
              v-if="edgeTypesFor(node.type).length"
              class="absolute right-1.5 top-1/2 flex w-[86px] -translate-y-1/2 flex-col gap-0.5"
            >
              <Button
                v-for="type in edgeTypesFor(node.type)"
                :key="type"
                variant="outline"
                class="h-[18px] w-full justify-center rounded-full px-1.5 text-[10px] font-normal"
                :data-outlet="`${node.id}:${type}`"
                :aria-label="t('workflow.outletHint', { name: nodeName(node), type: t(`workflow.edgeType.${type}`) })"
                @pointerdown="startLink($event, node, type)"
              >
                {{ t(`workflow.edgeType.${type}`) }}
              </Button>
            </div>
          </div>

          <p v-if="!modelValue.nodes.length" class="absolute left-6 top-6 m-0 text-sm text-[var(--color-mut)]">{{ t('workflow.noNodes') }}</p>
        </div>
      </div>

      <!-- 配置面板：按选中的节点类型切换；选中连线时展示该连线的详情 -->
      <aside class="wf-inspector flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
        <div class="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
          <h3 class="m-0 pb-2 text-[12px] font-semibold text-[var(--color-txt-strong)]">
            {{ selected ? t('workflow.nodeInspector', { type: t(`workflow.nodeType.${selected.type}`) }) : selectedEdge ? t('workflow.edgeInspector') : t('workflow.inspector') }}
          </h3>

          <div v-if="selected" class="flex flex-col gap-2.5">
            <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t(`workflow.nodeHint.${selected.type}`) }}</p>
            <div class="flex flex-col gap-1">
              <Label for="workflow-label" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.name') }}</Label>
              <Input id="workflow-label" class="h-8" :model-value="selected.label" @update:model-value="updateNode({ label: String($event) })" />
            </div>

            <template v-if="selected.type === 'model'">
              <div class="flex flex-col gap-1">
                <Label for="workflow-model" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.model') }}</Label>
                <Select :model-value="selectedModelKey" @update:model-value="chooseModel">
                  <SelectTrigger id="workflow-model" class="w-full"><SelectValue :placeholder="t('workflow.chooseModel')" /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem v-for="model in models ?? []" :key="JSON.stringify([model.providerId, model.modelId])" :value="JSON.stringify([model.providerId, model.modelId])">{{ model.label }}</SelectItem></SelectGroup></SelectContent>
                </Select>
                <p v-if="!models?.length" class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.enableModel') }}</p>
                <p v-else-if="selected.settings.modelId && !selectedModel" role="alert" class="m-0 text-[11px] text-[var(--color-danger-fg)]">{{ t('workflow.modelUnavailable') }}</p>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-instructions" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.instructions') }}</Label>
                <Textarea id="workflow-instructions" class="min-h-24 text-[12px]" :model-value="selected.settings.instructions ?? ''" @update:model-value="updateSetting('instructions', String($event))" />
              </div>
            </template>

            <template v-else-if="selected.type === 'condition'">
              <p v-if="selected.settings.expression !== undefined" role="alert" class="m-0 text-[11px] text-[var(--color-danger-fg)]">{{ t('workflow.legacyExpression') }}</p>
              <div class="flex flex-col gap-1">
                <Label for="workflow-left" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.left') }}</Label>
                <Input id="workflow-left" class="h-8" :model-value="selected.settings.left ?? ''" :placeholder="t('workflow.literalPlaceholder')" @update:model-value="updateNode({ settings: { ...selected.settings, expression: undefined, left: String($event) } })" />
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-operator" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.operator') }}</Label>
                <Select :model-value="selected.settings.operator" @update:model-value="updateSetting('operator', $event as 'equals' | 'not-equals')">
                  <SelectTrigger id="workflow-operator" class="w-full"><SelectValue :placeholder="t('workflow.chooseComparison')" /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="equals">{{ t('workflow.equals') }}</SelectItem><SelectItem value="not-equals">{{ t('workflow.notEquals') }}</SelectItem></SelectGroup></SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-right" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.right') }}</Label>
                <Input id="workflow-right" class="h-8" :model-value="selected.settings.right ?? ''" :placeholder="t('workflow.literalPlaceholder')" @update:model-value="updateNode({ settings: { ...selected.settings, expression: undefined, right: String($event) } })" />
              </div>
            </template>

            <template v-else-if="selected.type === 'loop'">
              <div class="flex flex-col gap-1">
                <Label for="workflow-iterations" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.maxIterations') }}</Label>
                <Input id="workflow-iterations" class="h-8" type="number" min="0" :model-value="selected.settings.maxIterations ?? ''" @update:model-value="updatePositiveSetting($event)" />
                <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.loopHint') }}</p>
              </div>
            </template>

            <template v-else-if="selected.type === 'tool'">
              <div class="flex flex-col gap-1">
                <Label for="workflow-tool" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.toolName') }}</Label>
                <Select :model-value="selected.settings.toolName ?? ''" @update:model-value="(value) => updateSetting('toolName', String(value))">
                  <SelectTrigger id="workflow-tool" class="w-full"><SelectValue :placeholder="t('workflow.chooseTool')" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem v-if="toolUnavailable && selected.settings.toolName" :value="selected.settings.toolName">
                        {{ selected.settings.toolName }}{{ t('workflow.toolUnavailable') }}
                      </SelectItem>
                      <SelectItem v-for="item in toolOptions" :key="item.name" :value="item.name">{{ item.name }}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p v-if="selectedTool?.description" class="m-0 line-clamp-2 text-[11px] text-[var(--color-mut)]">{{ selectedTool.description }}</p>
                <p v-if="toolUnavailable" role="alert" class="m-0 text-[11px] text-[var(--color-danger-fg)]">{{ t('workflow.toolUnavailableHint') }}</p>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-tool-input" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.toolInput') }}</Label>
                <Textarea id="workflow-tool-input" class="min-h-24 font-mono text-[12px]" :model-value="selected.settings.toolInput ?? ''" :placeholder="'{ &quot;path&quot;: &quot;README.md&quot; }'" @update:model-value="updateSetting('toolInput', String($event))" />
                <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.toolInputHint') }}</p>
              </div>
            </template>

            <template v-else-if="selected.type === 'http'">
              <div class="flex flex-col gap-1">
                <Label for="workflow-url" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.httpUrl') }}</Label>
                <Input id="workflow-url" class="h-8" type="url" placeholder="https://api.example.com/items" :model-value="selected.settings.url ?? ''" @update:model-value="updateSetting('url', String($event))" />
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-method" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.method') }}</Label>
                <Select :model-value="(selected.settings.method ?? 'GET').toUpperCase()" @update:model-value="(value) => updateSetting('method', String(value))">
                  <SelectTrigger id="workflow-method" class="w-full"><SelectValue :placeholder="t('workflow.chooseMethod')" /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem v-for="method in HTTP_METHODS" :key="method" :value="method">{{ method }}</SelectItem></SelectGroup></SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-headers" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.httpHeaders') }}</Label>
                <Textarea id="workflow-headers" class="min-h-16 font-mono text-[12px]" placeholder="Authorization: Bearer …" :model-value="selected.settings.headers ?? ''" @update:model-value="updateSetting('headers', String($event))" />
                <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.httpHeadersHint') }}</p>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-body" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.httpBody') }}</Label>
                <Textarea id="workflow-body" class="min-h-20 font-mono text-[12px]" :model-value="selected.settings.body ?? ''" @update:model-value="updateSetting('body', String($event))" />
              </div>
            </template>

            <template v-else-if="selected.type === 'script'">
              <div class="flex flex-col gap-1">
                <Label for="workflow-runtime" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.runtime') }}</Label>
                <Select :model-value="selected.settings.runtime ?? 'shell'" @update:model-value="(value) => updateSetting('runtime', value as 'shell' | 'node')">
                  <SelectTrigger id="workflow-runtime" class="w-full"><SelectValue :placeholder="t('workflow.runtime')" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="shell">{{ t('workflow.runtimeShell') }}</SelectItem>
                      <SelectItem value="node">{{ t('workflow.runtimeNode') }}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label for="workflow-script" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.script') }}</Label>
                <Textarea id="workflow-script" class="min-h-28 font-mono text-[12px]" :model-value="selected.settings.script ?? ''" @update:model-value="updateSetting('script', String($event))" />
                <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.scriptHint') }}</p>
              </div>
            </template>

            <p v-else class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.passiveNodeHint') }}</p>
            <p v-if="['model', 'tool', 'script', 'http', 'approval'].includes(selected.type)" class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.effectHint') }}</p>
            <Button variant="destructive" size="sm" class="mt-0.5 self-start" @click="deleteSelected">
              <Trash2 aria-hidden="true" /> {{ t('workflow.remove') }}
            </Button>
          </div>

          <div v-else-if="selectedEdge" class="flex flex-col gap-2.5">
            <p class="m-0 text-[12px]">{{ edgeSummary(selectedEdge) }}</p>
            <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t('workflow.edgeTypeLabel') }}：{{ t(`workflow.edgeType.${selectedEdge.type}`) }}</p>
            <Button variant="destructive" size="sm" class="self-start" @click="deleteEdge(selectedEdge.id)">
              <Trash2 aria-hidden="true" /> {{ t('workflow.removeConnectionShort') }}
            </Button>
          </div>

          <p v-else class="m-0 text-[12px] text-[var(--color-mut)]">{{ t('workflow.selectNode') }}</p>
        </div>

        <div class="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
          <h3 class="m-0 pb-2 text-[12px] font-semibold text-[var(--color-txt-strong)]">{{ t('workflow.budgets') }}</h3>
          <div class="flex flex-col gap-2">
            <div class="flex flex-col gap-1">
              <Label for="workflow-steps" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.maxSteps') }}</Label>
              <Input id="workflow-steps" class="h-8" type="number" min="1" step="1" :model-value="modelValue.budgets?.maxSteps ?? ''" @update:model-value="updateBudget('maxSteps', $event)" />
            </div>
            <div class="flex flex-col gap-1">
              <Label for="workflow-effects" class="text-[11px] text-[var(--color-mut)]">{{ t('workflow.maxEffects') }}</Label>
              <Input id="workflow-effects" class="h-8" type="number" min="0" step="1" :model-value="modelValue.budgets?.maxEffects ?? ''" @update:model-value="updateBudget('maxEffects', $event)" />
            </div>
          </div>
        </div>

        <div v-if="modelValue.edges.length" class="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
          <h3 class="m-0 pb-1.5 text-[12px] font-semibold text-[var(--color-txt-strong)]">{{ t('workflow.connections') }}</h3>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <li v-for="edge in modelValue.edges" :key="edge.id">
              <Button
                variant="ghost"
                class="h-6 w-full justify-start gap-1.5 rounded-md px-1.5 text-[11px] font-normal hover:bg-[var(--color-menu-hover)]"
                :class="selectedEdgeId === edge.id ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
                :aria-label="t('workflow.selectConnection', { connection: edgeSummary(edge) })"
                @click="selectedId = null; selectedEdgeId = edge.id"
              >
                <span class="min-w-0 flex-1 truncate text-left">{{ edgeSummary(edge) }}</span>
                <span class="flex-none text-[10px] text-[var(--color-dim)]">{{ t(`workflow.edgeType.${edge.type}`) }}</span>
              </Button>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* 编辑器按自身宽度（而非窗口宽度）决定列数：窄面板里把配置面板收到画布下方 */
.wf-editor {
  container-type: inline-size;
}

.wf-layout {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 150px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) minmax(0, auto);
}

.wf-inspector {
  grid-column: span 2;
  max-height: 42%;
}

@container (min-width: 900px) {
  .wf-layout {
    grid-template-columns: 168px minmax(0, 1fr) 300px;
    grid-template-rows: minmax(0, 1fr);
  }

  .wf-inspector {
    grid-column: span 1;
    max-height: none;
  }
}

/* 节点语义色：全部由既有 token 混合得出，禁止写死色值 */
.wf-tone-ok { --wf-tone: var(--color-ok); }
.wf-tone-muted { --wf-tone: var(--color-mut); }
.wf-tone-accent { --wf-tone: var(--color-accent); }
.wf-tone-link { --wf-tone: var(--color-link); }
.wf-tone-warm { --wf-tone: var(--color-accent-2); }
.wf-tone-dim { --wf-tone: var(--color-dim); }

.wf-tone-icon { color: var(--wf-tone); }

.wf-tone-chip {
  color: var(--wf-tone);
  border-color: color-mix(in srgb, var(--wf-tone) 38%, transparent);
}

.wf-node {
  border-color: color-mix(in srgb, var(--wf-tone) 30%, var(--color-line));
  background: color-mix(in srgb, var(--wf-tone) 9%, var(--color-panel));
  cursor: grab;
  transition: border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out);
}

.wf-node:active { cursor: grabbing; }

.wf-node.is-selected {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--wf-tone) 14%, var(--color-panel));
}

.wf-palette:focus-visible,
.wf-node:focus-visible { outline: none; }

.wf-canvas {
  background-image: radial-gradient(var(--color-line) 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: 0 0;
}

.wf-edge__hit { cursor: pointer; }

.wf-edge:hover path:not(.wf-edge__hit) { stroke: var(--color-accent); }

.wf-edge.is-selected path:not(.wf-edge__hit) { stroke: var(--color-accent); }
</style>
