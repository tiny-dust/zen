<script setup lang="ts">
import { ExternalLink, Plus, RefreshCw, SquareTerminal, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { useTerminalPanes } from "@/composables/useTerminalPanes";
import { useTerminalStore } from "@/stores/terminal";

import type { TerminalSessionInfo } from "@zen/shared";

/** 右侧终端与底部共享 PTY，各自持有独立的 xterm 画面。 */
const terminalStore = useTerminalStore();
const { sessions, activeId, error } = storeToRefs(terminalStore);
const { t } = useI18n();
const activeSessions = computed(() => sessions.value.filter((item) => item.id === activeId.value));
const { entries, setHostRef, mountVisible, startResizeObserver, focusPane } =
  useTerminalPanes({ visibleIds: () => activeSessions.value.map((item) => item.id) });
let ipcDataOff: (() => void) | null = null;
let unmounted = false;

function statusLabel(item: TerminalSessionInfo): string {
  return item.id === activeId.value ? t("panels.active") : "";
}

/** 右侧会话选择和新建不再展开底部面板。 */
async function showInRightPanel(id: string) {
  terminalStore.setActive(id);
  await nextTick();
  await mountVisible();
  focusPane(id);
}

async function onCreateTerminal() {
  await terminalStore.start();
  if (activeId.value) await showInRightPanel(activeId.value);
}

async function onCloseSession(id: string) {
  await terminalStore.close(id);
  await mountVisible();
}

async function onRestart() {
  await terminalStore.restart();
  if (activeId.value) await showInRightPanel(activeId.value);
}

async function openExternal() {
  const result = await terminalStore.openExternal();
  if (!result.ok && result.error) {
    terminalStore.$patch({ error: result.error });
  }
}

onMounted(async () => {
  terminalStore.bindEvents();
  await terminalStore.loadFont();
  if (unmounted) return;
  if (window.zen?.terminal) {
    ipcDataOff = window.zen.terminal.onData((event) => {
      entries.get(event.sessionId)?.term.write(event.data);
    });
  }
  startResizeObserver();
  await mountVisible();
});

onBeforeUnmount(() => {
  unmounted = true;
  ipcDataOff?.();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2" :aria-label="t('panels.terminalSessions')">
    <div class="flex flex-none items-center gap-0.5">
      <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]">
        {{ t("panels.terminalsCount", { n: sessions.length }) }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.newTerminal')"
        :title="t('panels.newTerminal')"
        @click="onCreateTerminal"
      >
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.restartTerminal')"
        :title="t('panels.restartTerminal')"
        @click="onRestart"
      >
        <RefreshCw />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="t('panels.openInSystemTerminal')"
        :title="t('panels.openInSystemTerminal')"
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

    <div class="min-h-0 max-h-32 flex-none overflow-y-auto pb-1 [scrollbar-width:thin]">
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
          @click="showInRightPanel(item.id)"
        >
          {{ terminalStore.displayName(item.id, index) }}
        </Button>
        <span v-if="item.id === activeId" class="flex-none text-[10px] text-[var(--color-accent)]">
          {{ statusLabel(item) }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-5! flex-none rounded-[4px]! opacity-0 text-[var(--color-dim)] group-hover/term:opacity-100 focus-visible:opacity-100 focus-visible:text-[var(--color-txt-strong)] hover:text-[var(--color-del)]"
          :aria-label="t('panels.closeTerminalAria', { name: terminalStore.displayName(item.id, index) })"
          :title="t('panels.closeTerminal')"
          @click.stop="onCloseSession(item.id)"
        >
          <X class="size-3" />
        </Button>
      </div>

      <p v-if="!sessions.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
        {{ t("panels.noTerminals") }}
      </p>
    </div>

    <div
      v-for="item in activeSessions"
      :key="item.id"
      :ref="(el) => setHostRef(item.id, el)"
      class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-bg)]"
      :aria-label="t('panels.terminalSessions')"
      @mousedown="focusPane(item.id)"
    />
  </div>
</template>
