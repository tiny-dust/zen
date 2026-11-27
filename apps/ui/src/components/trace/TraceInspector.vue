<script setup lang="ts">
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconFocusCentered as LocateFixed,
  IconX as X,
} from "@tabler/icons-vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { toolFileDiff } from "@/components/chat/tool-file-diff";
import { toolResult } from "@/components/chat/tool-result";
import { Response } from "@/components/ai-elements/response";
import DiffView from "@/components/right/DiffView.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ToolPart } from "@/components/chat/tool-part";
import { SLOW_STEP_MS, type TraceDocument, type TraceNode, type TraceToolCall } from "@/lib/trace/document";
import { formatDuration, offsetLabel, prettyJson } from "@/lib/trace/format";
import { computeTraceInsights } from "@/lib/trace/queries";

import TraceBlock from "./TraceBlock.vue";
import TraceNodeIcon from "./TraceNodeIcon.vue";

/**
 * 右侧检查器（Master-Detail 的 Detail 栏）：
 * 选中节点时展示参数 / 命令 / Diff / 输出 / 完整思考；未选中时展示全景洞察。
 */
const props = defineProps<{
  doc: TraceDocument;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  step: [dir: -1 | 1];
  locate: [id: string];
  quickSearch: [term: string];
  close: [];
}>();

const { t } = useI18n();

const node = computed<TraceNode | null>(() =>
  props.selectedId ? (props.doc.nodesById[props.selectedId] ?? null) : null,
);

const insights = computed(() => computeTraceInsights(props.doc));

const breakdown = computed(() => {
  const value = insights.value;
  const total = Math.max(
    1,
    value.thinkingMs + value.toolMs + value.subagentMs + value.otherMs,
  );
  const pct = (ms: number) => `${Math.max(0, (ms / total) * 100).toFixed(1)}%`;
  return [
    { key: "thinking", label: t("trace.legendThinking"), ms: value.thinkingMs, width: pct(value.thinkingMs) },
    { key: "tool", label: t("trace.legendTool"), ms: value.toolMs, width: pct(value.toolMs) },
    { key: "subagent", label: t("trace.legendSubagent"), ms: value.subagentMs, width: pct(value.subagentMs) },
    { key: "other", label: t("trace.legendOther"), ms: value.otherMs, width: pct(value.otherMs) },
  ];
});

function statusLabel(status: TraceNode["status"]): string {
  if (status === "error") {
    return t("trace.failed");
  }
  if (status === "running") {
    return t("trace.running");
  }
  if (status === "stopped") {
    return t("trace.stopped");
  }
  return t("trace.done");
}

function statusVariant(status: TraceNode["status"]): "destructive" | "secondary" | "outline" {
  if (status === "error") {
    return "destructive";
  }
  return status === "done" ? "secondary" : "outline";
}

