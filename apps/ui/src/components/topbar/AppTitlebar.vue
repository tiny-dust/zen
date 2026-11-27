<script setup lang="ts">
import {
  IconInfoCircle as Info,
  IconLayoutSidebarRightExpand as PanelRight,
  IconPlus as Plus,
  IconTerminal2 as SquareTerminal,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import OpenWithButton from "@/components/topbar/OpenWithButton.vue";
import RightPanelTabs from "@/components/topbar/RightPanelTabs.vue";
import SessionSwitcher from "@/components/topbar/SessionSwitcher.vue";
import TitlebarLeftControls from "@/components/topbar/TitlebarLeftControls.vue";
import TranscriptViewMenu from "@/components/topbar/TranscriptViewMenu.vue";
import WindowControls from "@/components/topbar/WindowControls.vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { NAV_RAIL_W, useLayoutStore } from "@/stores/layout";
import { useTerminalStore } from "@/stores/terminal";
import { useWorkbenchPageStore } from "@/stores/workbench-page";

defineProps<{
  isWide: boolean;
}>();

const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const pageStore = useWorkbenchPageStore();
const { t } = useI18n();
const { rightCollapsed, bottomCollapsed, leftCollapsed, panelWidth, rightWidth } = storeToRefs(layoutStore);
const { page } = storeToRefs(pageStore);

/** 整页模式下中段显示页面名，会话操作与右栏标签一并收起（对齐 nomi 的任务/看板页） */
const pageTitle = computed(() => {
  switch (page.value) {
    case "fleet":
      return t("shell.fleetTitle");
    case "scheduler":
      return t("scheduler.entry");
    case "skills":
      return t("sidebar.skills");
    case "mcp":
      return "MCP";
    case "features":
      return t("features.entry");
    case "inbox":
      return t("sidebar.activity");
    case "settings":
      return t("settings.nav.title");
    case "tasks":
      return t("sidebar.zoneTasks");
    default:
      return "";
  }
});

const chatMode = computed(() => page.value === "chat");

/**
 * 三段宽度直接跟下方分栏同源：
 * 左段 = 52px 轨道 + 会话面板，右段 = 右栏宽度，中段吃掉剩余空间。
 * 这样会话名压在内容区左上、右栏标签压在右栏左上，和下面的分栏对齐。
 */
const leftZoneWidth = computed(() =>
  leftCollapsed.value ? NAV_RAIL_W : NAV_RAIL_W + panelWidth.value,
);
const rightZoneWidth = computed(() =>
  chatMode.value && !rightCollapsed.value ? rightWidth.value : 0,
);

/** 中段左侧内缩：展开态 8px；收起态要让过交通灯（lead − 轨道宽），且不为负 */
const centerPadLeft = computed(() =>
  leftCollapsed.value
    ? `max(8px, calc(var(--titlebar-lead) - ${NAV_RAIL_W}px + 8px))`
    : "8px",
);

function toggleBottomPanel() {
  const opening = bottomCollapsed.value;
  layoutStore.toggleBottom();
  if (opening) {
    void terminalStore.ensureForWorkspace();
  }
}

function iconBtnClass(active = false) {
  return cn(
    "text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]",
    active && "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]",
  );
}
</script>

<template>
  <!-- 顶栏横跨整窗，按「左：系统信息 ｜ 中：会话与操作 ｜ 右：右栏标签」三段排布 -->
  <header
    class="flex h-[var(--titlebar-h)] flex-none items-center gap-0 px-0 select-none [-webkit-app-region:drag] [&_[data-slot=button]]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag] [&_[role=tab]]:[-webkit-app-region:no-drag]"
  >
    <!-- 左段：宽度 = 轨道 + 会话面板，与下方分栏同一边界 -->
    <div
      class="flex min-w-0 flex-none items-center gap-1 overflow-hidden"
      :style="{ width: `${leftZoneWidth}px` }"
      data-zone="left"
    >
      <!-- 交通灯预留只在展开态：收起时这一段只有 52px，控件改到中段开头 -->
      <template v-if="!leftCollapsed">
        <span class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
        <TitlebarLeftControls />
      </template>
      <span v-else class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
    </div>

    <!-- 中段：左贴内容区左边界（页面名 / 会话名），右贴内容区右边界（会话操作组）；整页模式右侧留空 -->
    <div
      class="flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden"
      :style="{ paddingLeft: centerPadLeft }"
      data-zone="center"
    >
      <div class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-zone="center-left">
        <!-- 面板收起时接管左段控件，并让出交通灯宽度 -->
        <TitlebarLeftControls v-if="leftCollapsed" />
        <SessionSwitcher v-if="chatMode" />
        <span v-else class="min-w-0 truncate px-1 text-[13px] font-medium text-[var(--color-txt)]">
          {{ pageTitle }}
        </span>
      </div>

      <div v-if="chatMode" class="flex flex-none items-center gap-1" data-zone="center-actions">
        <Button variant="ghost" size="icon-sm" :class="iconBtnClass()" :aria-label="t('shell.newChat')" :title="t('shell.newChat')" @click="chatStore.newTask()">
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="iconBtnClass()"
          :aria-label="t('shell.sessionInfo')"
          :title="t('shell.sessionInfo')"
          @click="isWide ? layoutStore.toggleSession() : layoutStore.toggleInfo()"
        >
          <Info />
        </Button>
        <OpenWithButton />
        <Button
          variant="ghost"
          size="icon-sm"
          :class="iconBtnClass(!bottomCollapsed)"
          :aria-label="t('shell.terminal')"
          :title="t('shell.terminal')"
          @click="toggleBottomPanel"
        >
          <SquareTerminal />
        </Button>
        <TranscriptViewMenu />
        <Button
          v-if="rightCollapsed"
          variant="ghost"
          size="icon-sm"
          :class="iconBtnClass()"
          :aria-label="t('shell.rightPanel')"
          :title="t('shell.rightPanel')"
          @click="layoutStore.toggleRight()"
        >
          <PanelRight />
        </Button>
      </div>
    </div>

    <!-- 右段：宽度 = 右栏；标签在段内滚动，右端给原生窗口按钮留位 -->
    <div
      v-if="rightZoneWidth > 0"
      class="flex min-w-0 flex-none items-center gap-1 overflow-hidden"
      :style="{ width: `${rightZoneWidth}px` }"
      data-zone="right"
    >
      <RightPanelTabs class="min-w-0 flex-1" />
      <span class="ml-auto h-full w-[var(--titlebar-trail)] flex-none" aria-hidden="true" />
    </div>
    <!-- 右栏收起/整页模式：只留原生窗口按钮的占位，避免功能区压到按钮下 -->
    <span v-else class="h-full w-[var(--titlebar-trail)] flex-none" aria-hidden="true" />
  </header>

  <WindowControls />
</template>
