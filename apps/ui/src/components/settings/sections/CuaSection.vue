<script setup lang="ts">
import { MonitorSmartphone, TriangleAlert } from "@lucide/vue";
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAgentStore } from "@/stores/agent";

/** 桌面自动化（CUA）总开关：agent 工具域 cua.* 的注册前提，默认关闭（高风险） */
const { t } = useI18n();
const agentStore = useAgentStore();
const { settings } = storeToRefs(agentStore);

const isMac = computed(() => navigator.userAgent.includes("Mac"));

function toggle() {
  void agentStore.updateSettings({ cuaEnabled: !settings.value.cuaEnabled });
}

/** macOS 辅助功能授权面板深链（TCC Privacy_Accessibility） */
function openAccessibilitySettings() {
  void window.zen?.app.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  );
}
</script>

<template>
  <section id="set-agent-cua" class="flex flex-col gap-2.5 scroll-mt-2">
    <div class="flex items-center gap-2">
      <MonitorSmartphone :size="15" class="text-[var(--color-mut)]" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.cuaTitle") }}</h3>
    </div>
    <div class="flex flex-col gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.cuaEnable") }}</div>
        <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-mut)]">
          <Checkbox
            :model-value="settings.cuaEnabled"
            :aria-label="t('settings.agent.cuaEnable')"
            @update:model-value="toggle"
          />
          {{ t("settings.agent.cuaEnable") }}
        </label>
      </div>
      <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
        {{ t("settings.agent.cuaDesc") }}
      </p>
      <div
        v-if="settings.cuaEnabled"
        class="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--color-mut)]"
      >
        <TriangleAlert :size="14" class="mt-0.5 flex-none text-[var(--color-warn,#d97709)]" />
        {{ t("settings.agent.cuaWarning") }}
      </div>
    </div>
    <!-- macOS：辅助功能授权引导（CUA 鼠标/键盘控制的前置条件） -->
    <Button
      v-if="settings.cuaEnabled && isMac"
      variant="outline"
      size="sm"
      class="self-start"
      @click="openAccessibilitySettings"
    >
      {{ t("settings.agent.cuaOpenAccessibility") }}
    </Button>
  </section>
</template>
