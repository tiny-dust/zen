<script setup lang="ts">
import {
  Columns2,
  ExternalLink,
  Plus,
  RefreshCw,
  Rows2,
  SquareTerminal,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTerminalPanes } from "@/composables/useTerminalPanes";
import { useTerminalStore } from "@/stores/terminal";

import type { TerminalSessionInfo } from "@zen/shared";

const terminalStore = useTerminalStore();
const { error, sessions, activeId, splitMode, visibleSessions } = storeToRefs(terminalStore);
const { entries, setHostRef, mountVisible, disposeEntry, startResizeObserver } =
  useTerminalPanes();

const renamingId = ref("");
const renameDraft = ref("");
const renameInputEl = ref<InstanceType<typeof Input> | null>(null);
let unbind: (() => void) | null = null;
let ipcDataOff: (() => void) | null = null;

const isSplit = computed(() => splitMode.value !== "none");
const layoutCls = computed(() =>
  splitMode.value === "columns"
    ? "grid h-full min-h-0 grid-cols-2 gap-1"
    : splitMode.value === "rows"
      ? "grid h-full min-h-0 grid-rows-2 gap-1"
      : "relative h-full min-h-0 w-full",
);

/** 右侧树：是否在当前可见分屏中 */
function inView(id: string): boolean {
  return visibleSessions.value.some((item) => item.id === id);
}

function treeStatus(item: TerminalSessionInfo): { label: string; tone: string } {
  if (item.id === activeId.value) {
    return { label: "活动中", tone: "text-[var(--color-accent)]" };
  }
  if (isSplit.value && inView(item.id)) {
    return { label: splitMode.value === "columns" ? "左右分屏" : "上下分屏", tone: "text-[var(--color-ok)]" };
  }
  return { label: "", tone: "" };
}

function setRenameInput(el: unknown) {
  // Input 是封装组件，函数 ref 收到的是组件实例（expose focus/blur/select）
  renameInputEl.value = (el as InstanceType<typeof Input> | null) ?? null;
}

onMounted(async () => {
  unbind = terminalStore.bindEvents();
  await terminalStore.loadFont();
  const zen = window.zen;
  if (zen?.terminal) {
    ipcDataOff = zen.terminal.onData((event) => {
      entries.get(event.sessionId)?.term.write(event.data);
    });
  }
  startResizeObserver();
  await nextTick();
  if (!terminalStore.sessions.length) {
    await terminalStore.start(undefined, 80, 24);
  } else if (!activeId.value && sessions.value[0]) {
    terminalStore.setActive(sessions.value[0].id);
  }
  await mountVisible();
});

onBeforeUnmount(() => {
  ipcDataOff?.();
  unbind?.();
});

function beginRename(id: string) {
  renamingId.value = id;
  renameDraft.value = terminalStore.names[id] || terminalStore.displayName(id);
  void nextTick(() => renameInputEl.value?.focus());
}

function commitRename() {
  const id = renamingId.value;
  if (id) {
    terminalStore.rename(id, renameDraft.value);
  }
  renamingId.value = "";
}

function cancelRename() {
  renamingId.value = "";
}

async function onCreateTerminal() {
  await terminalStore.start();
  await mountVisible();
}

async function onCloseSession(id: string) {
  disposeEntry(id);
  await terminalStore.close(id);
  await mountVisible();
}

function onSelectSession(id: string) {
  terminalStore.setActive(id);
}

async function onSplit(direction: "columns" | "rows") {
  await terminalStore.split(direction);
  await mountVisible();
}

function onUnsplit() {
  terminalStore.unsplit();
  void mountVisible();
}

async function restart() {
  const id = activeId.value;
  if (id) {
    disposeEntry(id);
  }
  await terminalStore.restart();
  await mountVisible();
  const next = activeId.value ? entries.get(activeId.value) : null;
  next?.term.focus();
}

