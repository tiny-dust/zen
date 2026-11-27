<script setup lang="ts">
import { storeToRefs } from "pinia";

import FleetPage from "@/components/fleet/FleetPage.vue";
import ActivityInboxPage from "@/components/sidebar/ActivityInboxDialog.vue";
import FeaturesPage from "@/components/sidebar/FeaturesDialog.vue";
import McpPage from "@/components/sidebar/McpDialog.vue";
import SchedulerPage from "@/components/sidebar/SchedulerDialog.vue";
import SkillsPage from "@/components/sidebar/SkillsDialog.vue";
import SettingsPage from "@/components/settings/SettingsPage.vue";
import TasksPage from "@/components/tasks/TasksPage.vue";
import { useWorkbenchPageStore } from "@/stores/workbench-page";

/**
 * 轨道分类入口的内容区整页宿主（对齐 nomi）：同一时刻只挂一个整页，
 * 切换即替换；对话子树由 App.vue 用 v-show 保活，草稿与流式输出不中断。
 */
const pageStore = useWorkbenchPageStore();
const { page } = storeToRefs(pageStore);
</script>

<template>
  <FleetPage v-if="page === 'fleet'" />
  <SchedulerPage v-else-if="page === 'scheduler'" />
  <SkillsPage v-else-if="page === 'skills'" />
  <McpPage v-else-if="page === 'mcp'" />
  <FeaturesPage v-else-if="page === 'features'" />
  <ActivityInboxPage v-else-if="page === 'inbox'" />
  <SettingsPage v-else-if="page === 'settings'" />
  <TasksPage v-else-if="page === 'tasks'" />
</template>
