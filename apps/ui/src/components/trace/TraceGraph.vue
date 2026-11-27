<script setup lang="ts">
import {
  IconAlertTriangle as AlertTriangle,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconClockHour4 as ClockSlow,
  IconFocusCentered as FitIcon,
  IconLayersSubtract as Layers,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  GRAPH_METRICS,
  buildGraphLayout,
  type ClusterMeta,
  type LayoutGroup,
  type LayoutNode,
} from "@/lib/trace/graph-layout";
import { SLOW_STEP_MS, type TraceDocument } from "@/lib/trace/document";
import { formatDuration, offsetLabel } from "@/lib/trace/format";
import type { TraceFilterResult } from "@/lib/trace/queries";

import TraceHighlight from "./TraceHighlight.vue";
import TraceNodeIcon from "./TraceNodeIcon.vue";

/**
 * 轨迹图：轮次分组 + 工具聚簇 + 贝塞尔连线；支持拖拽平移、缩放、适应画布、
 * 定位错误 / 最慢，点击节点联动右侧检查器。
 */
const props = defineProps<{
  doc: TraceDocument;
  filter: TraceFilterResult;
  searchQuery: string;
  selectedId: string | null;
  focusNodeId: string | null;
  focusNonce: number;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const { t } = useI18n();

const MIN_SCALE = 0.4;
const MAX_SCALE = 1.5;

const viewportRef = ref<HTMLElement | null>(null);
const compactTools = ref(true);
const collapsedTurns = ref<Set<string>>(new Set());
const expandedClusters = ref<Set<string>>(new Set());
const scale = ref(1);
const pan = ref({ x: 16, y: 16 });
const dragging = ref(false);
const viewWidth = ref(0);
const viewHeight = ref(0);
let dragStart: { x: number; y: number; panX: number; panY: number } | null = null;
let resizeObserver: ResizeObserver | null = null;

/** 一张轮次卡片的最小可读宽度（节点 + 左右留白） */
const TURN_CARD_W = GRAPH_METRICS.NODE_W + GRAPH_METRICS.PAD_X * 2;

/**
 * 每行排几列：按轨迹视口宽度算，最多 3 列；窄了自动回落 2 列 / 1 列。
 * 列数变了会重新适应画布（结构变了，旧视角没意义）。
 */
const columns = computed(() => {
  const width = viewWidth.value || 860;
  const usable = width - 32 + GRAPH_METRICS.TURN_GAP_X;
  const per = TURN_CARD_W + GRAPH_METRICS.TURN_GAP_X;
  return Math.max(1, Math.min(GRAPH_METRICS.MAX_COLS, Math.floor(usable / per)));
});

const layout = computed(() =>
  buildGraphLayout(props.doc, {
    compactTools: compactTools.value,
    collapsedTurns: collapsedTurns.value,
    expandedClusters: expandedClusters.value,
    ...(props.filter.active ? { visibleTurnIds: props.filter.visibleTurnIds } : {}),
    columns: columns.value,
  }),
);

/**
 * 视口裁剪：轨迹动辄上千节点，全量挂载会让每次拖动/搜索都重排整张图。
 * 只渲染与视口（含一圈余量）相交的卡片与连线，布局坐标保持完整，
 * 所以搜索跳转、错误/最慢定位、聚簇展开仍能到达未挂载的区域。
 */
const CULL_MARGIN = 360;

const visibleRect = computed(() => {
  const width = viewWidth.value || 860;
  const height = viewHeight.value || 620;
  const s = scale.value;
  return {
    left: -pan.value.x / s - CULL_MARGIN,
    top: -pan.value.y / s - CULL_MARGIN,
    right: (-pan.value.x + width) / s + CULL_MARGIN,
    bottom: (-pan.value.y + height) / s + CULL_MARGIN,
  };
});

const visibleNodes = computed(() => {
  const rect = visibleRect.value;
  return layout.value.nodes.filter(
    (node) =>
      node.x < rect.right &&
      node.x + node.width > rect.left &&
      node.y < rect.bottom &&
      node.y + node.height > rect.top,
  );
});

const visibleGroups = computed(() => {
  const rect = visibleRect.value;
  return layout.value.groups.filter(
    (group) =>
      group.x < rect.right &&
      group.x + group.width > rect.left &&
      group.y < rect.bottom &&
      group.y + group.height > rect.top,
  );
});

const visibleEdges = computed(() => {
  const rect = visibleRect.value;
  return layout.value.edges.filter((edge) => {
    const minX = Math.min(edge.x1, edge.x2);
    const maxX = Math.max(edge.x1, edge.x2);
    const minY = Math.min(edge.y1, edge.y2);
    const maxY = Math.max(edge.y1, edge.y2);
    return maxX > rect.left && minX < rect.right && maxY > rect.top && minY < rect.bottom;
  });
});

const groupSubtitle = (group: LayoutGroup) =>
  [formatDuration(group.durationMs), t("trace.steps", { n: group.stepCount })]
    .filter(Boolean)
    .join(" · ");

function clusterLabel(cluster: ClusterMeta): string {
  const counts = cluster.counts;
  if (cluster.bucket === "explore") {
    const parts = [
      counts.files > 0 ? `${counts.files} ${t("trace.unitFiles")}` : "",
      counts.searches > 0 ? `${counts.searches} ${t("trace.unitSearches")}` : "",
      counts.folders > 0 ? `${counts.folders} ${t("trace.unitFolders")}` : "",
      counts.webs > 0 ? `${counts.webs} ${t("trace.unitWebs")}` : "",
    ].filter(Boolean);
    return `${t("trace.clusterExplore")} ${parts.join(t("trace.listSep"))}`;
  }
  if (cluster.bucket === "command") {
    return t("trace.clusterRanCommands", { n: counts.commands || cluster.nodeIds.length });
  }
  if (cluster.bucket === "edit") {
    return t("trace.clusterEditedFiles", { n: counts.edits || cluster.nodeIds.length });
  }
  return t("trace.clusterCalledTools", { n: cluster.nodeIds.length });
}

/**
 * 适应画布：只按宽度收，不按高度压。
 * 轮次多了图会变高，按高度压会让整张图缩到看不清；纵向交给拖拽/滚轮。
 */
function fitToView() {
  cancelPendingPan();
  const viewport = viewportRef.value;
  const { width } = layout.value;
  if (!viewport || width <= 0) {
    scale.value = 1;
    pan.value = { x: 16, y: 16 };
    return;
  }
  const viewPx = viewport.clientWidth || 840;
  const next = Math.max(MIN_SCALE, Math.min(1, (viewPx - 32) / width));
  scale.value = Number(next.toFixed(2));
  pan.value = {
    x: Math.max(12, Math.round((viewPx - width * scale.value) / 2)),
    y: 16,
  };
}

function zoomBy(delta: number) {
  scale.value = Math.max(
    MIN_SCALE,
    Math.min(MAX_SCALE, Number((scale.value + delta).toFixed(2))),
  );
}

function centerOnNode(nodeId: string) {
  cancelPendingPan();
  const node = layout.value.nodeById[nodeId];
  const viewport = viewportRef.value;
  if (!node || !viewport) {
    return;
  }
  const viewPx = viewport.clientWidth || 840;
  const viewPxY = viewport.clientHeight || 620;
  pan.value = {
    x: Math.round(viewPx / 2 - (node.x + node.width / 2) * scale.value),
    y: Math.round(viewPxY / 2 - (node.y + node.height / 2) * scale.value),
  };
}

watch(
  () => props.doc.from,
  () => {
    // 只在换会话（轨迹起点变了）时适应画布：流式追加新节点、开关聚簇都不打断当前视角
    void nextTick(fitToView);
  },
);

watch(
  () => `${props.focusNodeId}:${props.focusNonce}`,
  async () => {
    if (!props.focusNodeId || props.focusNonce === 0) {
      return;
    }
    await nextTick();
    const target = props.doc.nodesById[props.focusNodeId];
    if (!target) {
      return;
    }
    if (collapsedTurns.value.has(target.turnId)) {
      const next = new Set(collapsedTurns.value);
      next.delete(target.turnId);
      collapsedTurns.value = next;
      await nextTick();
    }
    const cluster = layout.value.nodes.find(
      (node) => node.kind === "cluster" && node.cluster?.nodeIds.includes(props.focusNodeId ?? ""),
    );
    if (cluster?.cluster) {
      const next = new Set(expandedClusters.value);
      next.add(cluster.cluster.id);
      expandedClusters.value = next;
      await nextTick();
    }
    centerOnNode(props.focusNodeId);
  },
);

const firstErrorId = computed(
  () => props.doc.orderedNodeIds.find((id) => props.doc.nodesById[id]?.status === "error") ?? null,
);

const slowestId = computed(() => {
  let bestId: string | null = null;
  let bestMs = -1;
  for (const id of props.doc.orderedNodeIds) {
    const node = props.doc.nodesById[id];
    if (!node || node.kind === "user" || node.kind === "reply") {
      continue;
    }
    if ((node.durationMs ?? -1) > bestMs) {
      bestMs = node.durationMs ?? -1;
      bestId = id;
    }
  }
  return bestId;
});

function toggleTurn(turnId: string) {
  const next = new Set(collapsedTurns.value);
  if (next.has(turnId)) {
    next.delete(turnId);
  } else {
    next.add(turnId);
  }
  collapsedTurns.value = next;
}

function expandCluster(clusterId: string) {
  expandedClusters.value = new Set(expandedClusters.value).add(clusterId);
}

function toggleCompact() {
  compactTools.value = !compactTools.value;
  expandedClusters.value = new Set();
}

function jumpTo(nodeId: string | null) {
  if (!nodeId) {
    return;
  }
  emit("select", nodeId);
  centerOnNode(nodeId);
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }
  if ((event.target as HTMLElement).closest("button")) {
    return;
  }
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    panX: pan.value.x,
    panY: pan.value.y,
  };
  dragging.value = true;
}

