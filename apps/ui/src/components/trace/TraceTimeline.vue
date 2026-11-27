<script setup lang="ts">
import {
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
} from "@tabler/icons-vue";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useLazyReveal } from "@/composables/useLazyReveal";

import { Button } from "@/components/ui/button";
import { SLOW_STEP_MS, type TraceDocument, type TraceNode, type TraceTurn } from "@/lib/trace/document";
import { formatDuration, offsetLabel } from "@/lib/trace/format";
import type { TraceFilterResult } from "@/lib/trace/queries";

import TraceHighlight from "./TraceHighlight.vue";
import TraceNodeIcon from "./TraceNodeIcon.vue";

/**
 * 时间线：按时间轴 / 按耗时对比双比例尺，轮次分组可折叠，
 * ArrowUp / ArrowDown 逐行浏览，点击行联动检查器。
 */
const props = defineProps<{
  doc: TraceDocument;
  filter: TraceFilterResult;
  searchQuery: string;
  selectedId: string | null;
  inspectorOpen: boolean;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const { t } = useI18n();

type ScaleMode = "time" | "duration";

const scaleMode = ref<ScaleMode>("time");
const collapsedTurns = ref<Set<string>>(new Set());
const listRef = ref<HTMLElement | null>(null);
/** 上千行时分批挂载：滚到附近才建行，占位高度与行高一致，滚动条不跳 */
const { revealed, observe } = useLazyReveal();

const visibleTurns = computed<TraceTurn[]>(() => {
  const roots = props.doc.rootTurnIds
    .map((id) => props.doc.turnsById[id])
    .filter((turn): turn is TraceTurn => turn !== undefined);
  if (!props.filter.active) {
    return roots;
  }
  return roots.filter((turn) => props.filter.visibleTurnIds.has(turn.id));
});

interface FlatRow {
  node: TraceNode;
  turnId: string;
}

const rowsByTurn = computed(() => {
  const map = new Map<string, FlatRow[]>();
  for (const turn of visibleTurns.value) {
    const rows: FlatRow[] = [];
    for (const id of turn.nodeIds) {
      const node = props.doc.nodesById[id];
      if (!node) {
        continue;
      }
      if (!props.filter.active || props.filter.matchedIds.has(node.id)) {
        rows.push({ node, turnId: turn.id });
      }
    }
    if (rows.length) {
      map.set(turn.id, rows);
    }
  }
  return map;
});

const flatRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = [];
  for (const turn of visibleTurns.value) {
    if (collapsedTurns.value.has(turn.id)) {
      continue;
    }
    rows.push(...(rowsByTurn.value.get(turn.id) ?? []));
  }
  return rows;
});

const maxStepMs = computed(() => {
  let max = 1;
  for (const row of flatRows.value) {
    if (row.node.durationMs !== undefined && row.node.durationMs > max) {
      max = row.node.durationMs;
    }
  }
  return max;
});

const spanTotal = computed(() => Math.max(1, props.doc.to - props.doc.from));

function barOf(node: TraceNode): { left: number; width: number } | null {
  if (scaleMode.value === "duration") {
    if (node.durationMs === undefined) {
      return null;
    }
    const width = Math.max(1.5, (node.durationMs / maxStepMs.value) * 100);
    return { left: 0, width: Math.min(100, width) };
  }
  if (node.start === undefined) {
    return null;
  }
  const left = ((node.start - props.doc.from) / spanTotal.value) * 100;
  const end = node.end ?? props.doc.to;
  const width = Math.max(0.8, ((end - node.start) / spanTotal.value) * 100);
  return {
    left: Math.max(0, Math.min(99, left)),
    width: Math.min(100 - Math.max(0, left), width),
  };
}

