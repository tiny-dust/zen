<script setup lang="ts">
import { FolderOpen, GitBranch, Globe, PanelRight, SquareTerminal } from "@lucide/vue";
import { classes } from "rattail";
import { computed, ref } from "vue";

import FileTree from "@/components/right/FileTree.vue";
import FileViewer from "@/components/right/FileViewer.vue";
import GitPanel from "@/components/right/GitPanel.vue";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useWorkspaceStore } from "@/stores/workspace";

type PluginId = "code" | "git" | "browser";

const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();

const plugins: Array<{ id: PluginId; label: string; icon: typeof FolderOpen }> = [
  { id: "code", label: "文件", icon: FolderOpen },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "browser", label: "浏览器", icon: Globe },
];

const active = ref<PluginId>("code");
const selectedFile = ref("");

/** 当前会话绑定的工作区目录；公共区为空 */
const treeRoot = computed(() =>
  workspaceStore.pathOf(chatStore.sessionWorkspaceId),
);

const navCls =
  "flex h-10 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left text-[13.5px] text-[var(--color-side-item)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]";

function navItemCls(id: PluginId | "terminal") {
  const isActive = id === "terminal" ? !layoutStore.bottomCollapsed : active.value === id;
  return classes(
    navCls,
    [isActive, "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"],
  );
}
</script>

<template>
  <aside
    class="flex h-full min-w-0 flex-col border-l border-[var(--color-line-soft)] bg-transparent"
    aria-label="工具面板"
  >
    <!-- 头行：窗口 chrome；面板开关自带选中底色（面板展开中） -->
    <header
      class="flex h-[var(--titlebar-h)] flex-none items-center justify-end gap-0.5 px-2 select-none [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]"
    >
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
    </header>

    <nav class="flex flex-col gap-0.5 px-2 pt-1" aria-label="工具导航">
      <button
        v-for="plugin in plugins"
        :key="plugin.id"
        type="button"
        :class="navItemCls(plugin.id)"
        :aria-pressed="active === plugin.id"
        @click="active = plugin.id"
      >
        <component :is="plugin.icon" class="size-4 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span>{{ plugin.label }}</span>
      </button>
      <button
        type="button"
        :class="navItemCls('terminal')"
        :aria-pressed="!layoutStore.bottomCollapsed"
        @click="layoutStore.toggleBottom()"
      >
        <SquareTerminal class="size-4 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <span>终端</span>
      </button>
    </nav>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5">
      <template v-if="active === 'code'">
        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <div class="max-h-[45%] flex-none overflow-auto">
            <FileTree :key="treeRoot ?? 'common'" :root="treeRoot" @select="selectedFile = $event" />
          </div>
          <div class="h-px flex-none bg-[var(--color-line)]" aria-hidden="true" />
          <FileViewer
            :key="`viewer-${treeRoot ?? 'common'}`"
            :path="selectedFile"
            :root="treeRoot"
          />
        </div>
      </template>

      <template v-else-if="active === 'git'">
        <GitPanel :root="treeRoot" />
      </template>

      <template v-else>
        <div class="text-[var(--color-mut)]">
          <p class="mb-1.5 text-[13px] font-semibold text-[var(--color-txt-strong)]">浏览器</p>
          <p class="mb-3 text-[12px] leading-normal">WebContentsView 页面抽取与理解（P2）。</p>
        </div>
      </template>
    </div>
  </aside>
</template>
