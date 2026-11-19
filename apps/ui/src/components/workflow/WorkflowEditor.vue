<script setup lang="ts">
import { computed, shallowRef, useId } from "vue";
import { ArrowDown, ArrowUp, Grip, Plus, Trash2 } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canConnect, edgeTypesFor, moveNode, NODE_TYPES, removeNode, toRuntimeWorkflow } from "./graph";
import type { WorkflowEdge, WorkflowEdgeType, WorkflowGraph, WorkflowNode, WorkflowNodeType } from "./graph";

/** Controlled JSON graph. The parent must apply update:modelValue. */
const props = defineProps<{ modelValue: WorkflowGraph; models?: { providerId: string; modelId: string; label: string }[] }>();
const emit = defineEmits<{ "update:modelValue": [graph: WorkflowGraph]; selectionChange: [id: string | null] }>();

const selectedId = shallowRef<string | null>(null);
const sourceId = shallowRef("");
const targetId = shallowRef("");
const edgeType = shallowRef<WorkflowEdgeType>("next");
const validation = computed(() => {
  try { toRuntimeWorkflow(props.modelValue); return "Graph ready to save"; }
  catch (error) { return error instanceof Error ? error.message : "Invalid workflow graph"; }
});
const valid = computed(() => validation.value === "Graph ready to save");
const selectedModel = computed(() => props.models?.find((model) => model.providerId === selected.value?.settings.providerId && model.modelId === selected.value?.settings.modelId));
const selectedModelKey = computed(() => selectedModel.value ? JSON.stringify([selectedModel.value.providerId, selectedModel.value.modelId]) : undefined);
function chooseModel(key: unknown) {
  const model = props.models?.find((item) => JSON.stringify([item.providerId, item.modelId]) === key);
  if (model && selected.value) updateNode({ settings: { ...selected.value.settings, providerId: model.providerId, modelId: model.modelId } });
}
const newType = shallowRef<WorkflowNodeType>("model");
const selected = computed(() => props.modelValue.nodes.find((node) => node.id === selectedId.value));
const source = computed(() => props.modelValue.nodes.find((node) => node.id === sourceId.value));
const availableEdgeTypes = computed(() => source.value ? edgeTypesFor(source.value.type) : []);
const chosenEdgeType = computed(() => availableEdgeTypes.value.includes(edgeType.value) ? edgeType.value : availableEdgeTypes.value[0]);
const arrowId = useId();
const canvasWidth = computed(() => Math.max(960, ...props.modelValue.nodes.map((node) => node.x + 300)));
const canvasHeight = computed(() => Math.max(540, ...props.modelValue.nodes.map((node) => node.y + 180)));
const nodeMap = computed(() => new Map(props.modelValue.nodes.map((node) => [node.id, node])));
const connections = computed(() => props.modelValue.edges.flatMap((edge) => {
  const from = nodeMap.value.get(edge.source);
  const to = nodeMap.value.get(edge.target);
  return from && to ? [{ edge, from, to }] : [];
}));
const drag = shallowRef<{ id: string; x: number; y: number; originX: number; originY: number } | null>(null);

