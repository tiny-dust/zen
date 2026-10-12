<script setup lang="ts">
import { Bell, Info, PanelLeft, PanelRight, Plus, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import OpenWithButton from "@/components/topbar/OpenWithButton.vue";
import WindowControls from "@/components/topbar/WindowControls.vue";
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
const { t } = useI18n();
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
          :aria-label="t('shell.sidebar')"
          :title="t('shell.sidebar')"
          @click="layoutStore.toggleLeft()"
        >
          <PanelLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="toggleButtonClass(false)"
          :aria-label="t('shell.notifications')"
          :title="t('shell.notifications')"
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
        :aria-label="t('shell.newChat')"
        :title="t('shell.newChat')"
        @click="chatStore.newTask()"
      >
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(false)"
        :aria-label="t('shell.sessionInfo')"
        :title="t('shell.sessionInfo')"
        @click="isWide ? layoutStore.toggleSession() : layoutStore.toggleInfo()"
      >
        <Info />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(!bottomCollapsed)"
        :aria-label="t('shell.terminal')"
        :title="t('shell.terminal')"
        @click="toggleBottomPanel"
      >
        <SquareTerminal />
      </Button>
      <Button
        v-if="rightCollapsed"
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(false)"
        :aria-label="t('shell.rightPanel')"
        :title="t('shell.rightPanel')"
        @click="layoutStore.toggleRight()"
      >
        <PanelRight />
      </Button>
      <!-- Windows/Linux 三键（自绘）右上角固定占位；macOS 交通灯在左上，此处为 0。
           no-drag + h-full：把三键区从头行 drag 矩形中挖掉（必须撑满高度，
           零高的 span 挖不出洞），避免后登记的 drag 盖住三键点击区。 -->
      <span
        v-if="rightCollapsed"
        class="h-full w-[var(--titlebar-trail)] flex-none [-webkit-app-region:no-drag]"
        aria-hidden="true"
      />
    </div>
  </header>

  <WindowControls />
</template>
