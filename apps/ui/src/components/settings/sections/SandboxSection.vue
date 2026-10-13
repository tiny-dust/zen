<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SandboxMode } from "@zen/shared";

/** 项目隔离区：直接操作 / 隔离副本（复制到 ~/.zen/sandbox） */
const { t } = useI18n();
const agentStore = useAgentStore();
const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { settings, sandboxDir } = storeToRefs(agentStore);
const rebuildBusy = ref(false);
const rebuildMessage = ref("");

const currentProject = computed(() => {
  const group = workspaceStore.groups.find((item) => item.id === workspaceStore.activeId);
  return group && group.kind === "workspace" ? group : null;
});

function pickSandbox(mode: SandboxMode) {
  void agentStore.updateSettings({ sandboxMode: mode });
}

async function rebuild() {
  if (!currentProject.value?.path) {
    return;
  }
  rebuildBusy.value = true;
  rebuildMessage.value = "";
  const result = await agentStore.rebuildSandbox(currentProject.value.path);
  rebuildMessage.value = result.ok
    ? t("settings.agent.rebuildOk")
    : (result.error ?? t("settings.agent.rebuildFailed"));
  rebuildBusy.value = false;
}
</script>

<template>
  <section id="set-agent-sandbox" class="flex flex-col gap-2.5 scroll-mt-2">
    <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.agent.sandboxTitle") }}</h3>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      {{ t("settings.agent.sandboxDescPrefix") }}<code
        class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]"
      >{{ sandboxDir || '~/.zen/sandbox' }}</code>{{ t("settings.agent.sandboxDescSuffix") }}
    </p>
    <div class="flex gap-2">
      <Button
        v-for="item in [
          { id: 'direct' as SandboxMode, labelKey: 'settings.agent.sandboxDirectLabel', descKey: 'settings.agent.sandboxDirectDesc' },
          { id: 'isolated' as SandboxMode, labelKey: 'settings.agent.sandboxIsolatedLabel', descKey: 'settings.agent.sandboxIsolatedDesc' },
        ]"
        :key="item.id"
        variant="ghost"
        class="h-auto flex flex-col flex-1 whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
        :class="
          settings.sandboxMode === item.id
            ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
            : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
        "
        :aria-pressed="settings.sandboxMode === item.id"
        @click="pickSandbox(item.id)"
      >
        <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t(item.labelKey) }}</span>
        <p class="m-0 mt-1 text-[11px] text-[var(--color-mut)]">{{ t(item.descKey) }}</p>
      </Button>
    </div>
    <div
      v-if="settings.sandboxMode === 'isolated' && currentProject"
      class="flex items-center gap-2 text-[12px] text-[var(--color-mut)]"
    >
      <span class="min-w-0 flex-1 truncate">
        {{ t("settings.agent.currentProject", { name: currentProject.name }) }}
      </span>
      <Button variant="outline" size="sm" :disabled="rebuildBusy" @click="rebuild">
        <RefreshCw :size="13" data-icon="inline-start" />{{ t("settings.agent.rebuildSandbox") }}
      </Button>
    </div>
    <p v-if="rebuildMessage" class="m-0 text-[11px] text-[var(--color-mut)]">
      {{ rebuildMessage }}
    </p>
    <p v-if="chatStore.appInfo" class="m-0 text-[11px] text-[var(--color-dim)]">
      {{ t("settings.agent.sandboxTip") }}
    </p>
  </section>
</template>
