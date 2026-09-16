<script setup lang="ts">
import { Bell, Info, PanelBottom, PanelLeft, PanelRight, Plus, Search } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref } from "vue";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";

defineProps<{
  isWide: boolean;
}>();

const chatStore = useChatStore();
const layoutStore = useLayoutStore();
const { sessionName, hasMessages } = storeToRefs(chatStore);
const { leftCollapsed, rightCollapsed, bottomCollapsed } = storeToRefs(layoutStore);

const discardOpen = ref(false);

/** 新对话会清空当前会话且不可撤销：只有已经产生消息时才拦一道 */
function onNewTask() {
  if (hasMessages.value) {
    discardOpen.value = true;
    return;
  }
  chatStore.newTask();
}

function confirmNewTask() {
  discardOpen.value = false;
  chatStore.newTask();
}

function toggleButtonClass(active: boolean) {
  return cn(
    "text-[var(--color-topbar-icon)] hover:text-[var(--color-txt-strong)]",
    active && "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]",
  );
}
</script>

<template>
  <!-- 中央区头行：窗口 chrome 的一行。侧栏打开时交通灯区在侧栏头行，这里从主区左缘起排。 -->
  <header
    class="grid flex-none h-[var(--titlebar-h)] grid-cols-[1fr_auto] items-center px-1.5 select-none [-webkit-app-region:drag] [&_[data-slot=button]]:[-webkit-app-region:no-drag]"
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

    <div class="flex h-full min-w-0 items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        :class="toggleButtonClass(false)"
        aria-label="新对话"
        title="新对话"
        @click="onNewTask()"
      >
        <Plus />
      </Button>
      <span class="mx-1 h-4 w-px flex-none bg-[var(--color-line)]" aria-hidden="true" />
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
        aria-label="底部面板"
        title="底部面板"
        @click="layoutStore.toggleBottom()"
      >
        <PanelBottom />
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

  <ConfirmDialog
    :open="discardOpen"
    title="开始新对话？"
    description="当前会话的消息、工具调用记录与产物列表会被清空，操作不可撤销。"
    confirm-label="开始新对话"
    cancel-label="继续当前会话"
    @update:open="discardOpen = $event"
    @confirm="confirmNewTask"
  />
</template>
