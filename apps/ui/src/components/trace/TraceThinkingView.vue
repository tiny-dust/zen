<script setup lang="ts">
import {
  IconBrain as Brain,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconFocusCentered as LocateFixed,
} from "@tabler/icons-vue";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useLazyReveal } from "@/composables/useLazyReveal";

import { Response } from "@/components/ai-elements/response";
import { Button } from "@/components/ui/button";
import type { TraceDocument } from "@/lib/trace/document";
import { formatDuration, offsetLabel } from "@/lib/trace/format";
import { extractThinkingChain, type TraceFilterResult } from "@/lib/trace/queries";

import TraceBlock from "./TraceBlock.vue";
import TraceHighlight from "./TraceHighlight.vue";
import TraceNodeIcon from "./TraceNodeIcon.vue";

/**
 * 思考脉络：按发生顺序排列的推理流，每段思考挂上它触发的工具 / 失败操作；
 * 支持摘要 / 全文切换与一键复制全部思考。
 */
const props = defineProps<{
  doc: TraceDocument;
  filter: TraceFilterResult;
  searchQuery: string;
  selectedId: string | null;
}>();

const emit = defineEmits<{ select: [id: string]; locate: [id: string] }>();

const { t } = useI18n();

const fullMode = ref(true);
const expandedCards = ref<Set<string>>(new Set());
const listRef = ref<HTMLElement | null>(null);
/** 思考正文里的 markdown（代码高亮）很贵：只有滚到附近的那几张才解析 */
const { revealed, observe } = useLazyReveal();

const items = computed(() => extractThinkingChain(props.doc, props.filter));

const totalThinkingMs = computed(() =>
  items.value.reduce((sum, item) => sum + (item.node.durationMs ?? 0), 0),
);

/** 复制全部思考：纯文本的分段拼接（含触发操作清单） */
const plainText = computed(() =>
  items.value
    .map((item) => {
      const header = [
        `#${item.stepIndex}`,
        item.lane.name,
        item.turn.label,
        item.node.start !== undefined ? offsetLabel(item.node.start, props.doc.from) : "",
        formatDuration(item.node.durationMs),
      ]
        .filter(Boolean)
        .join(" · ");
      const actions = item.triggeredActions.length
        ? `\n\n${t("trace.triggeredActions")}:\n${item.triggeredActions
            .map(
              (action) =>
                `- [${action.status}] ${action.title}${
                  action.durationMs !== undefined ? ` (${formatDuration(action.durationMs)})` : ""
                }`,
            )
            .join("\n")}`
        : "";
      return `${header}\n\n${item.node.text ?? ""}${actions}`;
    })
    .join("\n\n---\n\n"),
);

