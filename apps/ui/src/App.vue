<script setup lang="ts">
import { storeToRefs } from "pinia";
import { classes } from "rattail";
import { computed, onMounted, onUnmounted, watch } from "vue";

import type { PetActivity } from "@zen/shared";

import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatTimeline from "@/components/chat/ChatTimeline.vue";
import ActivityInboxDialog from "@/components/sidebar/ActivityInboxDialog.vue";
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
import { useGitStore } from "@/stores/git";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useSchedulerStore } from "@/stores/scheduler";
import { useSessionStatusStore } from "@/stores/session-status";
import { useSessionWorktreeStore } from "@/stores/session-worktree";
import { useSettingsStore } from "@/stores/settings";
import { useTerminalStore } from "@/stores/terminal";
import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";

const chatStore = useChatStore();
const gitStore = useGitStore();
const schedulerStore = useSchedulerStore();
const sessionStatusStore = useSessionStatusStore();
const workspaceStore = useWorkspaceStore();
const worktreeStore = useSessionWorktreeStore();
const terminalStore = useTerminalStore();

watch(
  () => chatStore.sessionId,
  async (id) => {
    if (!id) return;
    try {
      await worktreeStore.load(id);
      if (chatStore.sessionId === id) {
        terminalStore.bindWorkspaceScope(chatStore.sessionWorkspaceId);
        await gitStore.refreshStatus();
      }
    } catch (error) {
      console.error("[worktree] Failed to load session worktree:", error);
    }
  },
  { immediate: true },
);
const layoutStore = useLayoutStore();
const userStore = useUserStore();
const settingsStore = useSettingsStore();
const modelsStore = useModelsStore();
const { leftWidth, leftCollapsed, rightWidth, rightCollapsed, bottomHeight, bottomCollapsed, sessionOpen } =
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
let disposePetStatus: (() => void) | undefined;

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
        void terminalStore.ensureForWorkspace();
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
  disposePetStatus = watch((): PetActivity => {
    const statuses = sessionStatusStore.snapshot;
    const titles = new Map(
      workspaceStore.groups.flatMap((group) => group.sessions.map((session) => [session.id, session.title] as const)),
    );
    const entries = Object.entries(statuses).flatMap(([id, value]) => {
      const sessionStatus: PetActivity["sessions"][number]["status"] | null =
        value === "running" || value === "needs_action" ? value
        : (value === "error" || value === "done") && sessionStatusStore.hasUnseenResult(id) ? value
        : null;
      if (!sessionStatus) return [];
      const name = (titles.get(id) ?? "")
        .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ")
        .trim().slice(0, 80).trim() || "会话";
      return [{ id, name, status: sessionStatus }];
    });
    const status = entries.some((session) => session.status === "needs_action") ? "waiting"
      : entries.some((session) => session.status === "error") ? "error"
      : entries.some((session) => session.status === "done") ? "done"
      : entries.some((session) => session.status === "running") ? "working"
      : "idle";
    const priority: Record<PetActivity["sessions"][number]["status"], number> = {
      needs_action: 0, error: 1, done: 2, running: 3,
    };
    const sessions = entries.sort((a, b) => priority[a.status] - priority[b.status]).slice(0, 20);
    return { status, sessions };
  }, (activity) => {
    void window.zen?.pet.setStatus(activity).catch(() => undefined);
  }, { immediate: true });
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
  void userStore.waitForReady().then(() => workspaceStore.refresh());
  void schedulerStore.load();
  // 窗口缩放后按新边界回收面板尺寸，防止中央聊天区被挤出视口
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
  disposePetStatus?.();
  schedulerStore.dispose();
});

function onLeftDrag(delta: number) {
  layoutStore.setLeftWidth(leftWidth.value + delta);
}

function onRightDrag(delta: number) {
  // 手柄在中央与右栏之间：左拖（delta 负）让右栏变宽
  layoutStore.setRightWidth(rightWidth.value - delta);
}

function onBottomDrag(delta: number) {
  // 水平手柄每次只发本次位移；向上拖（负位移）增加底部高度。
  layoutStore.setBottomHeight(bottomHeight.value - delta);
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
            class="flex flex-none flex-col bg-[var(--color-bg)] shadow-[var(--shadow-edge-top)]"
            :style="{ height: `${bottomHeight}px` }"
          >
            <ResizeHandle orientation="horizontal" @drag="onBottomDrag" />
            <div class="min-h-0 flex-1">
              <TerminalPanel />
            </div>
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
    <ActivityInboxDialog />
    <SettingsPage />
    <Toaster />
  </div>
</template>
