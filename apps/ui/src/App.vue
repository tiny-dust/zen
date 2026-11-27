<script setup lang="ts">
import { storeToRefs } from "pinia";
import { classes } from "rattail";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { PetActivity } from "@zen/shared";

import ChatBackground from "@/components/chat/ChatBackground.vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatTimeline from "@/components/chat/ChatTimeline.vue";
import WorkbenchPages from "@/components/layout/WorkbenchPages.vue";
import TerminalPanel from "@/components/bottom/TerminalPanel.vue";
import InfoPopup from "@/components/layout/InfoPopup.vue";
import RightPanel from "@/components/right/RightPanel.vue";
import SessionInfoPanel from "@/components/session/SessionInfoPanel.vue";
import AppRail from "@/components/sidebar/AppRail.vue";
import AppSidebar from "@/components/sidebar/AppSidebar.vue";
import AppTitlebar from "@/components/topbar/AppTitlebar.vue";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/toast";
import { useBrowserOverlayAutoGuard } from "@/composables/useBrowserOverlayAutoGuard";
import { useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { openSessionById } from "@/lib/open-session";
import { buildPetActivity } from "@/lib/pet-activity";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { NAV_RAIL_W, WIDE_BREAKPOINT, useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSchedulerStore } from "@/stores/scheduler";
import { useSessionStatusStore } from "@/stores/session-status";
import { useSessionWorktreeStore } from "@/stores/session-worktree";
import { useSettingsStore } from "@/stores/settings";
import { useTerminalStore } from "@/stores/terminal";
import { useUserStore } from "@/stores/user";
import { useWorkbenchPageStore } from "@/stores/workbench-page";
import { useWorkspaceStore } from "@/stores/workspace";

const rightPanelStore = useRightPanelStore();
const chatStore = useChatStore();
const gitStore = useGitStore();
const schedulerStore = useSchedulerStore();
const sessionStatusStore = useSessionStatusStore();
const workspaceStore = useWorkspaceStore();
const worktreeStore = useSessionWorktreeStore();
const terminalStore = useTerminalStore();
const pageStore = useWorkbenchPageStore();

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
const {
  panelWidth, leftCollapsed, panelMin, panelMax,
  rightWidth, rightCollapsed, rightBounds,
  bottomHeight, bottomCollapsed, bottomBounds,
  sessionOpen,
} = storeToRefs(layoutStore);

// 与 layout store 的预算判断共用同一个断点：两边各写一个数时，信息列会吃掉聊天区
const isWide = useMediaQuery(`(min-width: ${WIDE_BREAKPOINT}px)`);
/** 整页（任务/看板/技能…）打开时，右栏、信息列与终端让位给整页 */
const chatMode = computed(() => pageStore.isChat);
const showSessionColumn = computed(() => chatMode.value && isWide.value && sessionOpen.value);

/**
 * 空会话：没有任何消息、没有待审批/提问时，让「欢迎区 + 输入框」整体居中。
 * 发送后消息立即出现，自然回到「滚动区 + 底部输入框」，不依赖运行状态判断。
 */
const chatEmpty = computed(
  () => chatStore.messages.length === 0 && !chatStore.pendingApproval && !chatStore.pendingAsk,
);

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
      pageStore.close();
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
    return buildPetActivity(statuses, titles, sessionStatusStore.hasUnseenResult);
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
  // 终端默认收起：面板挂在 DOM 上，用折叠尺寸而不是 v-if，避免重建 PTY 视图
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

type PanelApi = {
  collapse: () => void;
  expand: () => void;
  resize: (size: number) => void;
};

const leftPanel = ref<PanelApi | null>(null);
const rightPanel = ref<PanelApi | null>(null);
const bottomPanel = ref<PanelApi | null>(null);

/**
 * store → 面板回写的尺寸会被 reka 立刻以旧值回声一次（px 与 % 换算后取整），
 * 回声再写回 store 就把宽度钉回原值——左栏「拖不动」就是这个自反馈。
 * 记住刚推下去的尺寸，回声直接丢弃。
 */
let pushedLeft = -1;
let pushedRight = -1;
let pushedBottom = -1;

/** 会话面板以 px 上报自身宽度：store 里存的是「轨道 + 面板」总宽 */
function onLeftResize(size: number) {
  const rounded = Math.round(size);
  if (rounded === pushedLeft) return;
  if (!leftCollapsed.value) layoutStore.setLeftWidth(rounded + NAV_RAIL_W);
}

function onRightResize(size: number) {
  const rounded = Math.round(size);
  if (rounded === pushedRight) return;
  if (!rightCollapsed.value) layoutStore.setRightWidth(rounded);
}

function onBottomResize(size: number) {
  const rounded = Math.round(size);
  if (rounded === pushedBottom) return;
  if (!bottomCollapsed.value) layoutStore.setBottomHeight(rounded);
}

/** store 侧变化（展开还原、窗口缩放回收）反向驱动面板，避免两套真源 */
function syncPanel(panel: PanelApi | null, size: number, collapsed: boolean) {
  if (!panel) return;
  if (collapsed) {
    panel.collapse();
    return;
  }
  panel.expand();
  panel.resize(size);
}

function syncLeftPanel(size: number, collapsed: boolean) {
  if (!collapsed) pushedLeft = Math.round(size);
  syncPanel(leftPanel.value, size, collapsed);
}

function syncRightPanel(size: number, collapsed: boolean) {
  if (!collapsed) pushedRight = Math.round(size);
  syncPanel(rightPanel.value, size, collapsed);
}

function syncBottomPanel(size: number, collapsed: boolean) {
  if (!collapsed) pushedBottom = Math.round(size);
  syncPanel(bottomPanel.value, size, collapsed);
}

watch(() => [panelWidth.value, leftCollapsed.value] as const, ([size, collapsed]) => {
  syncLeftPanel(size, collapsed);
}, { flush: "post" });

watch(() => [rightWidth.value, rightCollapsed.value] as const, ([size, collapsed]) => {
  syncRightPanel(size, collapsed);
}, { flush: "post" });

watch(() => [bottomHeight.value, bottomCollapsed.value] as const, ([size, collapsed]) => {
  syncBottomPanel(size, collapsed);
}, { flush: "post" });

</script>

<template>
  <!-- 窗口级结构（对齐 nomi）：外层底色 + 顶栏三段；下方左侧常驻轨道 + 一块左上圆角的工作区 -->
  <div class="relative flex h-full flex-col bg-[var(--color-side)] text-[var(--color-txt)]">
    <AppTitlebar :is-wide="isWide" />

    <div class="flex min-h-0 flex-1">
      <!-- 52px 分类轨道：账户与设置固定在底部，面板收起后依然可达 -->
      <AppRail />

      <!-- 工作区：会话面板 + 中央区 + 右栏共用同一块左上圆角面（背景与外层区分） -->
      <div
        class="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-[var(--radius-shell)] bg-[var(--color-panel)] shadow-[var(--shadow-edge-top)]"
      >
        <ResizablePanelGroup direction="horizontal" class="min-h-0 flex-1">
          <ResizablePanel
            v-if="!leftCollapsed"
            ref="leftPanel"
            size-unit="px"
            collapsible
            :collapsed-size="0"
            :min-size="panelMin"
            :max-size="panelMax"
            :default-size="panelWidth"
            :order="1"
            @resize="onLeftResize"
          >
            <div class="h-full min-w-0 overflow-hidden">
              <AppSidebar />
            </div>
          </ResizablePanel>

          <ResizableHandle v-if="!leftCollapsed" />

          <ResizablePanel :order="2">
            <div class="relative flex h-full min-h-0 min-w-0 flex-col">
              <!-- 整页模式：分类页面占满工作区 -->
              <WorkbenchPages v-if="!chatMode" />
              <!--
                对话子树始终挂载，整页模式下只做视觉隐藏（绝对定位 + invisible）：
                输入框里的未提交文字、正在流式输出的消息不会因为切页丢失，
                同时避免 display:none 让分栏尺寸被重新测量成 0。
              -->
              <ResizablePanelGroup
                direction="vertical"
                :class="chatMode ? 'min-h-0 flex-1' : 'pointer-events-none invisible absolute inset-0'"
              >
                  <ResizablePanel :order="1">
                    <div :class="centerClass">
                      <div
                        class="relative flex h-full min-h-0 min-w-0 flex-col"
                        :class="chatEmpty ? 'justify-center' : ''"
                      >
                        <ChatBackground />
                        <ChatTimeline :empty="chatEmpty" />
                        <ChatComposer @open-workflow="rightPanelStore.ensureTab('workflow')" />
                      </div>
                      <SessionInfoPanel v-if="showSessionColumn" />
                    </div>
                  </ResizablePanel>

                  <ResizableHandle v-if="!bottomCollapsed" />

                  <ResizablePanel
                    ref="bottomPanel"
                    size-unit="px"
                    collapsible
                    :collapsed-size="0"
                    :min-size="bottomCollapsed ? 0 : bottomBounds.min"
                    :max-size="bottomBounds.max"
                    :default-size="bottomCollapsed ? 0 : bottomHeight"
                    :order="2"
                    @resize="onBottomResize"
                  >
                    <div
                      v-if="!bottomCollapsed"
                      class="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg)] shadow-[var(--shadow-edge-top)]"
                    >
                      <TerminalPanel />
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
            </div>
          </ResizablePanel>

          <template v-if="chatMode">
            <ResizableHandle v-if="!rightCollapsed" />

            <ResizablePanel
              v-if="!rightCollapsed"
              ref="rightPanel"
              size-unit="px"
              collapsible
              :collapsed-size="0"
              :min-size="rightBounds.min"
              :max-size="rightBounds.max"
              :default-size="rightWidth"
              :order="3"
              @resize="onRightResize"
            >
              <div class="h-full min-w-0 overflow-hidden">
                <RightPanel />
              </div>
            </ResizablePanel>
          </template>
        </ResizablePanelGroup>
      </div>
    </div>

    <InfoPopup />
    <Toaster />
  </div>
</template>
