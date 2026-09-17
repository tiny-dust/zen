<script setup lang="ts">
import GraphPanel from "@/components/right/GitGraph.vue";
import { FolderOpen, GitGraph, Globe, PanelRight, RefreshCw, X } from "@lucide/vue";
import { storeToRefs } from "pinia";

import BrowserPanel from "@/components/right/BrowserPanel.vue";
import ChangesPanel from "@/components/right/ChangesPanel.vue";
import FilePanel from "@/components/right/FilePanel.vue";
import { Button } from "@/components/ui/button";
import { useGitStore } from "@/stores/git";
import { useLayoutStore } from "@/stores/layout";
import { useRightPanelStore } from "@/stores/right-panel";
import { cn } from "@/lib/utils";

const layoutStore = useLayoutStore();
const rightPanel = useRightPanelStore();
const gitStore = useGitStore();
const { tabs, activeId, activeTab } = storeToRefs(rightPanel);

function iconFor(kind: string) {
  if (kind === "files") {
    return FolderOpen;
  }
  if (kind === "browser") {
    return Globe;
  }
  if (kind === "graph") {
    return GitGraph;
  }
  return RefreshCw;
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
    aria-label="工具面板"
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
          <button
            v-if="tabs.length > 1"
            type="button"
            class="ml-0.5 flex size-4 flex-none items-center justify-center rounded text-[var(--color-dim)] hover:text-[var(--color-txt)]"
            aria-label="关闭标签"
            @click.stop="rightPanel.closeTab(tab.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="rightPanel.hasKind('files')"
          :aria-label="rightPanel.hasKind('files') ? '文件面板已打开' : '打开文件面板'"
          title="文件"
          @click="rightPanel.ensureTab('files')"
        >
          <FolderOpen />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="rightPanel.hasKind('browser')"
          :aria-label="rightPanel.hasKind('browser') ? '浏览器面板已打开' : '打开浏览器面板'"
          title="浏览器"
          @click="rightPanel.ensureTab('browser')"
        >
          <Globe />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="rightPanel.hasKind('changes')"
          :aria-label="rightPanel.hasKind('changes') ? '变更面板已打开' : '打开变更面板'"
          title="变更"
          @click="rightPanel.ensureTab('changes')"
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="rightPanel.hasKind('graph')"
          :aria-label="rightPanel.hasKind('graph') ? '图谱面板已打开' : '打开图谱面板'"
          title="图谱"
          @click="rightPanel.ensureTab('graph')"
        >
          <GitGraph />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"
          aria-label="收起面板"
          title="收起面板"
          @click="layoutStore.toggleRight()"
        >
          <PanelRight />
        </Button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
      <FilePanel v-if="activeTab?.kind === 'files'" />
      <BrowserPanel v-else-if="activeTab?.kind === 'browser'" />
      <ChangesPanel v-else-if="activeTab?.kind === 'changes'" />
      <GraphPanel v-else-if="activeTab?.kind === 'graph'" />
    </div>
  </aside>
</template>
