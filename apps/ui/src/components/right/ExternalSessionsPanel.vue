<script setup lang="ts">
import {
  IconAlertCircle as CircleAlert,
  IconBrain as Brain,
  IconFileText as FileText,
  IconLoader2 as Loader2,
  IconPlayerStop as PlayerStop,
  IconRefresh as RefreshCw,
  IconRobot as Bot,
  IconSend as Send,
  IconTool as Wrench,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import VendorLogo from "@/components/brand/VendorLogo.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useExternalSessionsStore } from "@/stores/external-sessions";

import type { ExternalAgentClient, ExternalResumeBlocked, ExternalTraceEvent } from "@zen/shared";

/**
 * 外部 agent 会话：本机 Claude Code / Codex / Gemini / DSH / Grok 的会话文件，
 * 以及「在原厂商会话里继续对话」——续聊由主进程按固定配方调 CLI，这里只发 id + 文本。
 */
const { t } = useI18n();
const store = useExternalSessionsStore();
const {
  filtered,
  groups,
  loading,
  error,
  clientFilter,
  query,
  selectedId,
  selected,
  trace,
  traceLoading,
  traceTruncated,
  traceError,
  skipped,
  activeRun,
  runningId,
  currentClient,
} = storeToRefs(store);

const CLIENTS: ExternalAgentClient[] = ["claude", "codex", "gemini", "dsh", "grok"];
/** 客户端 → 厂商标识（与轨道共用 Zen 已有品牌素材） */
const VENDOR: Record<ExternalAgentClient, string> = {
  claude: "anthropic",
  codex: "openai",
  gemini: "google",
  dsh: "deepseek",
  grok: "x",
};

const draft = ref("");
const sending = ref(false);
const sendError = ref("");
const scrollEl = ref<HTMLElement | null>(null);

const focusVendor = computed(() => (currentClient.value ? VENDOR[currentClient.value] : ""));
const canSend = computed(
  () => !!selectedId.value && store.canResume(selectedId.value) && !activeRun.value?.running,
);
const blockedReason = computed<ExternalResumeBlocked | null>(() =>
  selectedId.value ? store.resumeBlockedReason(selectedId.value) : null,
);
const blockedText = computed(() => (selected.value ? reasonText(blockedReason.value, selected.value.client) : ""));
const capabilityBadge = computed(() => {
  const client = currentClient.value;
  if (!client) {
    return "";
  }
  const capability = store.capabilityOf(client);
  if (capability?.resume === "supported") {
    return t("panels.externalCapabilitySupported");
  }
  return capability?.resume === "missing-cli"
    ? t("panels.externalCapabilityMissingCli")
    : t("panels.externalCapabilityUnsupported");
});

function clientLabel(client: ExternalAgentClient): string {
  return t(`panels.externalClients.${client}`);
}

function reasonText(reason: ExternalResumeBlocked | null, client: ExternalAgentClient): string {
  if (reason === "missing-cli") {
    return t("panels.externalResumeBlockedMissingCli", { cmd: store.commandOf(client) });
  }
  if (reason === "unknown-session") {
    return t("panels.externalResumeBlockedUnknownSession");
  }
  if (reason === "unsupported") {
    return t("panels.externalResumeBlockedUnsupported", { client: clientLabel(client) });
  }
  return "";
}

function statusLabel(status: string): string {
  return t(`panels.externalStatus.${status}`);
}

function statusClass(status: string): string {
  if (status === "running") {
    return "text-[var(--color-accent)]";
  }
  return status === "idle" ? "text-[var(--color-mut)]" : "text-[var(--color-dim)]";
}

function formatAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return t("panels.externalJustNow");
  }
  if (minutes < 60) {
    return t("panels.externalMinutesAgo", { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("panels.externalHoursAgo", { n: hours });
  }
  return t("panels.externalDaysAgo", { n: Math.floor(hours / 24) });
}

function eventLabel(event: ExternalTraceEvent): string {
  return t(`panels.externalKinds.${event.kind}`);
}

function eventClass(event: ExternalTraceEvent): string {
  switch (event.kind) {
    case "user":
      return "text-[var(--color-txt-strong)]";
    case "assistant":
      return "text-[var(--color-txt)]";
    case "error":
      return "text-[var(--color-danger-fg)]";
    case "thinking":
    case "tool":
    case "result":
      return "text-[var(--color-mut)]";
    default:
      return "text-[var(--color-dim)]";
  }
}

async function submit(): Promise<void> {
  const text = draft.value.trim();
  if (!text || !canSend.value || sending.value) {
    return;
  }
  sending.value = true;
  sendError.value = "";
  const result = await store.send(text);
  sending.value = false;
  if (result.ok) {
    draft.value = "";
    return;
  }
  // 失败时保留输入原文；能力拦下的情况由输入框上方的说明行交代原因
  sendError.value = result.error ?? "";
}

// 流事件要求原文回填（同一段文字可能连续失败两次，用对象引用区分）
watch(
  () => store.restoreDraft,
  (draftback) => {
    if (!draftback) {
      return;
    }
    draft.value = draftback.text;
    store.clearRestoreDraft();
  },
);

// 记录 / 流式输出变化时贴底
watch(
  () => [trace.value.length, activeRun.value?.assistantText ?? "", traceLoading.value] as const,
  async () => {
    await nextTick();
    const el = scrollEl.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  },
);

onMounted(async () => {
  await store.load();
  if (selectedId.value) {
    await store.refreshTrace(selectedId.value);
  }
});

onUnmounted(() => {
  store.dispose();
});
</script>

<template>
  <div class="external-panel flex h-full min-h-0 flex-col gap-2" data-testid="external-panel">
    <header class="flex flex-none items-center gap-2 px-1 text-[var(--font-size-sm)] text-[var(--color-mut)]">
      <VendorLogo v-if="focusVendor" :vendor="focusVendor" :size="16" />
      <Bot v-else class="size-3.5 flex-none" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate font-medium text-[var(--color-txt-strong)]">
        {{ t("panels.externalTitle") }}
      </span>
      <span
        v-if="runningId"
        class="flex flex-none items-center gap-1 rounded-full bg-[var(--color-menu-active)] px-1.5 py-0.5 text-[11px] text-[var(--color-accent)]"
        data-testid="external-running"
      >
        <Loader2 class="size-3 animate-spin" aria-hidden="true" />
        {{ t("panels.externalStatus.running") }}
      </span>
      <span
        v-if="capabilityBadge"
        class="min-w-0 truncate rounded-full border border-[var(--color-line)] px-1.5 py-0.5 text-[11px]"
        :class="store.currentCapability?.resume === 'supported'
          ? 'text-[var(--color-accent)]'
          : 'text-[var(--color-dim)]'"
        :title="store.currentCapability?.note ?? capabilityBadge"
        data-testid="external-capability"
      >
        {{ capabilityBadge }}
      </span>
      <span class="ml-auto flex-none tabular-nums text-[var(--font-size-xs)] text-[var(--color-dim)]">
        {{ filtered.length }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.externalRefresh')"
        :title="t('panels.externalRefresh')"
        :disabled="loading"
        data-testid="external-refresh"
        @click="store.load()"
      >
        <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
      </Button>
    </header>

    <p v-if="error" class="m-0 flex-none px-1 text-[11px] text-[var(--color-danger-fg)]" role="alert">
      {{ t("panels.externalFailed", { message: error }) }}
    </p>

    <div class="external-body grid min-h-0 flex-1 grid-cols-[minmax(150px,34%)_minmax(0,1fr)] gap-2">
      <!-- 会话列表 -->
      <section class="flex min-h-0 flex-col gap-1.5">
        <Input
          v-model="query"
          class="h-7 flex-none text-[12px]"
          :placeholder="t('panels.externalSearch')"
          :aria-label="t('panels.externalSearch')"
        />
        <div class="flex flex-none flex-wrap gap-1" role="group" :aria-label="t('panels.externalFilter')">
          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded-full px-2 text-[var(--font-size-xs)] transition-colors"
            :class="clientFilter === 'all'
              ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]'
              : 'text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)]'"
            :aria-pressed="clientFilter === 'all'"
            data-testid="external-filter-all"
            @click="store.setClientFilter('all')"
          >
            {{ t("panels.externalAll") }}
          </button>
          <button
            v-for="client in CLIENTS"
            :key="client"
            type="button"
            class="flex h-6 items-center gap-1 rounded-full px-2 text-[var(--font-size-xs)] transition-colors disabled:opacity-50"
            :class="clientFilter === client
              ? 'bg-[var(--color-menu-active)] font-medium text-[var(--color-txt-strong)]'
              : 'text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)]'"
            :aria-pressed="clientFilter === client"
            :disabled="!groups.find((group) => group.client === client)?.detected"
            :title="!groups.find((group) => group.client === client)?.detected
              ? t('panels.externalNotDetectedLong', { name: clientLabel(client) })
              : clientLabel(client)"
            :data-testid="`external-filter-${client}`"
            @click="store.setClientFilter(client)"
          >
            {{ clientLabel(client) }}
            <span class="tabular-nums text-[var(--color-dim)]">
              {{ groups.find((group) => group.client === client)?.count ?? 0 }}
            </span>
          </button>
        </div>

        <ul
          class="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-auto p-0"
          :aria-label="t('panels.externalSessions')"
        >
          <li v-if="loading && !filtered.length" class="px-2 py-3 text-[12px] text-[var(--color-dim)]">
            {{ t("panels.externalLoading") }}
          </li>
          <li v-else-if="!filtered.length" class="px-2 py-3 text-[12px] text-[var(--color-dim)]">
            {{ t("panels.externalEmpty") }}
          </li>
          <li v-for="session in filtered" :key="session.id">
            <button
              type="button"
              class="flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors"
              :class="session.id === selectedId
                ? 'bg-[var(--color-menu-active)]'
                : 'hover:bg-[var(--color-menu-hover)]'"
              :aria-current="session.id === selectedId ? 'true' : undefined"
              :data-testid="`external-session-${session.sessionId}`"
              @click="store.select(session.id)"
            >
              <span class="flex w-full items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--color-txt-strong)]">
                  {{ session.title }}
                </span>
                <Loader2
                  v-if="runningId === session.id"
                  class="size-3 flex-none animate-spin text-[var(--color-accent)]"
                  aria-hidden="true"
                />
                <span class="flex-none text-[11px] text-[var(--color-dim)]">{{ clientLabel(session.client) }}</span>
              </span>
              <span v-if="session.cwd" class="w-full truncate text-[11px] text-[var(--color-dim)]">{{ session.cwd }}</span>
              <span class="flex w-full items-center gap-1.5 text-[11px] text-[var(--color-dim)]">
                <span class="flex-none" :class="statusClass(session.status)">{{ statusLabel(session.status) }}</span>
                <span class="flex-none tabular-nums">{{ formatAgo(session.updatedAt) }}</span>
                <span class="ml-auto flex-none tabular-nums">
                  {{ t("panels.externalEventCount", { n: session.eventCount }) }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <!-- 记录 + 续聊 -->
      <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-soft)]">
        <p v-if="!selected" class="m-0 px-2 py-3 text-[12px] text-[var(--color-dim)]">
          {{ t("panels.externalPickHint") }}
        </p>
        <template v-else>
          <div class="flex flex-none items-center gap-2 border-b border-[var(--color-line-soft)] px-2 py-1.5">
            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt-strong)]">{{ selected.title }}</span>
            <span class="flex-none text-[11px] text-[var(--color-dim)]">{{ clientLabel(selected.client) }}</span>
          </div>

          <div ref="scrollEl" class="min-h-0 flex-1 overflow-auto px-2 py-1.5" data-testid="external-record">
            <p v-if="traceLoading" class="m-0 flex items-center gap-1.5 text-[11px] text-[var(--color-dim)]">
              <Loader2 class="size-3 animate-spin" aria-hidden="true" />
              {{ t("panels.externalTraceLoading") }}
            </p>
            <p v-else-if="traceError" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">
              {{ t("panels.externalFailed", { message: traceError }) }}
            </p>
            <p v-else-if="!trace.length && !activeRun" class="m-0 text-[11px] text-[var(--color-dim)]">
              {{ t("panels.externalTraceEmpty") }}
            </p>
            <ol v-if="trace.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
              <li v-for="(event, index) in trace" :key="`${event.sourceType ?? event.kind}-${index}`" class="flex flex-col gap-0.5">
                <span class="flex items-center gap-1 text-[11px] text-[var(--color-dim)]">
                  <Brain v-if="event.kind === 'thinking'" class="size-3 flex-none" aria-hidden="true" />
                  <Wrench v-else-if="event.kind === 'tool' || event.kind === 'result'" class="size-3 flex-none" aria-hidden="true" />
                  <CircleAlert v-else-if="event.kind === 'error'" class="size-3 flex-none" aria-hidden="true" />
                  <FileText v-else class="size-3 flex-none" aria-hidden="true" />
                  <span>{{ eventLabel(event) }}</span>
                  <span v-if="event.toolName" class="font-[family-name:var(--font-mono)]">{{ event.toolName }}</span>
                  <span v-if="event.sourceType" class="truncate">{{ event.sourceType }}</span>
                </span>
                <p class="m-0 whitespace-pre-wrap break-words text-[12px] leading-snug" :class="eventClass(event)">
                  {{ event.text }}
                </p>
              </li>
            </ol>
            <p v-if="traceTruncated" class="m-0 mt-2 text-[11px] text-[var(--color-dim)]">
              {{ t("panels.externalTruncated") }}
            </p>

            <!-- 本地流式气泡：done 后由权威记录替换 -->
            <div
              v-if="activeRun"
              class="mt-2 flex flex-col gap-1.5 border-t border-dashed border-[var(--color-line-soft)] pt-2"
              data-testid="external-local-run"
            >
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-[var(--color-dim)]">{{ t("panels.externalKinds.user") }}</span>
                <p class="m-0 whitespace-pre-wrap break-words text-[12px] leading-snug text-[var(--color-txt-strong)]">
                  {{ activeRun.userText }}
                </p>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="flex items-center gap-1 text-[11px] text-[var(--color-dim)]">
                  {{ t("panels.externalKinds.assistant") }}
                  <Loader2 v-if="activeRun.running" class="size-3 animate-spin" aria-hidden="true" />
                  <span v-else-if="activeRun.stopped">{{ t("panels.externalStopped") }}</span>
                </span>
                <p class="m-0 whitespace-pre-wrap break-words text-[12px] leading-snug text-[var(--color-txt)]">
                  {{ activeRun.assistantText || (activeRun.running ? t("panels.externalWaitingReply") : "") }}
                </p>
              </div>
              <p v-if="activeRun.error" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">
                {{ t("panels.externalRunFailed", { message: activeRun.error }) }}
              </p>
            </div>
          </div>

          <!-- 续聊输入区 -->
          <footer class="flex flex-none flex-col gap-1 border-t border-[var(--color-line-soft)] p-2">
            <p v-if="blockedText" class="m-0 text-[11px] text-[var(--color-dim)]" data-testid="external-reason">
              {{ blockedText }}
            </p>
            <p v-if="sendError" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">
              {{ t("panels.externalSendFailed", { message: sendError }) }}
            </p>
            <div class="flex items-end gap-1">
              <Textarea
                v-model="draft"
                class="max-h-40 min-h-[60px] text-[13px]"
                :placeholder="blockedText || t('panels.externalComposerPlaceholder')"
                :aria-label="t('panels.externalComposerPlaceholder')"
                :disabled="!canSend"
                data-testid="external-composer"
                @keydown.enter.exact.prevent="submit"
              />
              <div class="flex flex-none flex-col gap-1">
                <Button
                  v-if="activeRun?.running"
                  variant="outline"
                  size="icon-sm"
                  :aria-label="t('panels.externalStop')"
                  :title="activeRun.stopping ? t('panels.externalStopping') : t('panels.externalStop')"
                  :disabled="activeRun.stopping"
                  data-testid="external-stop"
                  @click="store.stop()"
                >
                  <PlayerStop class="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  v-else
                  size="icon-sm"
                  :aria-label="t('panels.externalSend')"
                  :title="t('panels.externalSend')"
                  :disabled="!canSend || !draft.trim() || sending"
                  data-testid="external-send"
                  @click="submit"
                >
                  <Loader2 v-if="sending" class="size-3.5 animate-spin" aria-hidden="true" />
                  <Send v-else class="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </footer>
        </template>
      </section>
    </div>

    <p v-if="skipped" class="m-0 flex-none px-1 text-[11px] text-[var(--color-dim)]">
      {{ t("panels.externalSkipped", { n: skipped }) }}
    </p>
  </div>
</template>

<style scoped>
/* 右栏可缩到 300px：窄到这个程度时列表与记录上下堆叠，避免两栏都挤成一行几个字 */
.external-panel {
  container-type: inline-size;
}

@container (max-width: 400px) {
  .external-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 38%) minmax(0, 1fr);
  }
}
</style>
