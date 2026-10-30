<script setup lang="ts">
import { onUnmounted, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ExternalLink, RefreshCw } from "@lucide/vue";

import { Button } from "@/components/ui/button";

import type { ProviderUsageSnapshot } from "@zen/shared";

const props = defineProps<{
  providerId: string;
  accountMode: boolean;
}>();

const { t, locale } = useI18n();
const usage = shallowRef<ProviderUsageSnapshot | null>(null);
const loading = shallowRef(false);
const error = shallowRef<string | null>(null);
let requestId = 0;

function formatCount(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value);
}

function formatUpdatedAt(value: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

async function refresh() {
  const currentRequest = ++requestId;
  loading.value = true;
  error.value = null;
  try {
    const models = window.zen?.models;
    if (!models) throw new Error(t("settings.models.codexUsageError"));
    const result = await models.getUsage(props.providerId);
    if (currentRequest === requestId) usage.value = result;
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : t("settings.models.codexUsageError");
    }
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
}

function openOfficialUsage() {
  const url = props.accountMode
    ? "https://chatgpt.com/settings/usage"
    : "https://platform.openai.com/usage";
  void window.zen?.app.openSystemExternal(url);
}

watch(() => props.providerId, () => {
  usage.value = null;
  void refresh();
}, { immediate: true });

onUnmounted(() => { requestId += 1; });
</script>

<template>
  <section class="rounded-[var(--radius)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] p-3" :aria-label="t('settings.models.codexUsageTitle')">
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="text-[13px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.models.codexUsageTitle") }}</div>
        <div class="text-[11px] text-[var(--color-mut)]">{{ t("settings.models.codexUsageLocal") }}</div>
      </div>
      <Button variant="ghost" size="icon-sm" :aria-label="t('settings.models.codexUsageRefresh')" :disabled="loading" @click="refresh">
        <RefreshCw :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <p v-if="error" class="mt-2 text-[11px] text-[var(--color-err)]" role="alert">{{ error }}</p>
    <template v-if="usage">
      <div class="mt-3 grid grid-cols-2 gap-2">
        <div class="rounded-[var(--radius-sm)] bg-[var(--color-sunken)] px-3 py-2">
          <div class="text-[11px] text-[var(--color-mut)]">{{ t("settings.models.codexUsageToday") }}</div>
          <div class="mt-0.5 font-mono text-[17px] tabular-nums text-[var(--color-txt-strong)]">{{ formatCount(usage.today.totalTokens) }}</div>
          <div class="text-[10px] text-[var(--color-dim)]">tokens</div>
        </div>
        <div class="rounded-[var(--radius-sm)] bg-[var(--color-sunken)] px-3 py-2">
          <div class="text-[11px] text-[var(--color-mut)]">{{ t("settings.models.codexUsageTotal") }}</div>
          <div class="mt-0.5 font-mono text-[17px] tabular-nums text-[var(--color-txt-strong)]">{{ formatCount(usage.total.totalTokens) }}</div>
          <div class="text-[10px] text-[var(--color-dim)]">tokens</div>
        </div>
      </div>

      <div v-if="usage.total.usageEvents > 0" class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-mut)]">
        <span>{{ t("settings.models.codexUsageInput") }} {{ formatCount(usage.total.inputTokens) }}</span>
        <span>{{ t("settings.models.codexUsageOutput") }} {{ formatCount(usage.total.outputTokens) }}</span>
        <span>{{ t("settings.models.codexUsageCached") }} {{ formatCount(usage.total.cachedInputTokens) }}</span>
        <span>{{ t("settings.models.codexUsageRequests") }} {{ formatCount(usage.total.usageEvents) }}</span>
      </div>
      <p v-else class="mt-2 text-[11px] text-[var(--color-dim)]">{{ t("settings.models.codexUsageEmpty") }}</p>

      <div v-if="usage.byModel.length" class="mt-3 border-t border-[var(--color-line-soft)] pt-2">
        <div class="mb-1 text-[11px] text-[var(--color-mut)]">{{ t("settings.models.codexUsageByModel") }}</div>
        <div v-for="item in usage.byModel" :key="item.modelId" class="flex items-center justify-between gap-3 py-0.5 text-[11px]">
          <span class="min-w-0 truncate font-mono text-[var(--color-txt)]" :title="item.modelId">{{ item.modelId }}</span>
          <span class="shrink-0 font-mono tabular-nums text-[var(--color-mut)]">{{ formatCount(item.usage.totalTokens) }}</span>
        </div>
      </div>
      <p v-if="usage.updatedAt" class="mt-2 text-[10px] text-[var(--color-dim)]">{{ t("settings.models.codexUsageUpdated", { time: formatUpdatedAt(usage.updatedAt) }) }}</p>
    </template>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line-soft)] pt-2">
      <span class="text-[11px] leading-snug text-[var(--color-dim)]">{{ t(accountMode ? "settings.models.codexQuotaAccountHint" : "settings.models.codexQuotaApiHint") }}</span>
      <Button variant="outline" size="sm" @click="openOfficialUsage">
        <ExternalLink data-icon="inline-start" />
        {{ t(accountMode ? "settings.models.codexOfficialQuota" : "settings.models.codexOfficialApiUsage") }}
      </Button>
    </div>
  </section>
</template>
