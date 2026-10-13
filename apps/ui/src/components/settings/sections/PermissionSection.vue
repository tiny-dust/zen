<script setup lang="ts">
import { ShieldCheck, TriangleAlert } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/stores/agent";

import type { PermissionMode } from "@zen/shared";
import { PERMISSION_MODES } from "@zen/shared";

/** 权限三档：默认 / 智能 / 完全访问（写 agent 设置，下次会话生效） */
const { t } = useI18n();
const agentStore = useAgentStore();
const { settings } = storeToRefs(agentStore);

function pickMode(mode: PermissionMode) {
  void agentStore.updateSettings({ permissionMode: mode });
}
</script>

<template>
  <section id="set-agent-permission" class="flex flex-col gap-2.5 scroll-mt-2">
    <div class="flex items-center gap-2">
      <ShieldCheck :size="15" class="text-[var(--color-mut)]" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.permissionTitle") }}</h3>
    </div>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      {{ t("settings.agent.permissionDesc") }}
    </p>
    <div class="grid gap-2 sm:grid-cols-3">
      <Button
        v-for="item in PERMISSION_MODES"
        :key="item.id"
        variant="ghost"
        class="h-auto flex flex-col whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
        :class="
          settings.permissionMode === item.id
            ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
            : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
        "
        :aria-pressed="settings.permissionMode === item.id"
        @click="pickMode(item.id)"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
            {{ t(`settings.agent.permission.${item.id}.label`) }}
          </span>
          <Badge v-if="item.id === 'full'" variant="secondary" class="text-[10px]">{{ t("settings.agent.highRisk") }}</Badge>
        </div>
        <p class="m-0 mt-1 text-[11px] leading-snug text-[var(--color-mut)]">
          {{ t(`settings.agent.permission.${item.id}.desc`) }}
        </p>
      </Button>
    </div>
    <div
      v-if="settings.permissionMode === 'full'"
      class="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--color-mut)]"
    >
      <TriangleAlert :size="14" class="mt-0.5 flex-none text-[var(--color-warn,#d97709)]" />
      {{ t("settings.agent.fullWarning") }}
    </div>
  </section>
</template>
