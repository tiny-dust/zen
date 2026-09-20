<script setup lang="ts">
import { ExternalLink, RefreshCw, SquareTerminal } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { openAppLink } from "@/lib/open-link";

import { Button } from "@/components/ui/button";
import { useTerminalStore } from "@/stores/terminal";

const terminalStore = useTerminalStore();
const { shellLabel, error } = storeToRefs(terminalStore);

const hostEl = ref<HTMLElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let unbind: (() => void) | null = null;
let ro: ResizeObserver | null = null;
let extraOff: (() => void) | null = null;

const shellText = computed(() => shellLabel.value);

function fontStack(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
    "Maple Mono, Menlo, monospace"
  );
}

async function ensureTerm() {
  if (!hostEl.value || term) {
    return;
  }
  term = new Terminal({
    fontFamily: fontStack(),
    fontSize: 12,
    lineHeight: 1.35,
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      background: "#141414",
      foreground: "#d8d8d4",
      cursor: "#ff6a2b",
      selectionBackground: "#3a3a3a",
    },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  // 链接：优先右栏浏览器
  try {
    const { WebLinksAddon } = await import("@xterm/addon-web-links");
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void openAppLink(uri);
      }),
    );
  } catch {
    term.options.linkHandler = undefined;
  }
  term.open(hostEl.value);
  fit.fit();
  // 终端里的 http(s) 链接：右键或链接悬停点击 → 右栏浏览器（xterm 默认无 web-links 时用正则）
  try {
    const anyTerm = term as Terminal & {
      registerLinkMatcher?: (
        regex: RegExp,
        handler: (event: MouseEvent, uri: string) => void,
        options?: { hoverClass?: string },
      ) => number;
    };
    anyTerm.registerLinkMatcher?.(
      /https?:\/\/[^\s"'<>]+/gi,
      (_event, uri) => {
        void openAppLink(uri);
      },
      { hoverClass: "xterm-link" },
    );
  } catch {
    // ignore
  }
  term.onData((data) => {
    void terminalStore.write(data);
  });

  const dims = fit.proposeDimensions();
  await terminalStore.start(undefined, dims?.cols || 80, dims?.rows || 24);
  term.focus();

  const zen = window.zen;
  if (zen?.terminal) {
    extraOff = zen.terminal.onData((event) => {
      if (term && event.sessionId === terminalStore.sessionId) {
        term.write(event.data);
      }
    });
  }

  ro = new ResizeObserver(() => {
    if (!fit || !term) {
      return;
    }
    fit.fit();
    void terminalStore.resize(term.cols, term.rows);
  });
  ro.observe(hostEl.value);
}

onMounted(async () => {
  unbind = terminalStore.bindEvents();
  await nextTick();
  await ensureTerm();
});

onBeforeUnmount(() => {
  extraOff?.();
  unbind?.();
  ro?.disconnect();
  term?.dispose();
  term = null;
  fit = null;
});

async function restart() {
  term?.clear();
  await terminalStore.restart();
  term?.focus();
}

async function openExternal() {
  // 终端「用系统终端打开」是打开目录，不是网页；网页链接见 xterm LinkProvider
  const result = await terminalStore.openExternal();
  if (!result.ok && result.error) {
    terminalStore.$patch({ error: result.error });
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex flex-none items-center gap-1 px-2 pt-1.5">
      <span
        class="inline-flex h-7 items-center gap-1.5 rounded-t-lg border border-b-0 border-[var(--color-line)] bg-[var(--color-composer-surface)] px-2.5 text-[12px] text-[var(--color-txt)]"
      >
        <SquareTerminal class="size-3.5" aria-hidden="true" />
        终端
      </span>
      <span
        class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
      >
        {{ shellText }}
      </span>
      <div class="ml-auto flex items-center gap-0.5">
        <Button variant="ghost" size="icon-xs" title="重启终端" aria-label="重启终端" @click="restart">
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
    </div>
    <div
      class="relative min-h-0 flex-1 border-t border-[var(--color-line)] bg-[var(--color-bg)] px-1 py-1"
    >
      <div
        v-if="error"
        class="px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-err)]"
      >
        {{ error }}
      </div>
      <div ref="hostEl" class="h-full min-h-0 w-full" aria-label="内置终端" />
    </div>
  </div>
</template>
