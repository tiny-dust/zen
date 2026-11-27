<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";

import VendorLogo from "@/components/brand/VendorLogo.vue";
import { useExternalSessionsStore } from "@/stores/external-sessions";
import { useRightPanelStore } from "@/stores/right-panel";

import type { ExternalAgentClient } from "@zen/shared";

/**
 * 轨道上的外部客户端入口（对照 nomi 的 Endpoint 轨道）：
 * 点厂商图标 = 打开右栏「外部会话」面板并把筛选切到该厂商，再点一次回到「全部」。
 * 图标用厂商标识（Claude / OpenAI / Gemini / DeepSeek / xAI），不再用首字母缩写。
 */
const { t } = useI18n();
const rightPanel = useRightPanelStore();
const store = useExternalSessionsStore();
const { clientFilter, groups } = storeToRefs(store);

const CLIENTS: ExternalAgentClient[] = ["claude", "codex", "gemini", "dsh", "grok"];
/** 客户端 → 厂商标识（Zen 已有品牌素材，不新增图片） */
const VENDOR: Record<ExternalAgentClient, string> = {
  claude: "anthropic",
  codex: "openai",
  gemini: "google",
  dsh: "deepseek",
  grok: "x",
};

function countOf(client: ExternalAgentClient): number {
  return groups.value.find((group) => group.client === client)?.count ?? 0;
}

function detected(client: ExternalAgentClient): boolean {
  const group = groups.value.find((item) => item.client === client);
  return !!group && (group.detected || group.count > 0);
}

function label(client: ExternalAgentClient): string {
  const name = t(`panels.externalClients.${client}`);
  const count = countOf(client);
  return detected(client)
    ? `${name} · ${count}`
    : t("panels.externalNotDetectedLong", { name });
}

async function pick(client: ExternalAgentClient): Promise<void> {
  const next = clientFilter.value === client ? "all" : client;
  store.setClientFilter(next);
  rightPanel.ensureTab("external");
  await store.load();
}

onMounted(() => {
  void store.load();
});
</script>

<template>
  <div class="mt-1 flex flex-col items-center gap-0.5" role="group" :aria-label="t('shell.externalEndpoints')" data-testid="external-endpoint-rail">
    <button
      v-for="client in CLIENTS"
      :key="client"
      type="button"
      class="flex size-8 items-center justify-center rounded-lg transition-colors disabled:opacity-35"
      :class="clientFilter === client
        ? 'bg-[var(--color-menu-active)]'
        : 'hover:bg-[var(--color-menu-hover)]'"
      :aria-pressed="clientFilter === client"
      :disabled="!detected(client)"
      :aria-label="label(client)"
      :title="label(client)"
      :data-testid="`rail-endpoint-${client}`"
      @click="pick(client)"
    >
      <VendorLogo
        :vendor="VENDOR[client]"
        :size="18"
        class="ring-1 ring-[var(--color-line-soft)]"
      />
    </button>
  </div>
</template>
