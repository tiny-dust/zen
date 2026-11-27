<script setup lang="ts">
import {
  IconBell as Bell,
  IconBoxMultiple as Blocks,
  IconChecklist as Checklist,
  IconMessage as Messages,
  IconPlug as McpConnector,
  IconRobot as Robot,
  IconSparkles as Skills,
  IconSettings as Settings,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import CollapsedSessionPeek from "@/components/sidebar/CollapsedSessionPeek.vue";
import ExternalEndpointRail from "@/components/sidebar/ExternalEndpointRail.vue";
import UserBlock from "@/components/sidebar/UserBlock.vue";
import { Button } from "@/components/ui/button";
import { useActivityInboxStore } from "@/stores/activity-inbox";
import { NAV_RAIL_W, useLayoutStore } from "@/stores/layout";
import { useSettingsStore } from "@/stores/settings";
import { useWorkbenchPageStore, type WorkbenchPage } from "@/stores/workbench-page";

/**
 * 52px 常驻分类轨道（对齐 nomi 的 .rail）：分类入口在内容区切页，不弹窗；
 * 账户与设置固定在轨道底部，会话面板收起后入口仍然可达。
 * 图标 18px / 按钮 32px（--control-h-ms），间距 2px。
 */

interface RailEntry {
  page: WorkbenchPage;
  icon: typeof Bell;
  label: string;
  /** 数字角标（0 不显示） */
  badge?: number;
}

const { t } = useI18n();
const pageStore = useWorkbenchPageStore();
const settingsStore = useSettingsStore();
const activityInbox = useActivityInboxStore();
const { page } = storeToRefs(pageStore);
const { leftCollapsed } = storeToRefs(useLayoutStore());
const { pendingCount } = storeToRefs(activityInbox);

const entries = computed<RailEntry[]>(() => [
  { page: "fleet", icon: Robot, label: t("shell.fleetBoard") },
  { page: "tasks", icon: Checklist, label: t("sidebar.zoneTasks") },
  { page: "skills", icon: Skills, label: t("sidebar.skills") },
  { page: "mcp", icon: McpConnector, label: "MCP" },
  { page: "features", icon: Blocks, label: t("features.entry") },
  { page: "inbox", icon: Bell, label: t("sidebar.activity"), badge: pendingCount.value },
]);

function isActive(target: WorkbenchPage) {
  return page.value === target;
}
</script>

<template>
  <nav
    class="flex flex-none flex-col items-center gap-0.5 px-2 py-2.5"
    :style="{ width: `${NAV_RAIL_W}px` }"
    :aria-label="t('sidebar.zoneTasks')"
    data-testid="app-rail"
  >
    <!-- 首图标与右侧会话面板顶行居中对齐：(44 − 32) / 2 = 6px -->
    <Button
      variant="ghost"
      size="icon"
      class="mt-1.5 flex-none"
      :class="
        isActive('chat')
          ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
          : 'text-[var(--color-mut)]'
      "
      :aria-label="t('sidebar.backToChat')"
      :title="t('sidebar.backToChat')"
      :aria-current="isActive('chat') ? 'page' : undefined"
      @click="pageStore.close()"
    >
      <Messages :size="18" aria-hidden="true" />
    </Button>

    <span class="my-1 h-px w-5 flex-none bg-[var(--color-line-soft)]" aria-hidden="true" />

    <div class="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden">
      <!-- 会话面板收起时：悬停「最近会话」浮出可点列表 -->
      <CollapsedSessionPeek v-if="leftCollapsed" />

      <Button
        v-for="entry in entries"
        :key="entry.page"
        variant="ghost"
        size="icon"
        class="relative flex-none"
        :class="
          isActive(entry.page)
            ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
            : 'text-[var(--color-mut)]'
        "
        :aria-label="entry.label"
        :title="entry.label"
        :aria-current="isActive(entry.page) ? 'page' : undefined"
        @click="pageStore.toggle(entry.page)"
      >
        <component :is="entry.icon" :size="18" aria-hidden="true" />
        <span
          v-if="entry.badge"
          class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--color-accent)]"
          aria-hidden="true"
        />
      </Button>

      <!-- 分类入口与第三方 Agent 之间：与顶部同款的 20px 细分隔线 -->
      <span
        data-testid="rail-divider"
        class="my-1 h-px w-5 flex-none bg-[var(--color-line-soft)]"
        aria-hidden="true"
      />

      <ExternalEndpointRail />
    </div>

    <span class="flex-none" aria-hidden="true" />

    <div data-testid="rail-account">
      <UserBlock compact />
    </div>
    <Button
      variant="ghost"
      size="icon"
      class="flex-none text-[var(--color-mut)]"
      :aria-label="t('sidebar.user.settings')"
      :title="t('sidebar.user.settings')"
      @click="settingsStore.openSettings('general')"
    >
      <Settings :size="18" aria-hidden="true" />
    </Button>
  </nav>
</template>
