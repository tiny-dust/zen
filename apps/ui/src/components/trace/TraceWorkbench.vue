<script setup lang="ts">
import {
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconLayoutSidebarRight as SidebarRight,
  IconSearch as SearchIcon,
  IconX as X,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTraceDocument } from "@/lib/trace/document";
import { formatDuration, formatTokens } from "@/lib/trace/format";
import { filterTraceDocument, type TraceKindFilter } from "@/lib/trace/queries";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";

import TraceGraph from "./TraceGraph.vue";
import TraceInspector from "./TraceInspector.vue";
import TraceRawView from "./TraceRawView.vue";
import TraceThinkingView from "./TraceThinkingView.vue";
import TraceTimeline from "./TraceTimeline.vue";

/**
 * 运行轨迹工作台（对齐 Nomi 的 TraceWorkbench）：
 * KPI 条 + 7 个视图 + 搜索与过滤 + 左主画布 / 右检查器。
 * 网关请求、子进程收发、模型分析保留视图与空态——Zen 没有这些数据源。
 */
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

const { t, locale } = useI18n();
const chatStore = useChatStore();
const { messages } = storeToRefs(chatStore);

type TraceView = "graph" | "timeline" | "thinking" | "models" | "requests" | "process" | "raw";

const layoutStore = useLayoutStore();

const view = ref<TraceView>("graph");
/** 输入框里的即时值 */
const searchQuery = ref("");
/** 真正参与过滤 / 高亮的查询：输入防抖 150ms，长轨迹上少跑几轮全量过滤与重绘 */
const appliedQuery = ref("");
let queryTimer: ReturnType<typeof setTimeout> | undefined;
const kindFilter = ref<TraceKindFilter>("all");
const selectedId = ref<string | null>(null);
const inspectorOpen = ref(true);
const matchCursor = ref(0);
const focusState = ref<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });

/** locale 变化时重建：节点标题与泳道名来自 i18n */
const doc = computed(() => {
  void locale.value;
  return buildTraceDocument(messages.value);
});

const filterResult = computed(() =>
  filterTraceDocument(doc.value, { query: appliedQuery.value, kind: kindFilter.value }),
);

/**
 * 宽屏查看：轨迹图按轮次横排，需要足够宽度才排得出多列。
 * 打开时临时收起中央区的会话信息列，把右侧面板拉到当前可用的最宽；
 * 退出时恢复信息列，面板宽度回到默认（拖宽仍然可用）。
 */
const wide = ref(false);
let infoWasOpen = false;

function toggleWide() {
  wide.value = !wide.value;
  if (wide.value) {
    infoWasOpen = layoutStore.sessionOpen;
    if (layoutStore.sessionOpen) {
      layoutStore.sessionOpen = false;
    }
    layoutStore.setRightWidth(Math.floor(window.innerWidth * 0.62));
    return;
  }
  if (infoWasOpen) {
    layoutStore.sessionOpen = true;
    infoWasOpen = false;
  }
  layoutStore.setRightWidth(Math.floor(window.innerWidth / 2));
}

const splitActive = computed(
  () => view.value === "graph" || view.value === "timeline" || view.value === "thinking",
);

const tabs = computed<Array<{ value: TraceView; label: string }>>(() => [
  { value: "graph", label: t("trace.tabGraph") },
  { value: "timeline", label: t("trace.tabTimeline") },
  { value: "thinking", label: t("trace.tabThinking") },
  { value: "models", label: t("trace.tabModels") },
  { value: "requests", label: t("trace.tabRequests") },
  { value: "process", label: t("trace.tabProcess") },
  { value: "raw", label: t("trace.tabRaw") },
]);

