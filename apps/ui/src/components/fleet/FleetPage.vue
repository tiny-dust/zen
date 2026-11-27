<script setup lang="ts">
import { IconArrowLeft as ArrowLeft, IconLoader2 as LoaderCircle, IconRobot as Bot } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentsStore } from "@/stores/agents";
import { useExternalSessionsStore } from "@/stores/external-sessions";
import { useLayoutStore } from "@/stores/layout";
import { useWorkbenchPageStore } from "@/stores/workbench-page";
import { useRightPanelStore } from "@/stores/right-panel";

import type { ExternalAgentClient } from "@zen/shared";

/**
 * Agent 整页看板：汇总 Zen 子 Agent 与本机外部 agent 会话。
 * 外部卡片点开右栏「外部会话」面板并选中该会话——续聊在面板里进行，本页不重写记录展示。
 */
const { t } = useI18n();
const layoutStore = useLayoutStore();
const pageStore = useWorkbenchPageStore();
const agentsStore = useAgentsStore();
const externalStore = useExternalSessionsStore();
const rightPanel = useRightPanelStore();
const { nodes } = storeToRefs(agentsStore);
const { sessions, loading: externalLoading } = storeToRefs(externalStore);

type Filter = "all" | "zen" | "external";
const filter = ref<Filter>("all");
const query = ref("");

const zenCards = computed(() =>
  nodes.value.map((node) => ({ id: node.id, name: node.name, status: node.status, task: node.task })),
);

const counts = computed(() => ({
  all: zenCards.value.length + sessions.value.length,
  zen: zenCards.value.length,
  external: sessions.value.length,
}));

function match(text: string): boolean {
  const keyword = query.value.trim().toLowerCase();
  return !keyword || text.toLowerCase().includes(keyword);
}

const visibleZen = computed(() =>
  filter.value === "external" ? [] : zenCards.value.filter((card) => match(`${card.name} ${card.task}`)),
);
const visibleExternal = computed(() => {
  if (filter.value === "zen") {
    return [];
  }
  const client = externalStore.clientFilter;
  return sessions.value.filter(
    (card) => (client === "all" || card.client === client) && match(`${card.title} ${card.cwd ?? ""}`),
  );
});

function clientLabel(client: ExternalAgentClient): string {
  return t(`panels.externalClients.${client}`);
}

function formatAgo(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) {
    return t("panels.externalJustNow");
  }
  if (minutes < 60) {
    return t("panels.externalMinutesAgo", { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? t("panels.externalHoursAgo", { n: hours })
    : t("panels.externalDaysAgo", { n: Math.floor(hours / 24) });
}

async function openExternal(id: string): Promise<void> {
  rightPanel.ensureTab("external");
  await externalStore.select(id);
  pageStore.close();
}

function openZen(id: string): void {
  rightPanel.ensureTab("agents");
  agentsStore.select(id);
  pageStore.close();
}

onMounted(() => {
  void externalStore.load();
});
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-[var(--color-panel)]" :aria-label="t('shell.fleetTitle')" data-testid="fleet-page">
    <header class="flex flex-none items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
      <Button variant="ghost" size="icon-sm" :aria-label="t('shell.fleetBack')" :title="t('shell.fleetBack')" @click="pageStore.close()">
        <ArrowLeft class="size-4" aria-hidden="true" />
      </Button>
      <div class="min-w-0">
        <h2 class="m-0 truncate text-[14px] font-semibold text-[var(--color-txt-strong)]">{{ t("shell.fleetTitle") }}</h2>
        <p class="m-0 truncate text-[11px] text-[var(--color-dim)]">{{ t("shell.fleetSubtitle") }}</p>
      </div>
      <Input v-model="query" class="ml-auto h-8 w-[200px] flex-none text-[12px]" :placeholder="t('shell.fleetSearch')" :aria-label="t('shell.fleetSearch')" />
    </header>

    <div class="flex flex-none items-center gap-1 px-3 py-2" role="group" :aria-label="t('shell.fleetBoard')">
      <button
        v-for="key in (['all', 'zen', 'external'] as Filter[])"
        :key="key"
        type="button"
        class="flex h-6 items-center gap-1 rounded-full px-2 text-[var(--font-size-xs)] transition-colors"
        :class="filter === key ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)]'"
        :aria-pressed="filter === key"
        :data-testid="`fleet-filter-${key}`"
        @click="filter = key"
      >
        {{ key === "all" ? t("shell.fleetAll") : key === "zen" ? t("shell.fleetZen") : t("shell.fleetExternal") }}
        <span class="tabular-nums text-[var(--color-dim)]">{{ counts[key] }}</span>
      </button>
      <span v-if="externalLoading" class="ml-2 flex items-center gap-1 text-[11px] text-[var(--color-dim)]">
        <LoaderCircle class="size-3 animate-spin" aria-hidden="true" />
      </span>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-3 pb-3">
      <p v-if="!visibleZen.length && !visibleExternal.length" class="m-0 py-6 text-center text-[12px] text-[var(--color-dim)]">
        {{ t("shell.fleetEmpty") }}
      </p>
      <ul v-else class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 p-0">
        <li v-for="card in visibleZen" :key="`zen-${card.id}`">
          <button
            type="button"
            class="flex h-full w-full flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-line-soft)] bg-[var(--color-side)] p-2.5 text-left transition-colors hover:border-[var(--color-line)]"
            :data-testid="`fleet-card-zen-${card.id}`"
            @click="openZen(card.id)"
          >
            <span class="flex items-center gap-1.5">
              <Bot class="size-3.5 flex-none text-[var(--color-accent)]" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-txt-strong)]">{{ card.name }}</span>
              <span class="flex-none text-[11px] text-[var(--color-dim)]">{{ card.status }}</span>
            </span>
            <span class="line-clamp-2 text-[11px] text-[var(--color-mut)]">{{ card.task }}</span>
          </button>
        </li>
        <li v-for="card in visibleExternal" :key="card.id">
          <button
            type="button"
            class="flex h-full w-full flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-line-soft)] bg-[var(--color-side)] p-2.5 text-left transition-colors hover:border-[var(--color-line)]"
            :data-testid="`fleet-card-external-${card.sessionId}`"
            @click="openExternal(card.id)"
          >
            <span class="flex items-center gap-1.5">
              <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-txt-strong)]">{{ card.title }}</span>
              <span class="flex-none text-[11px] text-[var(--color-dim)]">{{ clientLabel(card.client) }}</span>
            </span>
            <span class="truncate text-[11px] text-[var(--color-mut)]">{{ card.cwd }}</span>
            <span class="flex items-center gap-1.5 text-[11px] text-[var(--color-dim)]">
              <span>{{ formatAgo(card.updatedAt) }}</span>
              <span>· {{ t("panels.externalEventCount", { n: card.eventCount }) }}</span>
              <span v-if="externalStore.canResume(card.id)" class="text-[var(--color-accent)]">
                {{ t("panels.externalCapabilitySupported") }}
              </span>
              <span class="ml-auto">{{ t("panels.externalOpenSession") }}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
