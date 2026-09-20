<script setup lang="ts">
import { storeToRefs } from "pinia";
import { classes } from "rattail";
import { computed, onMounted, onUnmounted } from "vue";

import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatTimeline from "@/components/chat/ChatTimeline.vue";
import TerminalPanel from "@/components/bottom/TerminalPanel.vue";
import InfoPopup from "@/components/layout/InfoPopup.vue";
import ResizeHandle from "@/components/layout/ResizeHandle.vue";
import RightPanel from "@/components/right/RightPanel.vue";
import SettingsPage from "@/components/settings/SettingsPage.vue";
import SessionInfoPanel from "@/components/session/SessionInfoPanel.vue";
import AppSidebar from "@/components/sidebar/AppSidebar.vue";
import AppTitlebar from "@/components/topbar/AppTitlebar.vue";
import { useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";

const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const userStore = useUserStore();
const settingsStore = useSettingsStore();
const modelsStore = useModelsStore();
const { leftWidth, leftCollapsed, rightWidth, rightCollapsed, bottomCollapsed, sessionOpen } =
  storeToRefs(layoutStore);

const isWide = useMediaQuery("(min-width: 1100px)");
const showSessionColumn = computed(() => isWide.value && sessionOpen.value);

const centerClass = computed(() =>
  classes(
    "flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)]",
    [showSessionColumn.value, "grid-cols-[minmax(0,1fr)_250px]"],
  ),
);

let disposeChat: (() => void) | undefined;
let disposeUser: (() => void) | undefined;
let disposeSettings: (() => void) | undefined;
let disposeModels: (() => void) | undefined;
let disposeAgent: (() => void) | undefined;

useGlobalShortcuts({
  shortcuts: () => settingsStore.settings.shortcuts,
  onCommand: (command) => {
    switch (command) {
      case "zen.chat.send":
        void chatStore.send();
        break;
      case "zen.action.newTask":
        chatStore.newTask();
        break;
      case "workbench.action.openSettings":
        settingsStore.openSettings();
        break;
      case "workbench.action.toggleSidebarVisibility":
        layoutStore.toggleLeft();
        break;
      case "workbench.action.terminal.toggleTerminal":
        layoutStore.toggleBottom();
        break;
    }
  },
});

onMounted(() => {
  disposeChat = chatStore.bootstrap();
  disposeUser = userStore.bootstrap();
  disposeSettings = settingsStore.bootstrap();
  disposeModels = modelsStore.bootstrap();
  disposeAgent = useAgentStore().bootstrap();
  void useWorkspaceStore().refresh();
  // 窗口缩放后按新边界回收两侧面板宽度，防止中央聊天区被挤出视口
  layoutStore.syncViewport();
  window.addEventListener("resize", layoutStore.syncViewport);
});

onUnmounted(() => {
  window.removeEventListener("resize", layoutStore.syncViewport);
  disposeChat?.();
  disposeUser?.();
  disposeSettings?.();
  disposeModels?.();
  disposeAgent?.();
});

function onLeftDrag(delta: number) {
  layoutStore.setLeftWidth(leftWidth.value + delta);
}

function onRightDrag(delta: number) {
  // 手柄在中央与右栏之间：左拖（delta 负）让右栏变宽
  layoutStore.setRightWidth(rightWidth.value - delta);
}

const sideRail =
  "flex-none h-full min-w-0 overflow-hidden";
</script>

<template>
  <div class="flex h-full flex-col bg-[var(--color-bg)] text-[var(--color-txt)]">
    <div class="flex min-h-0 flex-1">
      <div v-if="!leftCollapsed" :class="sideRail" :style="{ width: `${leftWidth}px` }">
        <AppSidebar />
      </div>

      <ResizeHandle orientation="vertical" @drag="onLeftDrag" />

      <div class="h-full min-h-0 min-w-0 flex-1">
        <div class="flex h-full min-h-0 flex-col">
          <AppTitlebar :is-wide="isWide" />

          <div :class="centerClass">
            <div class="flex h-full min-h-0 min-w-0 flex-col">
              <ChatTimeline />
              <ChatComposer />
            </div>
            <SessionInfoPanel v-if="showSessionColumn" />
          </div>

          <div
            v-if="!bottomCollapsed"
            class="flex h-[min(42vh,360px)] min-h-[180px] flex-none flex-col bg-[var(--color-bg)] shadow-[var(--shadow-edge-top)]"
          >
            <TerminalPanel />
          </div>
        </div>
      </div>

      <template v-if="!rightCollapsed">
        <ResizeHandle orientation="vertical" @drag="onRightDrag" />
        <div :class="sideRail" :style="{ width: `${rightWidth}px` }">
          <RightPanel />
        </div>
      </template>
    </div>

    <InfoPopup />
    <SettingsPage />
  </div>
</template>