watch(
  () => props.selectedId,
  async () => {
    if (!props.selectedId) {
      return;
    }
    await nextTick();
    listRef.value
      ?.querySelector<HTMLElement>(`[data-node-id="${props.selectedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  },
);

function toggleTurn(turnId: string) {
  const next = new Set(collapsedTurns.value);
  if (next.has(turnId)) {
    next.delete(turnId);
  } else {
    next.add(turnId);
  }
  collapsedTurns.value = next;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  if (!flatRows.value.length) {
    return;
  }
  event.preventDefault();
  const current = props.selectedId
    ? flatRows.value.findIndex((row) => row.node.id === props.selectedId)
    : -1;
  const nextIndex =
    event.key === "ArrowDown"
      ? Math.min(flatRows.value.length - 1, current + 1)
      : Math.max(0, current <= 0 ? 0 : current - 1);
  const next = flatRows.value[nextIndex];
  if (next) {
    emit("select", next.node.id);
  }
}
</script>

<template>
  <p v-if="!flatRows.length" class="trace-hint">{{ t("trace.emptyNoSteps") }}</p>
  <div v-else class="timeline-root" @keydown="onKeydown">
    <div class="timeline-topbar">
      <div class="segmented">
        <Button
          variant="ghost"
          size="xs"
          class="seg-btn"
          :aria-pressed="scaleMode === 'time'"
          @click="scaleMode = 'time'"
        >
          {{ t("trace.waterfallTime") }}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          class="seg-btn"
          :aria-pressed="scaleMode === 'duration'"
          @click="scaleMode = 'duration'"
        >
          {{ t("trace.waterfallDuration") }}
        </Button>
      </div>
      <div class="scale" aria-hidden="true">
        <template v-if="scaleMode === 'time'">
          <span>{{ offsetLabel(props.doc.from, props.doc.from) }}</span>
          <span>{{ offsetLabel(props.doc.to, props.doc.from) }}</span>
        </template>
        <template v-else>
          <span>0ms</span>
          <span>{{ formatDuration(maxStepMs) }}</span>
        </template>
      </div>
    </div>

    <ul ref="listRef" class="timeline-list">
      <li v-for="turn in visibleTurns" :key="turn.id"
        :ref="(el) => observe(el as HTMLElement | null, `turn:${turn.id}`)" class="turn-block">
        <Button
          v-if="visibleTurns.length > 1"
          variant="ghost"
          size="xs"
          class="turn-divider"
          :aria-expanded="!collapsedTurns.has(turn.id)"
          @click="toggleTurn(turn.id)"
        >
          <component :is="collapsedTurns.has(turn.id) ? ChevronRight : ChevronDown" :size="14" />
          <span class="turn-title">{{ turn.label }}</span>
          <span class="spacer" />
          <span class="muted">{{ t("trace.steps", { n: rowsByTurn.get(turn.id)?.length ?? 0 }) }}</span>
          <span v-if="turn.durationMs !== undefined" class="mono muted">
            {{ formatDuration(turn.durationMs) }}
          </span>
        </Button>

        <template v-if="!collapsedTurns.has(turn.id)">
          <!-- 远离视口的轮次整块用等高占位，避免一次建出上千行 -->
          <div v-if="!revealed.has(`turn:${turn.id}`)" class="turn-placeholder"
            :style="{ height: `${(rowsByTurn.get(turn.id)?.length ?? 0) * 28}px` }" />
          <div v-for="row in revealed.has(`turn:${turn.id}`) ? (rowsByTurn.get(turn.id) ?? []) : []"
            :key="row.node.id" class="row-wrap"
            :ref="(el) => observe(el as HTMLElement | null, row.node.id)">
            <span v-if="!revealed.has(row.node.id)" class="row-placeholder" />
            <Button
              v-else
              variant="ghost"
              size="xs"
              class="row"
              :aria-selected="selectedId === row.node.id"
              :data-kind="row.node.kind"
              :data-status="row.node.status"
              :data-node-id="row.node.id"
              @click="emit('select', row.node.id)"
            >
              <span class="row-name">
                <span class="row-icon" :data-kind="row.node.kind">
                  <TraceNodeIcon :node="row.node" :size="14" />
                </span>
                <span class="row-title">
                  <TraceHighlight :text="row.node.title" :query="searchQuery" />
                </span>
                <span v-if="row.node.status === 'error'" class="row-badge">
                  {{ t("trace.failed") }}
                </span>
              </span>
              <span class="track">
                <span
                  v-if="barOf(row.node)"
                  class="bar"
                  :style="{
                    left: `${barOf(row.node)?.left ?? 0}%`,
                    width: `${barOf(row.node)?.width ?? 0}%`,
                  }"
                />
              </span>
              <span
                class="row-dur"
                :data-slow="
                  row.node.durationMs !== undefined && row.node.durationMs >= SLOW_STEP_MS
                    ? true
                    : undefined
                "
              >
                {{ formatDuration(row.node.durationMs) }}
              </span>
            </Button>
          </div>
        </template>
      </li>
    </ul>

    <p v-if="!props.inspectorOpen" class="trace-hint">{{ t("trace.clickRowHint") }}</p>
  </div>
</template>

<style scoped>
.timeline-root {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
}

.timeline-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-sunken);
}

.seg-btn {
  border-radius: var(--radius-xs);
  color: var(--color-mut);
  font-weight: 400;
}

.seg-btn[aria-pressed="true"] {
  background: var(--color-raise);
  color: var(--color-txt-strong);
  font-weight: 500;
}

.scale {
  display: flex;
  flex: 1;
  justify-content: space-between;
  margin-inline-start: 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-dim);
}

.timeline-list {
  margin: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0;
  list-style: none;
}

.turn-block {
  display: flex;
  flex-direction: column;
}

.turn-divider {
  display: flex;
  width: 100%;
  height: var(--control-h-xs);
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  margin: 8px 0 4px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--color-sunken);
  color: var(--color-txt);
  font-weight: 400;
}

.turn-title {
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.muted {
  color: var(--color-dim);
  font-size: 11px;
  white-space: nowrap;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.turn-placeholder {
  width: 100%;
}

.row-placeholder {
  display: block;
  width: 100%;
  height: var(--control-h-sm);
}

.row-wrap {
  display: flex;
  min-width: 0;
  /* 上千行时只绘制视口内的行：跳过离屏行的布局与绘制，滚动条仍按真实高度 */
  content-visibility: auto;
  contain-intrinsic-size: auto 26px;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 46%) minmax(0, 1fr) 64px;
  width: 100%;
  height: var(--control-h-sm);
  align-items: center;
  justify-content: stretch;
  gap: 8px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: var(--color-txt);
  font-size: 13px;
  font-weight: 400;
  text-align: start;
}

.row[aria-selected="true"] {
  background: var(--color-side-sel);
}

.row-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.row-icon {
  display: inline-flex;
  flex: none;
  color: var(--color-mut);
}

.row-icon[data-kind="thinking"] {
  color: var(--agent-thinking);
}

.row-icon[data-kind="error"] {
  color: var(--agent-danger);
}

.row-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.row-badge {
  flex: none;
  font-size: 11px;
  color: var(--agent-danger);
}

.track {
  position: relative;
  height: 8px;
  border-radius: var(--radius-shell);
  background: var(--color-sunken);
}

.bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-shell);
  background: var(--color-accent);
}

.row[data-kind="thinking"] .bar {
  background: var(--agent-thinking);
}

.row[data-status="error"] .bar {
  background: var(--agent-danger);
}

.row[data-status="running"] .bar {
  background: color-mix(in srgb, var(--color-accent) 60%, var(--color-raise));
}

.row-dur {
  text-align: end;
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--color-dim);
  white-space: nowrap;
}

.row-dur[data-slow="true"] {
  color: var(--agent-approval);
  font-weight: 600;
}

.trace-hint {
  margin: 8px 0;
  padding: 0 12px;
  font-size: 12px;
  color: var(--color-dim);
}
</style>