const chips = computed(() => {
  const stats = doc.value.stats;
  return [
    { value: "all" as TraceKindFilter, label: t("trace.filterAll"), count: undefined, danger: false },
    {
      value: "thinking" as TraceKindFilter,
      label: t("trace.legendThinking"),
      count: stats.thinkingCount,
      danger: false,
    },
    { value: "tool" as TraceKindFilter, label: t("trace.legendTool"), count: stats.toolCount, danger: false },
    ...(stats.failedCount > 0
      ? [
          {
            value: "error" as TraceKindFilter,
            label: t("trace.filterErrors"),
            count: stats.failedCount,
            danger: true,
          },
        ]
      : []),
    ...(stats.slowCount > 0
      ? [
          {
            value: "slow" as TraceKindFilter,
            label: t("trace.filterSlow"),
            count: stats.slowCount,
            danger: false,
          },
        ]
      : []),
  ];
});

const startLabel = computed(() =>
  doc.value.from ? new Date(doc.value.from).toLocaleTimeString() : "",
);

function select(id: string | null) {
  selectedId.value = id;
  if (id) {
    inspectorOpen.value = true;
  }
}

function applyFilterReset(nextQuery: string, nextKind: TraceKindFilter) {
  const result = filterTraceDocument(doc.value, { query: nextQuery, kind: nextKind });
  matchCursor.value = 0;
  if (result.active && result.orderedMatches.length > 0) {
    const first = result.orderedMatches[0] ?? null;
    select(first);
    focusState.value = { id: first, nonce: focusState.value.nonce + 1 };
  }
}

function applyQueryNow(next: string) {
  clearTimeout(queryTimer);
  queryTimer = undefined;
  appliedQuery.value = next;
  applyFilterReset(next, kindFilter.value);
}

function updateQuery(next: string) {
  searchQuery.value = next;
  if (!next) {
    // 清空要立刻生效，不然匹配数会短暂停在旧值
    applyQueryNow("");
    return;
  }
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => applyQueryNow(next), 150);
}

function updateKind(next: TraceKindFilter) {
  kindFilter.value = next;
  applyQueryNow(searchQuery.value);
}

function jumpMatch(dir: -1 | 1) {
  const list = filterResult.value.orderedMatches;
  if (!list.length) {
    return;
  }
  const next = (matchCursor.value + dir + list.length) % list.length;
  const id = list[next] ?? null;
  matchCursor.value = next;
  select(id);
  focusState.value = { id, nonce: focusState.value.nonce + 1 };
}

function stepSelection(dir: -1 | 1) {
  const pool = filterResult.value.active
    ? filterResult.value.orderedMatches
    : doc.value.orderedNodeIds;
  if (!pool.length) {
    return;
  }
  const current = selectedId.value ? pool.indexOf(selectedId.value) : -1;
  const nextIndex = current < 0 ? 0 : (current + dir + pool.length) % pool.length;
  const next = pool[nextIndex] ?? null;
  select(next);
  focusState.value = { id: next, nonce: focusState.value.nonce + 1 };
}

function locateInGraph(id: string) {
  view.value = "graph";
  select(id);
  focusState.value = { id, nonce: focusState.value.nonce + 1 };
}

function quickSearch(term: string) {
  searchQuery.value = term;
  kindFilter.value = "all";
  applyQueryNow(term);
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    // 防抖还没落地就要跳转：先按当前输入内容生效，再跳，免得跳到上一轮的结果
    if (queryTimer !== undefined) {
      applyQueryNow(searchQuery.value);
    }
    jumpMatch(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Escape" && searchQuery.value) {
    event.stopPropagation();
    updateQuery("");
  }
}
</script>

