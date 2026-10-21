<script setup lang="ts">
import { Bot, Bug, Check, FolderOpen, GitBranch, Globe, PanelRight, Plus, RefreshCw, SquareTerminal, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Component } from "vue";

import AgentsPanel from "@/components/right/AgentsPanel.vue";
import BrowserPanel from "@/components/right/BrowserPanel.vue";
import ErrorsPanel from "@/components/right/ErrorsPanel.vue";
import FilePanel from "@/components/right/FilePanel.vue";
import GitPanel from "@/components/right/GitPanel.vue";
import RightTerminalsPanel from "@/components/right/RightTerminalsPanel.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useBrowserStore } from "@/stores/browser";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useLayoutStore } from "@/stores/layout";
import { PANEL_TITLES, useRightPanelStore, type RightPanelKind } from "@/stores/right-panel";
import { cn } from "@/lib/utils";

const { t } = useI18n();
const layoutStore = useLayoutStore();
const rightPanel = useRightPanelStore();
const gitStore = useGitStore();
const browserStore = useBrowserStore();
const chatStore = useChatStore();
const { tabs, activeId, activeTab } = storeToRefs(rightPanel);

/**
 * 内嵌浏览器按工作区隔离：切工作区时把主进程的活动浏览器 scope 对齐到当前
 * 会话工作区。preload 的会话流量拦截覆盖常规切换，这里兜底校正 preload 看不到
 * 的路径（未持久化会话切工作区等）与面板重新展开时的初始值。
 */
watch(
  () => chatStore.sessionWorkspaceId,
  (id) => {
    window.zen?.browser?.setScope?.(id || "common");
  },
  { immediate: true },
);

/**
 * 面板分桶切换完成后（tabs 引用整体替换）修复 store.status 里残留的上一工作区
 * pip 标记：status 未分桶，陈旧 pip 会让 reconcileView / bounds 推送提前跳过，
 * 表现为切过来浏览器面板空白。仅在浏览器 tab 已打开且残留 pip 时刷新对齐。
 */
watch(
  tabs,
  () => {
    if (rightPanel.hasKind("browser") && (browserStore.status.pip || browserStore.status.pipHidden)) {
      void browserStore.syncStatus().then(() => browserStore.reconcileView());
    }
  },
);

/** 「打开面板」菜单展开态：菜单浮层 z 低于浏览器 WebContentsView，打开期间需压制原生视图 */
const panelMenuOpen = ref(false);
useBrowserOverlayGuard(panelMenuOpen);

/** 「打开面板」菜单：全部面板类型与图标（tab 标题由 PANEL_TITLES 统一供给） */
const PANEL_ITEMS: { kind: RightPanelKind; icon: Component }[] = [
  { kind: "files", icon: FolderOpen },
  { kind: "browser", icon: Globe },
  { kind: "git", icon: GitBranch },
  { kind: "agents", icon: Bot },
  { kind: "terminals", icon: SquareTerminal },
  { kind: "errors", icon: Bug },
];

function iconFor(kind: string) {
  return PANEL_ITEMS.find((item) => item.kind === kind)?.icon ?? RefreshCw;
}

function tabCls(id: string) {
  return cn(
    "flex h-7 max-w-[120px] flex-none items-center gap-1 rounded-[6px] px-2 text-left text-[12px]",
    id === activeId.value
      ? "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"
      : "text-[var(--color-mut)] hover:text-[var(--color-txt)]",
  );
}
</script>

<template>
  <aside
    class="flex h-full min-w-0 flex-col border-l border-[var(--color-line-soft)] bg-transparent"
    :aria-label="t('panels.panelAria')"
  >
    <!-- 头行：Tab 与折叠开关同级 -->
    <header
      class="flex h-[var(--titlebar-h)] flex-none items-center gap-1 px-2 select-none [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] [&_[role='tab']]:[-webkit-app-region:no-drag]"
    >
      <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :class="tabCls(tab.id)"
          role="tab"
          :aria-selected="tab.id === activeId"
          @click="rightPanel.activate(tab.id)"
        >
          <component
            :is="iconFor(tab.kind)"
            class="size-3.5 flex-none"
            :class="tab.kind === 'git' && gitStore.loading ? 'animate-spin' : ''"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{{ tab.title }}</span>
          <Button
            v-if="tabs.length > 1"
            variant="ghost"
            size="icon-xs"
            class="ml-0.5 size-4 flex-none rounded text-[var(--color-dim)] hover:text-[var(--color-txt)]"
            :aria-label="t('panels.closeTab')"
            @click.stop="rightPanel.closeTab(tab.id)"
          >
            <X class="size-3" />
          </Button>
        </div>
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <!-- 打开面板：单一入口，替代与 tab 重复的常驻开关（已打开的带勾，点击即切到） -->
        <DropdownMenu @update:open="(open: boolean) => (panelMenuOpen = open)">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="t('panels.openPanel')"
              :title="t('panels.openPanel')"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-[160px]">
            <DropdownMenuItem
              v-for="item in PANEL_ITEMS"
              :key="item.kind"
              class="gap-2"
              @select="rightPanel.ensureTab(item.kind)"
            >
              <component :is="item.icon" class="size-4 text-[var(--color-mut)]" aria-hidden="true" />
              <span class="flex-1">{{ PANEL_TITLES[item.kind] }}</span>
              <Check
                v-if="rightPanel.hasKind(item.kind)"
                class="size-3.5 text-[var(--color-accent)]"
                aria-hidden="true"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-xs"
          class="bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"
          :aria-label="t('panels.collapsePanel')"
          :title="t('panels.collapsePanel')"
          @click="layoutStore.toggleRight()"
        >
          <PanelRight />
        </Button>
      </div>
      <!-- Windows/Linux 原生叠加三键的右上角留位（--titlebar-trail，macOS 为 0） -->
      <span class="h-full w-[var(--titlebar-trail)] flex-none" aria-hidden="true" />
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
      <FilePanel v-if="activeTab?.kind === 'files'" />
      <BrowserPanel v-else-if="activeTab?.kind === 'browser'" />
      <GitPanel v-else-if="activeTab?.kind === 'git'" />
      <AgentsPanel v-else-if="activeTab?.kind === 'agents'" />
      <RightTerminalsPanel v-else-if="activeTab?.kind === 'terminals'" />
      <ErrorsPanel v-else-if="activeTab?.kind === 'errors'" />
    </div>
  </aside>
</template>