/** 平移按帧合并：一次 pointermove 一个渲染，剩下的等下一帧 */
let panFrame = 0;
let pendingPan: { x: number; y: number } | null = null;

/** 直接改视角（适应画布 / 定位）时丢掉还没提交的拖拽帧，免得覆盖 */
function cancelPendingPan() {
  pendingPan = null;
  if (panFrame) {
    cancelAnimationFrame(panFrame);
    panFrame = 0;
  }
}

function commitPan(next: { x: number; y: number }) {
  pendingPan = next;
  if (panFrame) {
    return;
  }
  panFrame = requestAnimationFrame(() => {
    panFrame = 0;
    if (pendingPan) {
      pan.value = pendingPan;
      pendingPan = null;
    }
  });
}

function onPointerMove(event: PointerEvent) {
  if (!dragStart) {
    return;
  }
  commitPan({
    x: dragStart.panX + (event.clientX - dragStart.x),
    y: dragStart.panY + (event.clientY - dragStart.y),
  });
}

function onPointerUp() {
  dragStart = null;
  dragging.value = false;
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
    return;
  }
  commitPan({ x: pan.value.x - event.deltaX, y: pan.value.y - event.deltaY });
}

function isMatch(node: LayoutNode): boolean {
  return props.filter.active && props.filter.matchedIds.has(node.id);
}