watch(
  () => props.selectedId,
  async () => {
    if (!props.selectedId) {
      return;
    }
    await nextTick();
    listRef.value
      ?.querySelector<HTMLElement>(`[data-thinking-node="${props.selectedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  },
);

function toggleCard(nodeId: string) {
  const next = new Set(expandedCards.value);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  expandedCards.value = next;
}
</script>

<template>
  <div v-if="!items.length" class="thinking-empty">
    <Brain :size="26" />
    <p>{{ t("trace.emptyThinking") }}</p>
  </div>
  <div v-else class="thinking-root">
    <div class="thinking-toolbar">
      <span class="thinking-stats">
        {{
          t("trace.thinkingStats", {
            count: items.length,
            duration: formatDuration(totalThinkingMs) || "0ms",
          })
        }}
      </span>
      <div class="thinking-actions">
        <div class="segmented">
          <Button
            variant="ghost"
            size="xs"
            class="seg-btn"
            :aria-pressed="!fullMode"
            @click="fullMode = false"
          >
            {{ t("trace.thinkingSummary") }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            class="seg-btn"
            :aria-pressed="fullMode"
            @click="fullMode = true"
          >
            {{ t("trace.thinkingFull") }}
          </Button>
        </div>
        <TraceBlock :label="t('trace.copyAllThinking')" :text="plainText" inline />
      </div>
    </div>

    <ol ref="listRef" class="thinking-list">
      <li
        v-for="item in items"
        :key="item.node.id"
        :ref="(el) => observe(el as HTMLElement | null, item.node.id)"
        class="thinking-card"
        :data-thinking-node="item.node.id"
        :data-selected="selectedId === item.node.id || undefined"
      >
        <div class="thinking-rail" aria-hidden="true">
          <span class="thinking-dot" :data-status="item.node.status" />
          <span class="thinking-line" />
        </div>
        <!-- 远在视口外的卡片先只占位：不为几十张 markdown 卡片建 DOM -->
        <div v-if="!revealed.has(item.node.id)" class="thinking-placeholder" aria-hidden="true" />
        <div v-else class="thinking-body">
          <div class="thinking-head">
            <Button
              variant="ghost"
              size="xs"
              class="thinking-select"
              @click="
                emit('select', item.node.id);
                if (!fullMode) toggleCard(item.node.id);
              "
            >
              <component
                v-if="!fullMode"
                :is="expandedCards.has(item.node.id) ? ChevronDown : ChevronRight"
                :size="14"
              />
              <span class="thinking-index">
                {{ t("trace.stepIndex", { index: item.stepIndex }) }}
              </span>
              <span class="thinking-lane">{{ item.lane.name }}</span>
              <span class="thinking-turn">{{ item.turn.label }}</span>
              <span v-if="item.node.start !== undefined" class="thinking-meta">
                {{ offsetLabel(item.node.start, props.doc.from) }}
              </span>
              <span v-if="formatDuration(item.node.durationMs)" class="thinking-meta">
                {{ formatDuration(item.node.durationMs) }}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="t('trace.locateInGraph')"
              @click="emit('locate', item.node.id)"
            >
              <LocateFixed />
            </Button>
          </div>

          <Button
            v-if="!fullMode && !expandedCards.has(item.node.id)"
            variant="ghost"
            size="xs"
            class="thinking-summary"
            @click="
              emit('select', item.node.id);
              toggleCard(item.node.id);
            "
          >
            <TraceHighlight :text="item.summary" :query="searchQuery" />
          </Button>
          <div
            v-else
            class="thinking-text"
            role="presentation"
            @click="emit('select', item.node.id)"
          >
            <Response :content="item.node.text ?? ''" class="md-content" />
          </div>

          <div v-if="item.triggeredActions.length" class="triggered-wrap">
            <span class="triggered-label">{{ t("trace.triggeredActions") }}</span>
            <div class="triggered-chips">
              <Button
                v-for="action in item.triggeredActions"
                :key="action.id"
                variant="ghost"
                size="xs"
                class="action-chip"
                :data-status="action.status"
                :data-selected="selectedId === action.id || undefined"
                @click="emit('select', action.id)"
              >
                <TraceNodeIcon :node="action" :size="13" />
                <span class="action-text">
                  <TraceHighlight :text="action.title" :query="searchQuery" />
                </span>
              </Button>
            </div>
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.thinking-root {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.thinking-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-sunken);
}

.thinking-stats {
  font-size: 12px;
  color: var(--color-dim);
}

.thinking-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-raise);
}

.seg-btn {
  border-radius: var(--radius-xs);
  color: var(--color-mut);
  font-weight: 400;
}

.seg-btn[aria-pressed="true"] {
  background: var(--color-sunken);
  color: var(--color-txt-strong);
  font-weight: 500;
}

.thinking-list {
  display: flex;
  margin: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 12px;
  list-style: none;
}

.thinking-card {
  display: flex;
  gap: 8px;
  /* 长会话的思考卡很多：离屏卡片跳过布局与绘制 */
  content-visibility: auto;
  contain-intrinsic-size: auto 160px;
}

.thinking-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 6px;
}

.thinking-dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: var(--radius-shell);
  background: var(--agent-thinking);
}

.thinking-dot[data-status="running"] {
  background: var(--agent-approval);
}

.thinking-line {
  width: 2px;
  flex: 1;
  margin-top: 4px;
  background: var(--color-line);
}

.thinking-card:last-child .thinking-line {
  display: none;
}

.thinking-placeholder {
  height: 132px;
  flex: 1;
  border: 1px dashed var(--color-line);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-sunken) 60%, transparent);
}

.thinking-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-raise);
}

.thinking-card[data-selected] .thinking-placeholder {
  height: 132px;
  flex: 1;
  border: 1px dashed var(--color-line);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-sunken) 60%, transparent);
}

.thinking-body {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-raised);
}

.thinking-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.thinking-select {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  font-weight: 400;
  text-align: start;
}

.thinking-index {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--agent-thinking);
}

.thinking-lane {
  padding: 0 6px;
  border-radius: var(--radius-shell);
  background: var(--color-sunken);
  color: var(--color-mut);
  font-size: 11px;
}

.thinking-turn,
.thinking-meta {
  font-size: 11px;
  color: var(--color-dim);
  white-space: nowrap;
}

.thinking-meta {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.thinking-summary {
  display: block;
  width: 100%;
  justify-content: flex-start;
  color: var(--color-txt);
  font-size: 13px;
  font-weight: 400;
  text-align: start;
  white-space: normal;
}

.thinking-text {
  font-size: 13px;
  cursor: pointer;
}

.triggered-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--color-line-soft);
}

.triggered-label {
  font-size: 11px;
  color: var(--color-dim);
}

.triggered-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.action-chip {
  max-width: 100%;
  border: 1px solid var(--color-line);
  background: var(--color-sunken);
  color: var(--color-txt);
  font-weight: 400;
}

.action-chip[data-status="error"] {
  border-color: color-mix(in srgb, var(--agent-danger) 55%, transparent);
  background: color-mix(in srgb, var(--agent-danger) 12%, var(--color-raise));
}

.action-chip[data-selected] {
  border-color: var(--color-accent);
}

.action-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.thinking-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--color-dim);
  font-size: 13px;
}
</style>
