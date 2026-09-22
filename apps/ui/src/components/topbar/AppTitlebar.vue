<script setup lang="ts">
import { Bell, Info, PanelLeft, PanelRight, Search, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";

import OpenWithButton from "@/components/topbar/OpenWithButton.vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useTerminalStore } from "@/stores/terminal";

defineProps<{
  isWide: boolean;
}>();

const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { sessionName } = storeToRefs(chatStore);
const { leftCollapsed, rightCollapsed, bottomCollapsed } = storeToRefs(layoutStore);

function toggleBottomPanel() {
  const opening = bottomCollapsed.value;
  layoutStore.toggleBottom();
  if (opening) {
    void terminalStore.ensureForWorkspace();
  }
}

function toggleButtonClass(active: boolean) {
  return cn(
    "text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]",
    active && "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]",
  );
}
</script>

<template>
  <header
    class="grid flex-none h-[var(--titlebar-h)] grid-cols-[1fr_auto] items-center px-1.5 select-none [-webkit-app-region:drag] [&_[data-slot=button]]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]"
  >
    <div class="flex h-full min-w-0 items-center gap-0.5">
      <template v-if="leftCollapsed">
        <span class="w-[var(--titlebar-lead)] flex-none" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon-sm"
          :class="toggleButtonClass(false)"
          aria-label="侧栏"
          title="侧栏"
          @click="layoutStore.toggleLeft()"
        >
          <PanelLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="toggleButtonClass(false)"
          aria-label="搜索"
          title="搜索"
        >
          <Search />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="toggleButtonClass(false)"
          aria-label="通知"
          title="通知"
        >
          <Bell />
        </Button>
      </template>
      <span
        class="min-w-0 truncate text-[13px] font-medium text-[var(--color-txt)]"
        :class="leftCollapsed ? 'ml-2' : 'ml-2.5'"
        :title="sessionName"
      >{{ sessionName }}</span>
    </div>

    <div class="flex h-full min-w-0 items-center justify-end gap-1.5">
      <OpenWithButton />
      <Button
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(false)"
        aria-label="会话信息"
        title="会话信息"
        @click="isWide ? layoutStore.toggleSession() : layoutStore.toggleInfo()"
      >
        <Info />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(!bottomCollapsed)"
        aria-label="终端"
        title="终端"
        @click="toggleBottomPanel"
      >
        <SquareTerminal />
      </Button>
      <Button
        v-if="rightCollapsed"
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(false)"
        aria-label="右侧面板"
        title="右侧面板"
        @click="layoutStore.toggleRight()"
      >
        <PanelRight />
      </Button>
    </div>
  </header>
</template>
