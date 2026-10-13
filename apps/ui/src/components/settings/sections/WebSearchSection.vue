<script setup lang="ts">
import { Globe, X } from "@lucide/vue";
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { WebSearchApiProviderId, WebSearchStatus } from "@zen/shared";

/** 网络搜索：供应商 API Key（key 只写不读回，未配置时走免登录抓取） */
const { t } = useI18n();

const WEB_SEARCH_PROVIDERS: WebSearchApiProviderId[] = ["tavily", "bocha", "serper"];

const webSearchApi = window.zen?.agent;
const webSearchStatus = ref<WebSearchStatus | null>(null);
const webSearchKeys = reactive<Record<WebSearchApiProviderId, string>>({
  tavily: "",
  bocha: "",
  serper: "",
});
const webSearchBusy = ref<WebSearchApiProviderId | null>(null);
const webSearchError = ref("");

function webSearchPlaceholder(provider: WebSearchApiProviderId): string {
  const status = webSearchStatus.value?.[provider];
  if (!status?.configured) {
    return t("settings.agent.webSearchNotConfigured");
  }
  return status.masked ?? t("settings.agent.webSearchConfigured");
}

async function loadWebSearchStatus() {
  if (!webSearchApi) {
    return;
  }
  try {
    webSearchStatus.value = await webSearchApi.webSearchStatus();
  } catch {
    // 拉取失败保持未配置态；保存/清除失败在节内提示
  }
}

async function saveWebSearchKey(provider: WebSearchApiProviderId) {
  // key 不回读，草稿非空即视为新输入；成功后清空，blur 与回车重复触发时自然短路
  const value = webSearchKeys[provider].trim();
  if (!value || webSearchBusy.value) {
    return;
  }
  if (!webSearchApi) {
    webSearchError.value = t("settings.agent.webSearchUnavailable");
    return;
  }
  webSearchBusy.value = provider;
  webSearchError.value = "";
  try {
    webSearchStatus.value = await webSearchApi.setWebSearchKey(provider, value);
    webSearchKeys[provider] = "";
  } catch (error) {
    webSearchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    webSearchBusy.value = null;
  }
}

async function clearWebSearchKey(provider: WebSearchApiProviderId) {
  if (webSearchBusy.value) {
    return;
  }
  if (!webSearchApi) {
    webSearchError.value = t("settings.agent.webSearchUnavailable");
    return;
  }
  webSearchBusy.value = provider;
  webSearchError.value = "";
  try {
    webSearchStatus.value = await webSearchApi.setWebSearchKey(provider, null);
  } catch (error) {
    webSearchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    webSearchBusy.value = null;
  }
}

onMounted(() => {
  void loadWebSearchStatus();
});
</script>

<template>
  <section id="set-agent-websearch" class="flex flex-col gap-2.5 scroll-mt-2">
    <div class="flex items-center gap-2">
      <Globe :size="15" class="text-[var(--color-mut)]" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.webSearchTitle") }}</h3>
    </div>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      {{ t("settings.agent.webSearchDesc") }}
    </p>
    <div class="flex flex-col">
      <div v-for="provider in WEB_SEARCH_PROVIDERS" :key="provider" class="field-row">
        <Label :for="`websearch-${provider}`" class="field-row-label font-normal">
          {{ t(`settings.agent.webSearchProvider.${provider}`) }}
        </Label>
        <div class="flex items-center gap-2">
          <Input
            :id="`websearch-${provider}`"
            v-model="webSearchKeys[provider]"
            type="password"
            autocomplete="off"
            class="h-8 flex-1 text-[12px]"
            :placeholder="webSearchPlaceholder(provider)"
            :aria-label="t('settings.agent.webSearchKeyAria', { provider: t(`settings.agent.webSearchProvider.${provider}`) })"
            @blur="saveWebSearchKey(provider)"
            @keydown.enter.prevent="saveWebSearchKey(provider)"
          />
          <Button
            v-if="webSearchStatus?.[provider]?.configured"
            variant="ghost"
            size="icon-sm"
            class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
            :aria-label="t('settings.agent.webSearchClearAria', { provider: t(`settings.agent.webSearchProvider.${provider}`) })"
            :disabled="webSearchBusy === provider"
            @click="clearWebSearchKey(provider)"
          >
            <X :size="14" />
          </Button>
        </div>
      </div>
    </div>
    <p v-if="webSearchError" class="m-0 text-[11px] text-[var(--color-err)]">
      {{ webSearchError }}
    </p>
  </section>
</template>
