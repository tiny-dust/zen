<script setup lang="ts">
import {
  IconBug as Bug,
  IconCheck as Check,
  IconFolderOpen as FolderOpen,
  IconGitBranch as GitBranch,
  IconLayoutSidebarRightCollapse as PanelCollapse,
  IconMessagePlus as MessagePlus,
  IconPlus as Plus,
  IconPlugConnected as Server,
  IconRobot as Bot,
  IconSitemap as Workflow,
  IconSparkles as Sparkles,
  IconTerminal2 as SquareTerminal,
  IconWorld as Globe,
  IconX as X,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Component } from "vue";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";
import { useLayoutStore } from "@/stores/layout";
import {
  PANEL_TITLES,
  useRightPanelStore,
  type ManagedPanelKind,
} from "@/stores/right-panel";
import { useSideChatStore } from "@/stores/side-chat";
import { cn } from "@/lib/utils";

import type { SideChatRecord } from "@zen/shared";

/**
 * 右侧面板的标签条（对齐 nomi）：放在顶栏右段，与面板本体分离。
 * 面板本体只渲染内容，头行不再重复一份标签。
 */
const { t } = useI18n();
const layoutStore = useLayoutStore();
const rightPanel = useRightPanelStore();
const gitStore = useGitStore();
const chatStore = useChatStore();
const sideChatStore = useSideChatStore();
const { tabs, activeId } = storeToRefs(rightPanel);

/** 「打开面板」菜单展开态：菜单浮层 z 低于内嵌浏览器原生视图，打开期间需压制 */
const panelMenuOpen = ref(false);
useBrowserOverlayGuard(panelMenuOpen);
/** 侧边对话菜单同样会盖在原生视图上 */
const sideChatMenuOpen = ref(false);
useBrowserOverlayGuard(sideChatMenuOpen);

/** 当前主会话的侧边对话（最近更新在前），历史菜单直接列它 */
const sideChats = computed(() => sideChatStore.list);
const hasSession = computed(() => !!chatStore.sessionId);

/**
 * 侧边对话列表跟着主会话走：标签条常驻顶栏（右栏收起时也在），
 * 这里拉列表，历史菜单任何状态下都能打开记录。
 */
watch(
  () => chatStore.sessionId,
  (id) => {
    void sideChatStore.load(id ?? "");
  },
  { immediate: true },
);

const PANEL_ITEMS: { kind: ManagedPanelKind; icon: Component }[] = [
  { kind: "files", icon: FolderOpen },
  { kind: "browser", icon: Globe },
  { kind: "git", icon: GitBranch },
  { kind: "agents", icon: Bot },
  { kind: "terminals", icon: SquareTerminal },
  { kind: "services", icon: Server },
  { kind: "skill", icon: Sparkles },
  { kind: "workflow", icon: Workflow },
  { kind: "errors", icon: Bug },
  { kind: "external", icon: Bot },
];

function iconFor(kind: string) {
  if (kind === "side-chat") {
    return MessagePlus;
  }
  return PANEL_ITEMS.find((item) => item.kind === kind)?.icon ?? FolderOpen;
}

/** 新建侧边对话：主进程建记录（独立落库），再打开它的标签 */
async function newSideChat() {
  if (!chatStore.sessionId) {
    return;
  }
  const record = await sideChatStore.create(chatStore.sessionId);
  if (record) {
    rightPanel.ensureSideChat(record);
  }
}

/** 历史里重开：同一条记录只保留一个标签，记录本身一直在 */
function openSideChat(record: SideChatRecord) {
  rightPanel.ensureSideChat(record);
}