/** 工具入参里的命令（Zen 的 runTerminal 用 command 字段） */
function commandOf(call: TraceToolCall): string {
  if (typeof call.args === "string") {
    return call.args;
  }
  if (call.args && typeof call.args === "object") {
    const args = call.args as Record<string, unknown>;
    for (const key of ["command", "cmd", "script"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "";
}

function asToolPart(call: TraceToolCall): ToolPart {
  return {
    type: "tool",
    toolCallId: call.id,
    toolName: call.name,
    state: call.state,
    args: call.args,
    output: call.output,
    summary: call.summary,
    error: call.error,
  };
}

/** 写文件 / 编辑文件的代码变更：复用消息流里的 diff 计算与渲染 */
const fileDiff = computed(() => {
  const call = node.value?.call;
  if (!call) {
    return null;
  }
  const result = toolResult(asToolPart(call));
  if (result?.kind !== "diff" && result?.kind !== "replacement") {
    return null;
  }
  const patch = toolFileDiff(result.before, result.after);
  return patch.patch.trim() ? { patch: patch.patch, path: result.path } : null;
});

/** 这段思考之后触发的操作 */
const triggered = computed<TraceNode[]>(() => {
  const current = node.value;
  if (!current || current.kind !== "thinking") {
    return [];
  }
  const turn = props.doc.turnsById[current.turnId];
  if (!turn) {
    return [];
  }
  const index = turn.nodeIds.indexOf(current.id);
  const out: TraceNode[] = [];
  for (let next = index + 1; next < turn.nodeIds.length; next += 1) {
    const candidate = props.doc.nodesById[turn.nodeIds[next] ?? ""];
    if (!candidate) {
      continue;
    }
    if (candidate.kind === "thinking" || candidate.kind === "reply" || candidate.kind === "user") {
      break;
    }
    out.push(candidate);
  }
  return out;
});

const facts = computed<Array<{ label: string; value: string }>>(() => {
  const current = node.value;
  if (!current) {
    return [];
  }
  const list: Array<{ label: string; value: string }> = [];
  if (current.call) {
    list.push({ label: t("trace.legendTool"), value: current.call.name });
  }
  if (current.start !== undefined) {
    list.push({ label: t("trace.start"), value: offsetLabel(current.start, props.doc.from) });
  }
  if (current.durationMs !== undefined) {
    list.push({ label: t("trace.elapsed"), value: formatDuration(current.durationMs) });
  }
  if (current.call) {
    list.push({ label: t("trace.callId"), value: current.call.id });
  }
  return list;
});
</script>

<template>
  <aside class="inspector">
    <header class="inspector-head">
      <template v-if="node">
        <div class="inspector-title-row">
          <span class="inspector-icon"><TraceNodeIcon :node="node" :size="16" /></span>
          <span class="inspector-title" :title="node.title">{{ node.title }}</span>
          <Badge :variant="statusVariant(node.status)">{{ statusLabel(node.status) }}</Badge>
        </div>
        <div class="inspector-meta">
          <span class="lane-chip">{{ props.doc.lanesById[node.laneId]?.name }}</span>
          <span v-if="node.durationMs !== undefined" class="mono">
            {{ formatDuration(node.durationMs) }}
          </span>
          <span v-if="node.start !== undefined" class="mono">
            {{ offsetLabel(node.start, props.doc.from) }}
          </span>
        </div>
        <div class="inspector-nav">
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.prevStep')"
            @click="emit('step', -1)"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.nextStep')"
            @click="emit('step', 1)"
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.locateInGraph')"
            @click="emit('locate', node.id)"
          >
            <LocateFixed />
          </Button>
          <span class="spacer" />
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.overview')"
            @click="emit('select', null)"
          >
            <X />
          </Button>
        </div>
      </template>
      <div v-else class="inspector-title-row">
        <span class="inspector-title">{{ t("trace.overview") }}</span>
        <span class="spacer" />
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="t('trace.close')"
          @click="emit('close')"
        >
          <X />
        </Button>
      </div>
    </header>

    <div class="inspector-body">
      <div v-if="node" class="detail">
        <dl class="facts">
          <template v-for="fact in facts" :key="fact.label">
            <dt>{{ fact.label }}</dt>
            <dd>{{ fact.value }}</dd>
          </template>
        </dl>

        <template v-if="node.kind === 'tool' && node.call">
          <TraceBlock
            v-if="commandOf(node.call)"
            :label="t('trace.command')"
            :text="commandOf(node.call)"
          />
          <section v-if="fileDiff" class="diff-section">
            <span class="section-label">{{ t("trace.codeChanges") }}</span>
            <DiffView :diff="fileDiff.patch" :path="fileDiff.path" />
          </section>
          <TraceBlock :label="t('trace.arguments')" :text="prettyJson(node.call.args)" />
          <TraceBlock
            :label="node.call.state === 'error' ? t('trace.errorTitle') : t('trace.output')"
            :text="
              prettyJson(node.call.error ?? node.call.summary ?? node.call.output) ||
              undefined
            "
          />
          <p v-if="!node.call.args && !node.call.output && !node.call.summary" class="hint">
            {{ t("trace.noInputOutput") }}
          </p>
        </template>

        <template v-else-if="node.kind === 'thinking'">
          <section class="section">
            <span class="section-label">{{ t("trace.thinkingProcess") }}</span>
            <Response :content="node.text ?? ''" class="md-content" />
          </section>
          <section v-if="triggered.length" class="section">
            <span class="section-label">{{ t("trace.triggeredActions") }}</span>
            <div class="chips">
              <Button
                v-for="action in triggered"
                :key="action.id"
                variant="secondary"
                size="xs"
                @click="emit('select', action.id)"
              >
                <TraceNodeIcon :node="action" :size="13" />
                <span class="chip-text">{{ action.title }}</span>
              </Button>
            </div>
          </section>
        </template>

        <template v-else-if="node.kind === 'reply'">
          <Response :content="node.text ?? ''" class="md-content" />
        </template>

        <TraceBlock v-else :label="node.title" :text="node.text ?? node.subtitle" />
      </div>

      <div v-else class="overview">
        <p class="hint">{{ t("trace.placeholder") }}</p>

        <section class="insight-card">
          <h4 class="insight-title">{{ t("trace.timeBreakdown") }}</h4>
          <div class="breakdown" aria-hidden="true">
            <span
              v-for="segment in breakdown"
              :key="segment.key"
              class="breakdown-seg"
              :data-key="segment.key"
              :style="{ width: segment.width }"
            />
          </div>
          <dl class="legend">
            <div v-for="segment in breakdown" :key="segment.key" class="legend-item">
              <span class="legend-dot" :data-key="segment.key" />
              <dt>{{ segment.label }}</dt>
              <dd>{{ formatDuration(segment.ms) || "0ms" }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="insights.failed.length" class="insight-card">
          <h4 class="insight-title">{{ t("trace.errorSteps") }}</h4>
          <ul class="insight-list">
            <li v-for="item in insights.failed.slice(0, 6)" :key="item.id">
              <Button variant="ghost" size="xs" class="insight-row" @click="emit('locate', item.id)">
                <TraceNodeIcon :node="item" :size="14" />
                <span class="insight-title-text">{{ item.title }}</span>
                <span class="insight-error">{{ t("trace.failed") }}</span>
              </Button>
            </li>
          </ul>
        </section>

        <section v-if="insights.slowest.length" class="insight-card">
          <h4 class="insight-title">{{ t("trace.slowestSteps") }}</h4>
          <ul class="insight-list">
            <li v-for="item in insights.slowest" :key="item.id">
              <Button variant="ghost" size="xs" class="insight-row" @click="emit('select', item.id)">
                <TraceNodeIcon :node="item" :size="14" />
                <span class="insight-title-text">{{ item.title }}</span>
                <span class="mono" :data-slow="(item.durationMs ?? 0) >= SLOW_STEP_MS || undefined">
                  {{ formatDuration(item.durationMs) }}
                </span>
              </Button>
            </li>
          </ul>
        </section>

        <section v-if="insights.toolDistribution.length" class="insight-card">
          <h4 class="insight-title">{{ t("trace.toolDistribution") }}</h4>
          <ul class="insight-list">
            <li v-for="item in insights.toolDistribution" :key="item.name">
              <Button
                variant="ghost"
                size="xs"
                class="insight-row"
                @click="emit('quickSearch', item.name)"
              >
                <span class="insight-title-text mono">{{ item.name }}</span>
                <span class="mono">
                  ×{{ item.count }}<template v-if="item.errors > 0"> ({{ item.errors }} err)</template>
                </span>
                <span v-if="item.totalMs > 0" class="mono">{{ formatDuration(item.totalMs) }}</span>
              </Button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex: 0 0 400px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-raise);
}

/* 窄容器（右栏面板默认宽度）时收窄检查器；更窄时与主画布上下堆叠 */
@container trace-wb (max-width: 820px) {
  .inspector {
    flex-basis: 300px;
  }
}

@container trace-wb (max-width: 640px) {
  .inspector {
    flex: 0 0 42%;
  }
}

.inspector-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-sunken);
}

