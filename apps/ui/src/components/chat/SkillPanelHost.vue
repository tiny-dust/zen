<script setup lang="ts">
import { ChevronDown, ChevronUp, Sparkles, X } from "@lucide/vue";
import { computed, onMounted, onUnmounted, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";

import { formatTokens } from "@/lib/format-tokens";
import { sessionMetrics } from "@/lib/session-metrics";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useSkillPanelsStore } from "@/stores/skill-panels";
import { useSkillUsageStore } from "@/stores/skill-usage";

import type { SkillPanelInfo, SkillPanelMetrics } from "@zen/shared";

/**
 * 技能面板宿主：技能目录里放了 panel.json 就到这里渲染。
 * 对应 Claude Code 的插件 UI 槽位 + 引擎数据注入：
 * - 技能自带 ui/*.html → sandbox iframe（srcdoc），zen 用 postMessage 推送会话指标
 * - 没声明 ui → 按 manifest.metrics 渲染内置指标行
 * 面板 iframe 可回传 { type: "zen:command", name: "hide" | "toggle" }。
 */
const { t } = useI18n();
const agentStore = useAgentStore();
const chatStore = useChatStore();
const panelsStore = useSkillPanelsStore();
const usageStore = useSkillUsageStore();

const metrics = computed<SkillPanelMetrics>(() =>
  sessionMetrics({
    messages: chatStore.messages,
    inputTokens: chatStore.lastInputTokens,
    outputTokens: chatStore.lastOutputTokens,
    cacheHitRate: chatStore.cacheHitRate,
  }),
);

const frames = new Map<string, HTMLIFrameElement>();
const collapsed = reactive<Record<string, boolean>>({});

interface PanelEntry {
  name: string;
  info: SkillPanelInfo;
}

const panels = computed<PanelEntry[]>(() => {
  const list: PanelEntry[] = [];
  for (const item of usageStore.entriesOf(chatStore.sessionId)) {
    if (item.kind !== "skill" || panelsStore.isHidden(item.name)) {
      continue;
    }
    const dir = dirOf(item.name);
    const info = dir ? panelsStore.byDir[dir] : null;
    if (info) {
      list.push({ name: item.name, info });
    }
  }
  return list;
});

function dirOf(name: string): string | null {
  const skill = agentStore.skills.find(
    (item) => item.name === name || item.dir.split(/[\\/]/).pop() === name,
  );
  return skill?.dir ?? null;
}

/** 本会话出现过的技能 → 拉一次 panel.json（store 内缓存） */
function syncPanels(): void {
  for (const item of usageStore.entriesOf(chatStore.sessionId)) {
    if (item.kind !== "skill") {
      continue;
    }
    const dir = dirOf(item.name);
    if (dir) {
      void panelsStore.ensure(dir);
    }
  }
}

watch(
  () => usageStore.entriesOf(chatStore.sessionId).map((item) => item.key),
  syncPanels,
  { immediate: true },
);
// listSkills 是异步的：技能目录解析出来后再补一次
watch(() => agentStore.skills.length, syncPanels);

function registerFrame(name: string, el: unknown): void {
  if (el instanceof HTMLIFrameElement) {
    frames.set(name, el);
  } else {
    frames.delete(name);
  }
}

function pushMetrics(name: string): void {
  frames.get(name)?.contentWindow?.postMessage(
    { type: "zen:metrics", metrics: metrics.value },
    "*",
  );
}

watch(
  metrics,
  () => {
    for (const name of frames.keys()) {
      pushMetrics(name);
    }
  },
  { deep: true },
);

function onMessage(event: MessageEvent): void {
  const payload = event.data as { type?: unknown; name?: unknown } | null;
  if (!payload || payload.type !== "zen:command") {
    return;
  }
  const name = [...frames.entries()].find(([, el]) => el.contentWindow === event.source)?.[0];
  if (!name) {
    return;
  }
  if (payload.name === "hide") {
    panelsStore.setHidden(name, true);
  } else if (payload.name === "toggle") {
    collapsed[name] = !collapsed[name];
  }
}

