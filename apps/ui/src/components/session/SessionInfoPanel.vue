<script setup lang="ts">
import { IconRoute as RouteIcon } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import AgentsSection from "@/components/session/AgentsSection.vue";
import EnvInfoSection from "@/components/session/EnvInfoSection.vue";
import SessionWorktreeSection from "@/components/session/SessionWorktreeSection.vue";
import FileCheckpointSection from "@/components/session/FileCheckpointSection.vue";
import ProcessesSection from "@/components/session/ProcessesSection.vue";
import ReferencesSection from "@/components/session/ReferencesSection.vue";
import ServicesSection from "@/components/session/ServicesSection.vue";
import TaskListSection from "@/components/session/TaskListSection.vue";
import { Button } from "@/components/ui/button";
import { countSessionTrace } from "@/lib/trace/document";
import { useChatStore } from "@/stores/chat";
import { useRightPanelStore } from "@/stores/right-panel";

withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const { t } = useI18n();
const chatStore = useChatStore();
const rightPanel = useRightPanelStore();
const { messages } = storeToRefs(chatStore);

/** 入口行：轮次数 · 工具调用数（与 Nomi 的「运行轨迹 N 轮 · M 工具」同构） */
const traceCount = computed(() => countSessionTrace(messages.value));

function openTrace() {
  rightPanel.ensureTab("trace");
}

/**
 * 会话信息栏：不再用整块「信息卡」包起来，改为各节折叠面板平铺。
 * 只保留纵向滚动与节间距，边框/底色交给各节自己的折叠头。
 */
const listCls = "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [scrollbar-width:thin]";
</script>

<template>
  <aside
    :class="
      embedded
        ? 'flex min-w-0 flex-col gap-4'
        : 'flex h-full min-w-0 flex-col overflow-hidden bg-transparent p-2'
    "
    :aria-label="t('shell.sessionInfo')"
    data-select-text
  >
    <div :class="embedded ? 'flex flex-col gap-4' : listCls">
      <Button
        v-if="traceCount.turns > 0"
        variant="ghost"
        class="h-8 w-full justify-start gap-2 rounded-[var(--radius-sm)] px-2 text-[13px] font-normal text-[var(--color-txt)] hover:bg-[var(--color-side-hover)]"
        @click="openTrace"
      >
        <RouteIcon :size="14" class="shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
        <span class="shrink-0">{{ t("trace.sessionTraceRow") }}</span>
        <span class="min-w-0 flex-1 truncate text-end text-[11px] text-[var(--color-dim)]">
          {{
            t("trace.sessionTraceSummary", {
              turns: traceCount.turns,
              tools: traceCount.tools,
            })
          }}
        </span>
      </Button>
      <EnvInfoSection />
      <SessionWorktreeSection />
      <TaskListSection />
      <FileCheckpointSection />
      <ProcessesSection />
      <ServicesSection />
      <AgentsSection />
      <ReferencesSection />
    </div>
  </aside>
</template>