function isDim(id: string): boolean {
  return props.filter.active && !props.filter.matchedIds.has(id);
}

watch(columns, () => {
  void nextTick(fitToView);
});

/**
 * 视口宽度：轨迹图在“无轮次”时会渲染空态，挂载那一刻 ref 还是 null，
 * 所以用 watch 绑观察器，等图真正出现再量宽，列数才跟得上面板宽度。
 */
function bindViewport(el: HTMLElement | null) {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) {
    return;
  }
  viewWidth.value = el.clientWidth;
  viewHeight.value = el.clientHeight;
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) {
      viewWidth.value = Math.round(entry.contentRect.width);
      viewHeight.value = Math.round(entry.contentRect.height);
    }
  });
  resizeObserver.observe(el);
}

watch(viewportRef, bindViewport, { immediate: true, flush: "post" });

onMounted(() => {
  void nextTick(fitToView);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  cancelPendingPan();
});
</script>

<template>
  <div v-if="!props.doc.rootTurnIds.length" class="trace-empty">
    <p>{{ t("trace.emptyTrace") }}</p>
  </div>
  <div v-else class="graph-root">
    <div class="graph-toolbar">
      <div class="graph-toolgroup">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('trace.graphZoomOut')"
          @click="zoomBy(-0.15)"
        >
          <ZoomOut />
        </Button>
        <span class="zoom-label">{{ Math.round(scale * 100) }}%</span>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('trace.graphZoomIn')"
          @click="zoomBy(0.15)"
        >
          <ZoomIn />
        </Button>
        <Button variant="ghost" size="sm" @click="fitToView">
          <FitIcon />
          {{ t("trace.graphZoomFit") }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          @click="
            scale = 1;
            pan = { x: 16, y: 16 };
          "
        >
          {{ t("trace.graphReset") }}
        </Button>
      </div>

      <div class="graph-toolgroup">
        <Button
          :variant="compactTools ? 'secondary' : 'ghost'"
          size="sm"
          :aria-pressed="compactTools"
          @click="toggleCompact"
        >
          <Layers />
          {{ compactTools ? t("trace.graphCompact") : t("trace.graphExpandAll") }}
        </Button>
        <Button
          v-if="firstErrorId"
          variant="ghost"
          size="sm"
          class="danger-btn"
          @click="jumpTo(firstErrorId)"
        >
          <AlertTriangle />
          {{ t("trace.graphJumpError") }}
        </Button>
        <Button v-if="slowestId" variant="ghost" size="sm" @click="jumpTo(slowestId)">
          <ClockSlow />
          {{ t("trace.graphJumpSlowest") }}
        </Button>
      </div>
    </div>

    <div
      ref="viewportRef"
      class="graph-viewport"
      :data-dragging="dragging || undefined"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div
        class="graph-world"
        :style="{
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
        }"
      >
        <div
          v-for="group in visibleGroups"
          :key="group.id"
          class="graph-group"
          :data-status="group.status"
          :data-collapsed="group.collapsed || undefined"
          :style="{
            left: `${group.x}px`,
            top: `${group.y}px`,
            width: `${group.width}px`,
            height: `${group.height}px`,
          }"
        >
          <Button
            variant="ghost"
            class="group-head"
            :aria-expanded="!group.collapsed"
            @click="toggleTurn(group.turnId)"
          >
            <component :is="group.collapsed ? ChevronRight : ChevronDown" :size="14" />
            <span class="group-title">{{ group.title }}</span>
            <span class="group-sub">{{ groupSubtitle(group) }}</span>
          </Button>
        </div>

        <svg class="graph-edges" :width="layout.width" :height="layout.height" aria-hidden="true">
          <path
            v-for="edge in visibleEdges"
            :key="edge.id"
            :d="edge.d"
            class="edge-path"
            :data-kind="edge.kind"
            :data-status="edge.status"
            :data-linked="
              selectedId !== null && (edge.fromId === selectedId || edge.toId === selectedId)
                ? true
                : undefined
            "
          />
        </svg>

        <template v-for="node in visibleNodes" :key="node.id">
          <Button
            v-if="node.kind === 'cluster' && node.cluster"
            variant="ghost"
            class="cluster-card"
            :data-match="isMatch(node) || undefined"
            :data-dim="isDim(node.id) || undefined"
            :style="{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.width}px`,
              height: `${node.height}px`,
            }"
            @click="expandCluster(node.cluster.id)"
          >
            <span class="node-head">
              <span class="node-icon"><Layers :size="13" /></span>
              <span class="node-title">{{ clusterLabel(node.cluster) }}</span>
              <span v-if="node.cluster.durationMs" class="node-dur">
                {{ formatDuration(node.cluster.durationMs) }}
              </span>
            </span>
            <span class="node-sub">{{ t("trace.expandCluster", { n: node.cluster.nodeIds.length }) }}</span>
          </Button>

          <Button
            v-else-if="node.node"
            variant="ghost"
            class="node-card"
            :data-kind="node.node.kind"
            :data-status="node.node.status"
            :data-selected="selectedId === node.node.id || undefined"
            :data-match="isMatch(node) || undefined"
            :data-dim="isDim(node.node.id) || undefined"
            :style="{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.width}px`,
              height: `${node.height}px`,
            }"
            @click="emit('select', node.node.id)"
          >
            <span class="node-head">
              <span class="node-icon" :data-kind="node.node.kind">
                <TraceNodeIcon :node="node.node" :size="14" />
              </span>
              <span class="node-title">
                <TraceHighlight :text="node.node.title" :query="searchQuery" />
              </span>
              <span
                v-if="formatDuration(node.node.durationMs)"
                class="node-dur"
                :data-slow="
                  (node.node.durationMs ?? 0) >= SLOW_STEP_MS ? true : undefined
                "
              >
                {{ formatDuration(node.node.durationMs) }}
              </span>
            </span>
            <span class="node-foot">
              <span class="node-sub">
                <TraceHighlight
                  v-if="node.node.subtitle"
                  :text="node.node.subtitle"
                  :query="searchQuery"
                />
                <template v-else-if="node.node.start !== undefined">
                  {{ offsetLabel(node.node.start, props.doc.from) }}
                </template>
              </span>
              <span v-if="node.node.status !== 'done'" class="node-status" :data-status="node.node.status">
                {{
                  node.node.status === "error"
                    ? t("trace.failed")
                    : node.node.status === "running"
                      ? t("trace.running")
                      : t("trace.stopped")
                }}
              </span>
            </span>
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-root {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.graph-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-sunken);
}

