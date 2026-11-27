<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { ProviderSummary, UsageLedger } from "@zen/shared";

/**
 * 用量账本：读主进程 usage_events 明细表，按时间窗口与供应商筛选后做汇总。
 * 只展示真实上报的 usage；仓库没有模型价格数据，因此不做费用估算，
 * CLI 运行不产生 API 用量也不计入（显示为未知，而不是 0）。
 */
const { t } = useI18n();
const ledger = ref<UsageLedger | null>(null);
const providers = ref<ProviderSummary[]>([]);
/** 0 = 全部历史 */
const range = ref("30");
const providerId = ref("");
const loading = ref(false);
const error = ref("");

const rangeOptions = computed(() => [
  { value: "7", label: t("settings.usage.range7") },
  { value: "30", label: t("settings.usage.range30") },
  { value: "90", label: t("settings.usage.range90") },
  { value: "0", label: t("settings.usage.rangeAll") },
]);

const providerOptions = computed(() => [
  { value: "", label: t("settings.usage.allProviders") },
  ...providers.value.map((provider) => ({ value: provider.id, label: provider.name })),
]);

const totals = computed(() => ledger.value?.totals);
const topModels = computed(() => (ledger.value?.byModel ?? []).slice(0, 10));
const recent = computed(() => (ledger.value?.recent ?? []).slice(0, 8));

function providerName(id: string): string {
  return providers.value.find((provider) => provider.id === id)?.name ?? id;
}

function num(value: number): string {
  return value.toLocaleString();
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString();
}

async function load() {
  if (!window.zen) {
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    ledger.value = await window.zen.models.usageLedger({
      days: Number(range.value),
      providerId: providerId.value || undefined,
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.usage.loadFailed");
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    providers.value = await window.zen!.models.list();
  } catch {
    // 供应商列表读不到时仍展示全局账本
  }
  await load();
});
</script>

<template>
  <section id="set-usage-ledger" class="flex flex-col gap-2 scroll-mt-2">
    <h3 class="settings-section-title">{{ t("settings.usage.title") }}</h3>

    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <p class="m-0 text-[var(--font-size-sm)] leading-relaxed text-[var(--color-mut)]">
          {{ t("settings.usage.description") }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <Select v-model="range" @update:model-value="load">
            <SelectTrigger class="h-8 w-[132px] text-[var(--font-size-sm)]" :aria-label="t('settings.usage.rangeLabel')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in rangeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="providerId" @update:model-value="load">
            <SelectTrigger class="h-8 w-[200px] text-[var(--font-size-sm)]" :aria-label="t('settings.usage.providerLabel')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in providerOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span v-if="loading" class="text-[var(--font-size-xs)] text-[var(--color-dim)]">
            {{ t("settings.usage.loading") }}
          </span>
        </div>

        <p v-if="error" class="m-0 text-[var(--font-size-sm)] text-[var(--color-danger-fg)]" role="alert">{{ error }}</p>

        <dl v-if="totals" class="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[var(--font-size-sm)] sm:grid-cols-4">
          <div class="flex flex-col">
            <dt class="m-0 text-[var(--font-size-xs)] text-[var(--color-dim)]">{{ t("settings.usage.inputTokens") }}</dt>
            <dd class="m-0 tabular-nums text-[var(--color-txt-strong)]">{{ num(totals.inputTokens) }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="m-0 text-[11px] text-[var(--color-dim)]">{{ t("settings.usage.outputTokens") }}</dt>
            <dd class="m-0 tabular-nums text-[var(--color-txt-strong)]">{{ num(totals.outputTokens) }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="m-0 text-[11px] text-[var(--color-dim)]">{{ t("settings.usage.cachedTokens") }}</dt>
            <dd class="m-0 tabular-nums text-[var(--color-txt-strong)]">{{ num(totals.cachedInputTokens) }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="m-0 text-[11px] text-[var(--color-dim)]">{{ t("settings.usage.events") }}</dt>
            <dd class="m-0 tabular-nums text-[var(--color-txt-strong)]">{{ num(totals.events) }}</dd>
          </div>
        </dl>

        <p v-if="totals && !totals.events" class="m-0 text-[var(--font-size-sm)] text-[var(--color-dim)]">
          {{ t("settings.usage.empty") }}
        </p>

        <div v-if="topModels.length" class="flex flex-col gap-1">
          <span class="text-[var(--font-size-xs)] text-[var(--color-dim)]">{{ t("settings.usage.byModel") }}</span>
          <div
            v-for="row in topModels"
            :key="`${row.providerId}:${row.modelId}`"
            class="flex items-baseline justify-between gap-3 text-[var(--font-size-sm)]"
          >
            <span class="min-w-0 truncate text-[var(--color-txt)]">
              {{ providerName(row.providerId) }} · {{ row.modelId }}
            </span>
            <span class="flex-none tabular-nums text-[var(--color-mut)]">
              {{ t("settings.usage.rowSummary", {
                input: num(row.inputTokens),
                output: num(row.outputTokens),
                events: num(row.events),
              }) }}
            </span>
          </div>
        </div>

        <div v-if="recent.length" class="flex flex-col gap-1">
          <span class="text-[var(--font-size-xs)] text-[var(--color-dim)]">{{ t("settings.usage.recent") }}</span>
          <div
            v-for="(row, index) in recent"
            :key="`${row.ts}-${index}`"
            class="flex items-baseline justify-between gap-3 text-[var(--font-size-xs)]"
          >
            <span class="min-w-0 truncate text-[var(--color-mut)]">
              {{ timeLabel(row.ts) }} · {{ row.modelId }}
            </span>
            <span class="flex-none tabular-nums text-[var(--color-dim)]">
              {{ t("settings.usage.rowSummary", {
                input: num(row.inputTokens),
                output: num(row.outputTokens),
                events: 1,
              }) }}
            </span>
          </div>
        </div>

        <p class="m-0 text-[var(--font-size-xs)] leading-relaxed text-[var(--color-dim)]">
          {{ t("settings.usage.costNote") }}
        </p>
        <p class="m-0 text-[var(--font-size-xs)] leading-relaxed text-[var(--color-dim)]">
          {{ t("settings.usage.cliNote") }}
        </p>
      </CardContent>
    </Card>
  </section>
</template>
