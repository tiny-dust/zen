<script setup lang="ts">
import GraphPanel from "@/components/right/GitGraph.vue";
import { Bot, Check, FolderOpen, GitGraph, Globe, PanelRight, Plus, RefreshCw, SquareTerminal, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import type { Component } from "vue";

import AgentsPanel from "@/components/right/AgentsPanel.vue";
import BrowserPanel from "@/components/right/BrowserPanel.vue";
import ChangesPanel from "@/components/right/ChangesPanel.vue";
import FilePanel from "@/components/right/FilePanel.vue";
import RightTerminalsPanel from "@/components/right/RightTerminalsPanel.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGitStore } from "@/stores/git";
import { useLayoutStore } from "@/stores/layout";
import { PANEL_TITLES, useRightPanelStore, type RightPanelKind } from "@/stores/right-panel";
import { cn } from "@/lib/utils";

const { t } = useI18n();
const layoutStore = useLayoutStore();
const rightPanel = useRightPanelStore();
const gitStore = useGitStore();
const { tabs, activeId, activeTab } = storeToRefs(rightPanel);

/** 「打开面板」菜单：全部面板类型与图标（tab 标题由 PANEL_TITLES 统一供给） */
const PANEL_ITEMS: { kind: RightPanelKind; icon: Component }[] = [
  { kind: "files", icon: FolderOpen },
  { kind: "browser", icon: Globe },
  { kind: "changes", icon: RefreshCw },
  { kind: "graph", icon: GitGraph },
  { kind: "agents", icon: Bot },
  { kind: "terminals", icon: SquareTerminal },
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
            :class="tab.kind === 'changes' && gitStore.loading ? 'animate-spin' : ''"
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
        <DropdownMenu>
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
      <!-- Windows/Linux 窗口三键右上角占位（--titlebar-trail，macOS 为 0）。
           no-drag + h-full：把三键区从头行 drag 矩形中挖掉（必须撑满高度，
           零高的 span 挖不出洞），避免后登记的 drag 盖住三键点击区。 -->
      <span class="h-full w-[var(--titlebar-trail)] flex-none [-webkit-app-region:no-drag]" aria-hidden="true" />
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
      <FilePanel v-if="activeTab?.kind === 'files'" />
      <BrowserPanel v-else-if="activeTab?.kind === 'browser'" />
      <ChangesPanel v-else-if="activeTab?.kind === 'changes'" />
      <GraphPanel v-else-if="activeTab?.kind === 'graph'" />
      <AgentsPanel v-else-if="activeTab?.kind === 'agents'" />
      <RightTerminalsPanel v-else-if="activeTab?.kind === 'terminals'" />
    </div>
  </aside>
</template>