function formatAgo(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) {
    return t("sideChat.justNow");
  }
  if (minutes < 60) {
    return t("sideChat.minutesAgo", { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("sideChat.hoursAgo", { n: hours });
  }
  return t("sideChat.daysAgo", { n: Math.floor(hours / 24) });
}

const tabListEl = ref<HTMLElement | null>(null);

function tabCls(id: string) {
  return cn(
    "h-7 min-w-0 max-w-[120px] justify-start gap-1 rounded-[var(--radius-sm)] px-2 text-left text-[12px] font-normal hover:bg-transparent! dark:hover:bg-transparent!",
    id === activeId.value
      ? "text-[var(--color-txt-strong)]"
      : "text-[var(--color-mut)] hover:text-[var(--color-txt)]",
  );
}

function focusActiveTab() {
  tabListEl.value?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
}

function onTabKeydown(event: KeyboardEvent, id: string) {
  const index = tabs.value.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  let nextIndex: number;
  switch (event.key) {
    case "ArrowRight": nextIndex = (index + 1) % tabs.value.length; break;
    case "ArrowLeft": nextIndex = (index - 1 + tabs.value.length) % tabs.value.length; break;
    case "Home": nextIndex = 0; break;
    case "End": nextIndex = tabs.value.length - 1; break;
    default: return;
  }
  event.preventDefault();
  rightPanel.activate(tabs.value[nextIndex].id);
  void nextTick(focusActiveTab);
}

function closeTab(id: string) {
  rightPanel.closeTab(id);
  void nextTick(focusActiveTab);
}
</script>

<template>
  <div class="flex min-w-0 items-center gap-1">
    <div ref="tabListEl" class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" :aria-label="t('panels.panelAria')">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="flex min-w-0 flex-none items-center rounded-[var(--radius-sm)] transition-colors duration-[var(--motion-fast)]"
        :class="tab.id === activeId ? 'bg-[var(--color-menu-active)]' : 'hover:bg-[var(--color-menu-hover)]'"
      >
        <Button
          variant="ghost"
          :class="tabCls(tab.id)"
          role="tab"
          :id="`panel-tab-${tab.id}`"
          :aria-controls="`panel-content-${tab.id}`"
          :aria-selected="tab.id === activeId"
          :tabindex="tab.id === activeId ? 0 : -1"
          @click="rightPanel.activate(tab.id)"
          @keydown="onTabKeydown($event, tab.id)"
        >
          <component
            :is="iconFor(tab.kind)"
            class="size-3.5 flex-none"
            :class="tab.kind === 'git' && gitStore.loading ? 'animate-spin' : ''"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{{ tab.title }}</span>
        </Button>
        <Button
          v-if="tabs.length > 1"
          variant="ghost"
          size="icon-xs"
          class="mr-1 size-4 flex-none rounded text-[var(--color-dim)] hover:text-[var(--color-txt)]"
          :aria-label="`${t('panels.closeTab')}: ${tab.title}`"
          @click="closeTab(tab.id)"
        >
          <X class="size-3" />
        </Button>
      </div>
    </div>

    <div class="flex flex-none items-center gap-0.5">
      <!-- 侧边对话：新建 + 当前会话的历史记录（没有主会话时不显示入口） -->
      <DropdownMenu
        v-if="hasSession"
        @update:open="(open: boolean) => (sideChatMenuOpen = open)"
      >
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('sideChat.newChat')"
            :title="t('sideChat.newChat')"
            data-testid="side-chat-menu"
          >
            <MessagePlus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-[200px]">
          <DropdownMenuItem class="gap-2" data-testid="side-chat-create" @select="newSideChat">
            <MessagePlus class="size-4 text-[var(--color-mut)]" aria-hidden="true" />
            <span class="flex-1">{{ t("sideChat.newChat") }}</span>
          </DropdownMenuItem>
          <template v-if="sideChats.length">
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
              {{ t("sideChat.history") }}
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="record in sideChats"
              :key="record.id"
              class="flex flex-col items-start gap-0.5"
              :data-testid="`side-chat-history-${record.id}`"
              @select="openSideChat(record)"
            >
              <span class="w-full truncate text-[12px]">{{ record.title }}</span>
              <span class="text-[11px] text-[var(--color-dim)]">{{ formatAgo(record.updatedAt) }}</span>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu @update:open="(open: boolean) => (panelMenuOpen = open)">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
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
            <Check v-if="rightPanel.hasKind(item.kind)" class="size-3.5 text-[var(--color-accent)]" aria-hidden="true" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-[var(--color-mut)]"
        :aria-label="t('panels.collapsePanel')"
        :title="t('panels.collapsePanel')"
        @click="layoutStore.toggleRight()"
      >
        <PanelCollapse />
      </Button>
    </div>
  </div>
</template>