async function openExternal() {
  const result = await terminalStore.openExternal();
  if (!result.ok && result.error) {
    terminalStore.$patch({ error: result.error });
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 border-t border-[var(--color-line)] bg-[var(--color-bg)]">
    <!-- 主区：终端分屏，只保留功能画面 -->
    <div class="relative min-h-0 min-w-0 flex-1 px-1 py-1">
      <div
        v-if="error"
        class="mb-1 truncate px-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-err)]"
      >
        {{ error }}
      </div>
      <div class="min-h-0" :class="error ? 'h-[calc(100%-22px)]' : 'h-full'">
        <div :class="layoutCls" class="h-full">
          <div
            v-for="item in visibleSessions"
            :key="item.id"
            :ref="(el) => setHostRef(item.id, el)"
            class="min-h-0 min-w-0 border border-[var(--color-line-soft)]"
            :class="isSplit ? 'relative h-full w-full rounded-[var(--radius-sm)]' : 'absolute inset-0'"
            @mousedown="onSelectSession(item.id)"
          />
        </div>
      </div>
    </div>

    <!-- 右侧管理条：操作 + 终端状态树（VS Code 式） -->
    <aside
      class="flex w-[172px] flex-none flex-col border-l border-[var(--color-line)] bg-[var(--color-side)]"
      aria-label="终端管理"
    >
      <div class="flex flex-none items-center gap-0.5 px-1.5 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          title="新建终端"
          aria-label="新建终端"
          @click="onCreateTerminal"
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="左右分屏"
          aria-label="左右分屏"
          :disabled="isSplit && splitMode === 'columns'"
          @click="onSplit('columns')"
        >
          <Columns2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="上下分屏"
          aria-label="上下分屏"
          :disabled="isSplit && splitMode === 'rows'"
          @click="onSplit('rows')"
        >
          <Rows2 />
        </Button>
        <Button
          v-if="isSplit"
          variant="ghost"
          size="icon-xs"
          title="取消分屏"
          aria-label="取消分屏"
          @click="onUnsplit"
        >
          <SquareTerminal />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="重启当前终端"
          aria-label="重启当前终端"
          class="ml-auto"
          @click="restart"
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="用系统终端打开"
          aria-label="用系统终端打开"
          @click="openExternal"
        >
          <ExternalLink />
        </Button>
      </div>

      <div
        class="flex-none px-2.5 pb-1 text-[10.5px] tracking-wide text-[var(--color-dim)]"
      >
        终端 {{ sessions.length }}<span v-if="isSplit"> · {{ splitMode === "columns" ? "左右" : "上下" }}</span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <div
          v-for="(item, index) in sessions"
          :key="item.id"
          class="group/term flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 transition-colors"
          :class="
            item.id === activeId
              ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : inView(item.id)
                ? 'text-[var(--color-txt)]'
                : 'text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]'
          "
        >
          <!-- 分屏中的 pane 指示 -->
          <span
            class="h-3.5 w-0.5 flex-none rounded-full"
            :class="
              item.id === activeId
                ? 'bg-[var(--color-accent)]'
                : isSplit && inView(item.id)
                  ? 'bg-[var(--color-ok)]'
                  : 'bg-transparent'
            "
            aria-hidden="true"
          />
          <SquareTerminal class="size-3.5 flex-none" aria-hidden="true" />

          <Button
            v-if="renamingId !== item.id"
            variant="ghost"
            class="h-auto min-w-0 flex-1 justify-start rounded-none px-0 text-left font-normal text-[12px] md:text-[12px] hover:bg-transparent dark:hover:bg-transparent hover:text-inherit"
            :title="item.cwd"
            @click="onSelectSession(item.id)"
            @dblclick="beginRename(item.id)"
          >
            {{ terminalStore.displayName(item.id, index) }}
          </Button>
          <Input
            v-else
            :ref="(el) => setRenameInput(el)"
            v-model="renameDraft"
            variant="ghost"
            class="min-w-0 flex-1 text-[12px] md:text-[12px] text-[var(--color-txt)]"
            aria-label="重命名终端"
            @keydown.enter="commitRename"
            @keydown.esc="cancelRename"
            @blur="commitRename"
          />

          <span
            v-if="treeStatus(item).label"
            class="flex-none text-[10px]"
            :class="treeStatus(item).tone"
            :title="treeStatus(item).label"
          >
            {{ treeStatus(item).label }}
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

        <div
          v-if="!sessions.length"
          class="px-2 py-3 text-[11px] text-[var(--color-dim)]"
        >
          暂无终端
        </div>
      </div>
    </aside>
  </div>
</template>