onMounted(() => window.addEventListener("message", onMessage));
onUnmounted(() => window.removeEventListener("message", onMessage));

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** 内置指标行：只显示 manifest 里声明的、且有真实数据的指标 */
function statLine(info: SkillPanelInfo): string {
  const wanted = info.manifest.metrics ?? ["rounds", "tools", "elapsed", "tests"];
  const data = metrics.value;
  const parts: string[] = [];
  for (const metric of wanted) {
    if (metric === "rounds" && data.rounds) {
      parts.push(t("chat.band.rounds", { n: data.rounds }));
    } else if (metric === "tools" && data.tools) {
      parts.push(t("chat.band.tools", { n: data.tools }));
    } else if (metric === "elapsed" && data.elapsedMs > 0) {
      parts.push(t("chat.band.elapsed", { value: formatDuration(data.elapsedMs) }));
    } else if (metric === "tests" && data.tests !== "none") {
      parts.push(t(`chat.band.tests.${data.tests}`));
    } else if (metric === "tokens" && (data.inputTokens != null || data.outputTokens != null)) {
      parts.push(
        t("chat.band.tokens", {
          input: data.inputTokens == null ? "—" : formatTokens(data.inputTokens),
          output: data.outputTokens == null ? "—" : formatTokens(data.outputTokens),
        }),
      );
    } else if (metric === "cacheHit" && data.cacheHitRate != null) {
      parts.push(t("chat.band.cache", { rate: data.cacheHitRate }));
    }
  }
  return parts.join(" · ");
}
</script>

<template>
  <div v-if="panels.length" class="mb-2 flex flex-col gap-1.5">
    <div
      v-for="panel in panels"
      :key="panel.name"
      class="rounded-xl border border-[var(--color-line)] bg-[var(--color-chip-bg)] text-[11px] text-[var(--color-mut)]"
      :aria-label="t('chat.band.label', { name: panel.info.manifest.title })"
      :title="t('chat.band.hint')"
    >
      <!-- 技能自带看板：沙箱 iframe，脚本碰不到宿主 -->
      <iframe
        v-if="panel.info.html"
        :ref="(el: unknown) => registerFrame(panel.name, el)"
        :srcdoc="panel.info.html"
        sandbox="allow-scripts"
        class="h-[54px] w-full rounded-xl border-0"
        :title="panel.info.manifest.title"
        @load="pushMetrics(panel.name)"
      />
      <!-- 未声明 ui：内置指标行 -->
      <template v-else>
        <div class="flex items-center gap-2 px-2.5 py-1.5">
          <span class="flex shrink-0 items-center gap-1 font-medium text-[var(--color-txt-strong)]">
            <Sparkles class="size-3" aria-hidden="true" />
            {{ panel.info.manifest.title }}
          </span>
          <span v-if="!collapsed[panel.name]" class="min-w-0 flex-1 truncate">
            {{ statLine(panel.info) }}
          </span>
          <button
            type="button"
            class="flex shrink-0 cursor-pointer items-center rounded-md p-0.5 text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
            :title="collapsed[panel.name] ? t('chat.band.expand') : t('chat.band.collapse')"
            :aria-label="collapsed[panel.name] ? t('chat.band.expand') : t('chat.band.collapse')"
            @click="collapsed[panel.name] = !collapsed[panel.name]"
          >
            <ChevronDown v-if="collapsed[panel.name]" class="size-3" aria-hidden="true" />
            <ChevronUp v-else class="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="flex shrink-0 cursor-pointer items-center rounded-md p-0.5 text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
            :title="t('chat.band.hide')"
            :aria-label="t('chat.band.hide')"
            @click="panelsStore.setHidden(panel.name, true)"
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