.graph-toolgroup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.zoom-label {
  min-width: 40px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-mut);
}

.danger-btn {
  color: var(--agent-danger);
}

.graph-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  background-color: var(--color-sunken);
  background-image: radial-gradient(var(--color-line-strong) 1px, transparent 1px);
  background-size: 18px 18px;
}

.graph-viewport[data-dragging="true"] {
  cursor: grabbing;
}

.graph-world {
  position: relative;
  transform-origin: 0 0;
}

.graph-group {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-sunken) 78%, transparent);
}

.graph-group[data-status="error"] {
  border-color: color-mix(in srgb, var(--agent-danger) 55%, transparent);
}

.group-head {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: 0 8px;
  border-radius: 0;
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 400;
}

.graph-group[data-collapsed] .group-head {
  border-bottom: none;
}

.group-title {
  flex: none;
  font-weight: 600;
  white-space: nowrap;
}

.group-sub {
  margin-inline-start: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-dim);
  font-size: 12px;
}

.graph-edges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.edge-path {
  fill: none;
  stroke: var(--color-line-strong);
  stroke-width: 1.5;
  opacity: 0.72;
}

.edge-path[data-kind="parallel"] {
  stroke: var(--color-accent);
  stroke-dasharray: 5 4;
}

.edge-path[data-status="error"] {
  stroke: var(--agent-danger);
}

