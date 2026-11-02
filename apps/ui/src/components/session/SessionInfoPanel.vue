<script setup lang="ts">
import { useI18n } from "vue-i18n";

import AgentsSection from "@/components/session/AgentsSection.vue";
import EnvInfoSection from "@/components/session/EnvInfoSection.vue";
import SessionWorktreeSection from "@/components/session/SessionWorktreeSection.vue";
import FileCheckpointSection from "@/components/session/FileCheckpointSection.vue";
import ProcessesSection from "@/components/session/ProcessesSection.vue";
import ReferencesSection from "@/components/session/ReferencesSection.vue";
import ServicesSection from "@/components/session/ServicesSection.vue";
import TaskListSection from "@/components/session/TaskListSection.vue";

withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const { t } = useI18n();

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
