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
import { Toaster } from "@/components/ui/toast";
import { useBrowserOverlayAutoGuard } from "@/composables/useBrowserOverlayAutoGuard";
import { useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { openSessionById } from "@/lib/open-session";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";
import { useTerminalStore } from "@/stores/terminal";
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
    [showSessionColumn.value, "grid-cols-[minmax(0,1fr)_350px]"],
  ),
);

let disposeChat: (() => void) | undefined;
let disposeUser: (() => void) | undefined;
let disposeSettings: (() => void) | undefined;
let disposeModels: (() => void) | undefined;
let disposeAgent: (() => void) | undefined;

// 全局弹层 → 压制内嵌浏览器原生视图：WebContentsView 层级高于一切 HTML，
// 只在部分弹层组件上挂守卫会漏（居中弹窗不与面板相交时视图会压住弹窗遮罩）
useBrowserOverlayAutoGuard();

useGlobalShortcuts({
  shortcuts: () => settingsStore.settings.shortcuts,
  onCommand: (command) => {
    void runWorkbenchCommand(command);
  },
});

/** 快捷键命令统一分发：应用内键监听与系统全局快捷键（主进程拉起窗口后回推）共用 */
async function runWorkbenchCommand(command: string): Promise<void> {
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
    case "workbench.action.toggleInfoPanel":
      layoutStore.toggleSession();
      break;
    case "workbench.action.toggleRightPanel":
      layoutStore.toggleRight();
      break;
    case "workbench.action.terminal.toggleTerminal": {
      const opening = layoutStore.bottomCollapsed;
      layoutStore.toggleBottom();
      if (opening) {
        void useTerminalStore().ensureForWorkspace();
      }
      break;
    }
  }
}

/** CLI open 请求落点：按 id 刷新侧栏数据并切到目标会话（找不到则忽略） */
async function openSessionFromCli(sessionId: string): Promise<void> {
  await openSessionById(sessionId);
}

onMounted(() => {
  disposeChat = chatStore.bootstrap();
  disposeUser = userStore.bootstrap();
  disposeSettings = settingsStore.bootstrap();
  disposeModels = modelsStore.bootstrap();
  disposeAgent = useAgentStore().bootstrap();
  // 系统全局快捷键：主进程拉起窗口后回推命令，与应用内键监听共用同一分发
  window.zen?.settings.onGlobalCommand((command) => {
    void runWorkbenchCommand(command);
  });
  // CLI `zen-cli open <sessionId>`：主进程已聚焦窗口并广播请求，这里切到目标会话
  window.zen?.session.onOpenRequest((sessionId) => {
    void openSessionFromCli(sessionId);
  });
  // 启动无条件落在对话页：清掉 hash 残留的设置入口，避免设置遮罩盖住主对话
  settingsStore.closeSettings();
  if (window.location.hash.startsWith("#settings")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  void userStore.waitForReady().then(() => useWorkspaceStore().refresh());
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
    <Toaster />
  </div>
</template>