.edge-path[data-linked="true"] {
  stroke: var(--color-accent);
  stroke-width: 2.5;
  opacity: 1;
}

.node-card,
.cluster-card {
  position: absolute;
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-raise);
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 400;
  text-align: start;
  white-space: normal;
  box-shadow: var(--shadow-raised);
}

.cluster-card {
  border-style: dashed;
  background: var(--color-sunken);
}

.node-card:hover,
.cluster-card:hover {
  border-color: var(--color-line-strong);
  background: var(--color-sunken);
}

.node-card[data-kind="user"] {
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-raise));
}

.node-card[data-kind="thinking"] {
  border-color: color-mix(in srgb, var(--agent-thinking) 45%, transparent);
  background: color-mix(in srgb, var(--agent-thinking) 10%, var(--color-raise));
}

.node-card[data-kind="reply"] {
  border-color: color-mix(in srgb, var(--agent-success) 45%, transparent);
  background: color-mix(in srgb, var(--agent-success) 9%, var(--color-raise));
}

.node-card[data-status="error"],
.node-card[data-kind="error"] {
  border-color: color-mix(in srgb, var(--agent-danger) 55%, transparent);
  background: color-mix(in srgb, var(--agent-danger) 12%, var(--color-raise));
}

.node-card[data-selected="true"],
.cluster-card[data-selected="true"] {
  border-width: 2px;
  border-color: var(--color-accent);
  box-shadow: var(--shadow-pop);
}

.node-card[data-match="true"],
.cluster-card[data-match="true"] {
  border-color: var(--agent-approval);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agent-approval) 25%, transparent);
}

.node-card[data-dim="true"],
.cluster-card[data-dim="true"] {
  opacity: 0.35;
}

.node-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.node-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--color-mut);
}

.node-icon[data-kind="thinking"] {
  color: var(--agent-thinking);
}

.node-icon[data-kind="reply"] {
  color: var(--agent-success);
}

.node-icon[data-kind="error"] {
  color: var(--agent-danger);
}

.node-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.node-dur {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--color-dim);
}

.node-dur[data-slow="true"] {
  color: var(--agent-approval);
  font-weight: 600;
}

.node-foot {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.node-sub {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--color-dim);
}

.node-status {
  flex: none;
  font-size: 11px;
  color: var(--agent-approval);
}

.node-status[data-status="error"] {
  color: var(--agent-danger);
}

.node-status[data-status="running"] {
  color: var(--color-accent);
}

.trace-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--color-dim);
  font-size: 13px;
}
</style>