<template>
  <section v-show="props.active" class="trace-wb" aria-label="trace">
    <div class="kpi-strip">
      <Badge variant="outline" class="scope-badge">{{ t("trace.scopeSession") }}</Badge>
      <span v-if="startLabel" class="kpi-item">
        <span class="kpi-label">{{ t("trace.start") }}</span>
        <span class="kpi-value">{{ startLabel }}</span>
      </span>
      <span class="kpi-item">
        <span class="kpi-label">{{ t("trace.elapsed") }}</span>
        <span class="kpi-value">{{ formatDuration(doc.to - doc.from) || "0ms" }}</span>
      </span>
      <span class="kpi-item">
        <span class="kpi-label">{{ t("trace.turns") }}</span>
        <span class="kpi-value">{{ doc.stats.turns }}</span>
      </span>
      <span class="kpi-item">
        <span class="kpi-label">{{ t("trace.thinkingCount") }}</span>
        <span class="kpi-value">{{ doc.stats.thinkingCount }}</span>
      </span>
      <span class="kpi-item">
        <span class="kpi-label">{{ t("trace.toolCalls") }}</span>
        <span class="kpi-value">{{ doc.stats.toolCount }}</span>
      </span>
      <span v-if="doc.stats.failedCount > 0" class="kpi-item" data-danger="true">
        <span class="kpi-label">{{ t("trace.failedCalls") }}</span>
        <span class="kpi-value">{{ doc.stats.failedCount }}</span>
      </span>
      <span v-if="doc.stats.inputTokens > 0" class="kpi-item">
        <span class="kpi-label">{{ t("trace.tokens") }}</span>
        <span class="kpi-value">
          {{ formatTokens(doc.stats.inputTokens) }} / {{ formatTokens(doc.stats.outputTokens) }}
        </span>
      </span>
    </div>

    <div class="nav-bar">
      <Tabs v-model="view">
        <TabsList class="nav-tabs">
          <TabsTrigger v-for="tab in tabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        v-if="splitActive"
        :variant="inspectorOpen ? 'secondary' : 'ghost'"
        size="icon-sm"
        :aria-label="t('trace.toggleInspector')"
        :aria-pressed="inspectorOpen"
        @click="inspectorOpen = !inspectorOpen"
      >
        <SidebarRight />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="wide ? t('trace.graphWideExit') : t('trace.graphWide')"
        :aria-pressed="wide"
        :title="wide ? t('trace.graphWideExit') : t('trace.graphWide')"
        @click="toggleWide"
      >
        <component :is="wide ? Minimize : Maximize" />
      </Button>
    </div>

    <div v-if="splitActive" class="filter-bar">
      <div class="search-box">
        <SearchIcon :size="14" class="search-icon" aria-hidden="true" />
        <Input
          :model-value="searchQuery"
          variant="ghost"
          class="search-input"
          :placeholder="t('trace.searchPlaceholder')"
          :aria-label="t('trace.searchPlaceholder')"
          @update:model-value="updateQuery(String($event))"
          @keydown="onSearchKeydown"
        />
        <template v-if="searchQuery">
          <span class="match-count">
            {{
              filterResult.orderedMatches.length > 0
                ? t("trace.matchCount", {
                    index: matchCursor + 1,
                    total: filterResult.orderedMatches.length,
                  })
                : t("trace.noMatch")
            }}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.prevMatch')"
            :disabled="!filterResult.orderedMatches.length"
            @click="jumpMatch(-1)"
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.nextMatch')"
            :disabled="!filterResult.orderedMatches.length"
            @click="jumpMatch(1)"
          >
            <ChevronDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="t('trace.clearSearch')"
            @click="updateQuery('')"
          >
            <X />
          </Button>
        </template>
      </div>

      <div class="chip-row">
        <Button
          v-for="chip in chips"
          :key="chip.value"
          variant="ghost"
          size="xs"
          class="filter-chip"
          :data-danger="chip.danger || undefined"
          :aria-pressed="kindFilter === chip.value"
          @click="updateKind(chip.value)"
        >
          <span>{{ chip.label }}</span>
          <span v-if="chip.count !== undefined" class="chip-badge">{{ chip.count }}</span>
        </Button>
      </div>
    </div>

    <div class="workspace" :data-split="splitActive && inspectorOpen ? 'true' : undefined">
      <div class="main-pane">
        <TraceGraph
          v-if="view === 'graph'"
          :doc="doc"
          :filter="filterResult"
          :search-query="appliedQuery"
          :selected-id="selectedId"
          :focus-node-id="focusState.id"
          :focus-nonce="focusState.nonce"
          @select="select"
        />
        <TraceTimeline
          v-else-if="view === 'timeline'"
          :doc="doc"
          :filter="filterResult"
          :search-query="appliedQuery"
          :selected-id="selectedId"
          :inspector-open="inspectorOpen"
          @select="select"
        />
        <TraceThinkingView
          v-else-if="view === 'thinking'"
          :doc="doc"
          :filter="filterResult"
          :search-query="appliedQuery"
          :selected-id="selectedId"
          @select="select"
          @locate="locateInGraph"
        />
        <div v-else-if="view === 'models'" class="empty-view">
          <p class="empty-title">{{ t("trace.emptyModels") }}</p>
          <p class="empty-hint">{{ t("trace.emptyModelsHint") }}</p>
        </div>
        <div v-else-if="view === 'requests'" class="empty-view">
          <p class="empty-title">{{ t("trace.emptyRequests") }}</p>
          <p class="empty-hint">{{ t("trace.emptyRequestsHint") }}</p>
        </div>
        <div v-else-if="view === 'process'" class="empty-view">
          <p class="empty-title">{{ t("trace.emptyProcess") }}</p>
          <p class="empty-hint">{{ t("trace.emptyProcessHint") }}</p>
        </div>
        <TraceRawView v-else :messages="messages" />
      </div>

      <TraceInspector
        v-if="splitActive && inspectorOpen"
        :doc="doc"
        :selected-id="selectedId"
        @select="select"
        @step="stepSelection"
        @locate="locateInGraph"
        @quick-search="quickSearch"
        @close="inspectorOpen = false"
      />
    </div>
  </section>