.inspector-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.inspector-icon {
  display: inline-flex;
  flex: none;
  color: var(--color-mut);
}

.inspector-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.inspector-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--color-dim);
}

.lane-chip {
  padding: 0 6px;
  border-radius: var(--radius-shell);
  background: var(--color-raise);
  color: var(--color-mut);
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--color-dim);
}

.mono[data-slow="true"] {
  color: var(--agent-approval);
  font-weight: 600;
}

.inspector-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.spacer {
  flex: 1;
}

.inspector-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 12px;
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 11px;
}

.facts dt {
  color: var(--color-dim);
}

.facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--color-txt);
  font-family: var(--font-mono);
}

.section,
.diff-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-label {
  font-size: 12px;
  color: var(--color-dim);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-dim);
}

.insight-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-raise);
}

.insight-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-mut);
}

.breakdown {
  display: flex;
  height: 10px;
  overflow: hidden;
  border-radius: var(--radius-shell);
  background: var(--color-sunken);
}

.breakdown-seg[data-key="thinking"],
.legend-dot[data-key="thinking"] {
  background: var(--agent-thinking);
}

.breakdown-seg[data-key="tool"],
.legend-dot[data-key="tool"] {
  background: var(--color-accent);
}

.breakdown-seg[data-key="subagent"],
.legend-dot[data-key="subagent"] {
  background: var(--agent-approval);
}

.breakdown-seg[data-key="other"],
.legend-dot[data-key="other"] {
  background: var(--color-line-strong);
}

.legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 8px;
  margin: 0;
  font-size: 11px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-item dt {
  flex: 1;
  color: var(--color-mut);
}

.legend-item dd {
  margin: 0;
  font-family: var(--font-mono);
  color: var(--color-txt);
}

.legend-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: var(--radius-shell);
}

.insight-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.insight-row {
  display: flex;
  width: 100%;
  height: var(--control-h-xs);
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 400;
  text-align: start;
}

.insight-title-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.insight-error {
  flex: none;
  font-size: 11px;
  color: var(--agent-danger);
}
</style>
