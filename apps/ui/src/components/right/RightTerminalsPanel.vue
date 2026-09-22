<script setup lang="ts">
import { ExternalLink, Plus, RefreshCw, SquareTerminal, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted } from "vue";

import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout";
import { useTerminalStore } from "@/stores/terminal";

import type { TerminalSessionInfo } from "@zen/shared";

/**
 * 右侧悬浮面板 · 终端模块：汇总 Zen 启动的全部终端会话。
 * 仅在有运行中终端时由 RightPanel 挂载；点击行回到底部终端面板并激活该会话。
 */
const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const { sessions, activeId, error } = storeToRefs(terminalStore);

function statusLabel(item: TerminalSessionInfo): string {
  return item.id === activeId.value ? "活动中" : "";
}

/** 点击会话：展开底部终端面板并切到该会话 */
function openInBottomPanel(id: string) {
  terminalStore.setActive(id);
  if (layoutStore.bottomCollapsed) {
    layoutStore.toggleBottom();
  }
}

async function onCreateTerminal() {
  await terminalStore.start();
  openInBottomPanel(terminalStore.activeId);
}

async function onCloseSession(id: string) {
  await terminalStore.close(id);
}

async function onRestart() {
  await terminalStore.restart();
  openInBottomPanel(terminalStore.activeId);
}

async function openExternal() {
  const result = await terminalStore.openExternal();
  if (!result.ok && result.error) {
    terminalStore.$patch({ error: result.error });
  }
}

onMounted(() => {
  // 面板被挂载说明存在终端会话；兜底建立 IPC 事件绑定（底部面板未开过时）
  terminalStore.bindEvents();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2" aria-label="终端会话">
    <div class="flex flex-none items-center gap-0.5">
      <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]">
        终端 {{ sessions.length }}
      </span>
      <Button variant="ghost" size="icon-xs" aria-label="新建终端" title="新建终端" @click="onCreateTerminal">
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="重启当前终端"
        title="重启当前终端"
        @click="onRestart"
      >
        <RefreshCw />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="用系统终端打开"
        title="用系统终端打开"
        @click="openExternal"
      >
        <ExternalLink />
      </Button>
    </div>

    <p
      v-if="error"
      class="m-0 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-err)]"
    >
      {{ error }}
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-width:thin]">
      <div
        v-for="(item, index) in sessions"
        :key="item.id"
        class="group/term flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1"
        :class="
          item.id === activeId
            ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
            : 'text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]'
        "
      >
        <span
          class="h-3.5 w-0.5 flex-none rounded-full"
          :class="item.id === activeId ? 'bg-[var(--color-accent)]' : 'bg-transparent'"
          aria-hidden="true"
        />
        <SquareTerminal class="size-3.5 flex-none" aria-hidden="true" />
        <Button
          variant="ghost"
          class="h-auto min-w-0 flex-1 justify-start rounded-none px-0 text-left font-normal text-[12px] md:text-[12px] hover:bg-transparent dark:hover:bg-transparent hover:text-inherit"
          :title="item.cwd"
          @click="openInBottomPanel(item.id)"
        >
          {{ terminalStore.displayName(item.id, index) }}
        </Button>
        <span v-if="item.id === activeId" class="flex-none text-[10px] text-[var(--color-accent)]">
          {{ statusLabel(item) }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-5! flex-none rounded-[4px]! opacity-0 text-[var(--color-dim)] group-hover/term:opacity-100 hover:text-[var(--color-del)]"
          :aria-label="`关闭 ${terminalStore.displayName(item.id, index)}`"
          title="关闭终端"
          @click.stop="onCloseSession(item.id)"
        >
          <X class="size-3" />
        </Button>
      </div>

      <p v-if="!sessions.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
        暂无运行中的终端
      </p>
    </div>
  </div>
</template>