</template>

<style scoped>
.trace-wb {
  display: flex;
  min-height: 0;
  height: 100%;
  flex: 1 1 0;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  container-type: inline-size;
  container-name: trace-wb;
}

.kpi-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 6px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-sunken);
  font-size: 11px;
}

.kpi-item {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.kpi-label {
  color: var(--color-dim);
}

.kpi-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--color-txt-strong);
}

.kpi-item[data-danger="true"] .kpi-value {
  color: var(--agent-danger);
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nav-tabs {
  overflow-x: auto;
  scrollbar-width: none;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.search-box {
  display: inline-flex;
  min-width: 0;
  max-width: 440px;
  flex: 1 1 240px;
  align-items: center;
  gap: 6px;
  height: var(--control-h-sm);
  padding: 0 6px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-input-bg);
}

.search-box:focus-within {
  border-color: var(--color-accent);
}

.search-icon {
  flex: none;
  color: var(--color-dim);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  font-size: 12px;
}

.match-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-mut);
  white-space: nowrap;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.filter-chip {
  gap: 4px;
  height: var(--control-h-sm);
  padding: 0 8px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-shell);
  background: var(--color-sunken);
  color: var(--color-mut);
  font-size: 11px;
  font-weight: 400;
}

.filter-chip[aria-pressed="true"] {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-txt-strong);
}

.filter-chip[data-danger="true"][aria-pressed="true"] {
  border-color: var(--agent-danger);
  background: color-mix(in srgb, var(--agent-danger) 14%, transparent);
  color: var(--agent-danger);
}

.chip-badge {
  padding: 0 5px;
  border-radius: var(--radius-shell);
  background: var(--color-raise);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 16px;
}

.workspace {
  display: flex;
  min-height: 0;
  flex: 1;
  gap: 12px;
  overflow: hidden;
}

.main-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-raise);
}

.empty-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
}

.empty-title {
  margin: 0;
  font-size: 13px;
  color: var(--color-txt);
}

.empty-hint {
  margin: 0;
  max-width: 420px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-dim);
}

@container trace-wb (max-width: 640px) {
  .workspace {
    flex-direction: column;
  }
}
</style>