function publish(graph: WorkflowGraph) { emit("update:modelValue", graph); }
function select(id: string | null) {
  selectedId.value = id;
  emit("selectionChange", id);
}
function uniqueId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function addNode() {
  const index = props.modelValue.nodes.length;
  const node: WorkflowNode = {
    id: uniqueId(), type: newType.value, label: newType.value,
    x: 48 + (index % 3) * 260, y: 56 + Math.floor(index / 3) * 150, settings: {},
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
function addEdge() {
  const type = chosenEdgeType.value;
  if (!type || !canConnect(props.modelValue, sourceId.value, targetId.value, type)) return;
  publish({ ...props.modelValue, edges: [...props.modelValue.edges, {
    id: uniqueId(), source: sourceId.value, target: targetId.value, type,
  }] });
}
function deleteEdge(id: string) {
  publish({ ...props.modelValue, edges: props.modelValue.edges.filter((edge) => edge.id !== id) });
}
function move(id: string, dx: number, dy: number) {
  publish({ ...props.modelValue, nodes: props.modelValue.nodes.map((node) => node.id === id ? {
    ...node, x: Math.max(0, node.x + dx), y: Math.max(0, node.y + dy),
  } : node) });
}
function startDrag(event: PointerEvent, node: WorkflowNode) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag.value = { id: node.id, x: event.clientX, y: event.clientY, originX: node.x, originY: node.y };
  select(node.id);
}
function onDrag(event: PointerEvent) {
  if (!drag.value) return;
  const { id, x, y, originX, originY } = drag.value;
  publish({ ...props.modelValue, nodes: props.modelValue.nodes.map((node) => node.id === id ? {
    ...node, x: Math.max(0, Math.round(originX + event.clientX - x)),
    y: Math.max(0, Math.round(originY + event.clientY - y)),
  } : node) });
}
function stopDrag() { drag.value = null; }
function onHandleKey(event: KeyboardEvent, id: string) {
  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20],
  };
  const step = steps[event.key];
  if (!step) return;
  event.preventDefault();
  move(id, step[0], step[1]);
}
function edgePath(from: WorkflowNode, to: WorkflowNode) {
  const x1 = from.x + 208; const y1 = from.y + 48;
  const x2 = to.x; const y2 = to.y + 48;
  const bend = Math.max(50, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
function edgeLabel(edge: WorkflowEdge) {
  const from = nodeMap.value.get(edge.source)?.label ?? edge.source;
  const to = nodeMap.value.get(edge.target)?.label ?? edge.target;
  return `${from} → ${to} (${edge.type})`;
}
</script>

<template>
  <section class="flex min-h-0 flex-col gap-3 text-[var(--color-txt)]" aria-label="Workflow editor">
    <div class="flex flex-wrap items-center gap-2">
      <Label for="workflow-new-type">Node type</Label>
      <Select v-model="newType">
        <SelectTrigger id="workflow-new-type" class="w-40"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem v-for="type in NODE_TYPES" :key="type" :value="type">{{ type }}</SelectItem>
        </SelectGroup></SelectContent>
      </Select>
      <Button size="sm" @click="addNode"><Plus aria-hidden="true" /> Add node</Button>
      <span class="text-xs text-[var(--color-mut)]">Select a node to inspect. Drag its handle or use arrow keys to position it.</span>
    </div>

    <div class="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div class="min-h-[400px] overflow-auto rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-sunken)]" aria-label="Workflow graph">
        <div class="relative" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }">
          <svg class="pointer-events-none absolute inset-0 size-full" :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`" aria-hidden="true">
            <defs><marker :id="arrowId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-mut)" /></marker></defs>
            <path v-for="connection in connections" :key="connection.edge.id" :d="edgePath(connection.from, connection.to)" fill="none" stroke="var(--color-mut)" stroke-width="2" :marker-end="`url(#${arrowId})`" />
          </svg>
          <Card v-for="node in modelValue.nodes" :key="node.id" class="absolute w-52 border-[var(--color-line)] bg-[var(--color-panel)] shadow-[var(--shadow-menu)]" :class="selectedId === node.id ? 'border-[var(--color-accent)]' : ''" :style="{ left: `${node.x}px`, top: `${node.y}px` }">
            <CardHeader class="flex flex-row items-center gap-1 p-2">
              <Button variant="ghost" size="icon-sm" :aria-label="`Move ${node.label}; use arrow keys`" class="cursor-grab touch-none" @pointerdown="startDrag($event, node)" @pointermove="onDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @keydown="onHandleKey($event, node.id)"><Grip aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" class="min-w-0 flex-1 justify-start truncate" :aria-pressed="selectedId === node.id" :aria-label="`Inspect ${node.label}, ${node.type} node`" @click="select(node.id)">{{ node.label }}</Button>
            </CardHeader>
            <CardContent class="flex gap-1 px-3 pb-2"><Badge variant="secondary">{{ node.type }}</Badge><Badge v-if="['tool', 'script', 'http'].includes(node.type)" variant="destructive">Unsupported</Badge></CardContent>
          </Card>
          <p v-if="!modelValue.nodes.length" class="absolute left-6 top-6 text-sm text-[var(--color-mut)]">No nodes yet. Choose a type and add one.</p>
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-4 overflow-auto">
        <Card>
          <CardHeader><CardTitle class="text-sm">Run budgets</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-3">
            <div class="flex flex-col gap-1"><Label for="workflow-steps">Maximum steps</Label><Input id="workflow-steps" type="number" min="1" step="1" :model-value="modelValue.budgets?.maxSteps ?? ''" @update:model-value="updateBudget('maxSteps', $event)" /></div>
            <div class="flex flex-col gap-1"><Label for="workflow-effects">Maximum effects</Label><Input id="workflow-effects" type="number" min="0" step="1" :model-value="modelValue.budgets?.maxEffects ?? ''" @update:model-value="updateBudget('maxEffects', $event)" /></div>
            <p :role="valid ? 'status' : 'alert'" class="text-xs text-[var(--color-mut)]">{{ validation }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle class="text-sm">{{ selected ? `Node · ${selected.type}` : "Inspector" }}</CardTitle></CardHeader>
          <CardContent v-if="selected" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1"><Label for="workflow-label">Name</Label><Input id="workflow-label" :model-value="selected.label" @update:model-value="updateNode({ label: String($event) })" /></div>
            <div v-if="selected.type === 'model'" class="flex flex-col gap-1"><Label for="workflow-model">Model</Label>
              <Select :model-value="selectedModelKey" @update:model-value="chooseModel">
                <SelectTrigger id="workflow-model" class="w-full"><SelectValue placeholder="Choose a provider / model" /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem v-for="model in models ?? []" :key="JSON.stringify([model.providerId, model.modelId])" :value="JSON.stringify([model.providerId, model.modelId])">{{ model.label }}</SelectItem></SelectGroup></SelectContent>
              </Select>
              <p v-if="!models?.length" class="text-xs text-[var(--color-mut)]">Enable a model in settings before selecting it.</p>
              <p v-else-if="selected.settings.modelId && !selectedModel" role="alert" class="text-xs text-[var(--color-danger-fg)]">Saved model is unavailable; select an enabled provider and model.</p>
            </div>
            <p v-if="['model', 'tool', 'script', 'http', 'approval'].includes(selected.type)" class="text-xs text-[var(--color-mut)]">Effects require review after an interrupted run. This editor does not claim adapter idempotency.</p>
            <div v-if="selected.type === 'tool'" class="flex flex-col gap-1"><Label for="workflow-tool">Tool name</Label><Input id="workflow-tool" :model-value="selected.settings.toolName ?? ''" @update:model-value="updateSetting('toolName', String($event))" /></div>
            <template v-if="selected.type === 'condition'">
              <p v-if="selected.settings.expression !== undefined" role="alert" class="text-xs text-[var(--color-danger-fg)]">Legacy expression is unsupported. Replace it with a comparison.</p>
              <div class="flex flex-col gap-1"><Label for="workflow-left">Left value</Label><Input id="workflow-left" :model-value="selected.settings.left ?? ''" placeholder="Literal or $model-node-id" @update:model-value="updateNode({ settings: { ...selected.settings, expression: undefined, left: String($event) } })" /></div>
              <div class="flex flex-col gap-1"><Label for="workflow-operator">Operator</Label><Select :model-value="selected.settings.operator" @update:model-value="updateSetting('operator', $event as 'equals' | 'not-equals')"><SelectTrigger id="workflow-operator"><SelectValue placeholder="Choose comparison" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="equals">Equals</SelectItem><SelectItem value="not-equals">Does not equal</SelectItem></SelectGroup></SelectContent></Select></div>
              <div class="flex flex-col gap-1"><Label for="workflow-right">Right value</Label><Input id="workflow-right" :model-value="selected.settings.right ?? ''" placeholder="Literal or $model-node-id" @update:model-value="updateNode({ settings: { ...selected.settings, expression: undefined, right: String($event) } })" /></div>
            </template>
            <div v-if="selected.type === 'loop'" class="flex flex-col gap-1"><Label for="workflow-iterations">Max iterations (optional)</Label><Input id="workflow-iterations" type="number" min="0" :model-value="selected.settings.maxIterations ?? ''" @update:model-value="updatePositiveSetting($event)" /><p class="text-xs text-[var(--color-mut)]">Leave blank for an unbounded loop; global step and wall-time budgets still apply.</p></div>
            <div v-if="selected.type === 'http'" class="flex flex-col gap-1"><Label for="workflow-url">URL</Label><Input id="workflow-url" type="url" :model-value="selected.settings.url ?? ''" @update:model-value="updateSetting('url', String($event))" /></div>
            <div v-if="selected.type === 'http'" class="flex flex-col gap-1"><Label for="workflow-method">Method</Label><Input id="workflow-method" :model-value="selected.settings.method ?? ''" placeholder="GET" @update:model-value="updateSetting('method', String($event))" /></div>
            <div v-if="selected.type === 'script'" class="flex flex-col gap-1"><Label for="workflow-script">Script</Label><Textarea id="workflow-script" :model-value="selected.settings.script ?? ''" @update:model-value="updateSetting('script', String($event))" /></div>
            <div v-if="selected.type === 'model' || selected.type === 'approval' || selected.type === 'tool'" class="flex flex-col gap-1"><Label for="workflow-instructions">Instructions</Label><Textarea id="workflow-instructions" :model-value="selected.settings.instructions ?? ''" @update:model-value="updateSetting('instructions', String($event))" /></div>
            <div class="flex flex-wrap gap-1">
              <Button variant="outline" size="sm" :disabled="modelValue.nodes[0]?.id === selected.id" @click="publish(moveNode(modelValue, selected.id, -1))"><ArrowUp aria-hidden="true" /> Earlier</Button>
              <Button variant="outline" size="sm" :disabled="modelValue.nodes[modelValue.nodes.length - 1]?.id === selected.id" @click="publish(moveNode(modelValue, selected.id, 1))"><ArrowDown aria-hidden="true" /> Later</Button>
              <Button variant="destructive" size="sm" @click="deleteSelected"><Trash2 aria-hidden="true" /> Remove</Button>
            </div>
          </CardContent>
          <CardContent v-else class="text-sm text-[var(--color-mut)]">Select a node to inspect and configure it.</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle class="text-sm">Connections</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <Label for="workflow-source">From</Label>
            <Select v-model="sourceId"><SelectTrigger id="workflow-source" class="w-full"><SelectValue placeholder="Source node" /></SelectTrigger><SelectContent><SelectGroup><SelectItem v-for="node in modelValue.nodes.filter(n => n.type !== 'end')" :key="node.id" :value="node.id">{{ node.label }} · {{ node.type }}</SelectItem></SelectGroup></SelectContent></Select>
            <Label for="workflow-target">To</Label>
            <Select v-model="targetId"><SelectTrigger id="workflow-target" class="w-full"><SelectValue placeholder="Target node" /></SelectTrigger><SelectContent><SelectGroup><SelectItem v-for="node in modelValue.nodes.filter(n => n.type !== 'start')" :key="node.id" :value="node.id">{{ node.label }} · {{ node.type }}</SelectItem></SelectGroup></SelectContent></Select>
            <Label for="workflow-edge-type">Edge type</Label>
            <Select :model-value="chosenEdgeType" @update:model-value="edgeType = $event as WorkflowEdgeType"><SelectTrigger id="workflow-edge-type" class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem v-for="type in availableEdgeTypes" :key="type" :value="type">{{ type }}</SelectItem></SelectGroup></SelectContent></Select>
            <Button size="sm" :disabled="!chosenEdgeType || !canConnect(modelValue, sourceId, targetId, chosenEdgeType)" @click="addEdge"><Plus aria-hidden="true" /> Connect</Button>
            <p v-if="!modelValue.edges.length" class="text-xs text-[var(--color-mut)]">No connections yet.</p>
            <div v-for="edge in modelValue.edges" :key="edge.id" class="flex items-center gap-1 border-t border-[var(--color-line)] pt-2 text-xs">
              <span class="min-w-0 flex-1 break-words">{{ edgeLabel(edge) }}</span>
              <Button variant="ghost" size="icon-sm" :aria-label="`Remove connection ${edgeLabel(edge)}`" @click="deleteEdge(edge.id)"><Trash2 aria-hidden="true" /></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </section>
</template>
