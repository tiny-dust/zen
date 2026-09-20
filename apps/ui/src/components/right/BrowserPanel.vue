<script setup lang="ts">
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Globe,
  History,
  RotateCw,
  Search,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { Button } from "@/components/ui/button";
import { elementLabel, formatElementDetail } from "@/lib/browser-element";
import { useBrowserStore } from "@/stores/browser";
import { useLayoutStore } from "@/stores/layout";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSettingsStore } from "@/stores/settings";

const browserStore = useBrowserStore();
const layoutStore = useLayoutStore();
const rightPanel = useRightPanelStore();
const settingsStore = useSettingsStore();
const {
  status,
  urlInput,
  history,
  suggestions,
  showHome,
  annotating,
  panelNote,
  busy,
  isRunning,
  kernelLabel,
  lastPicked,
  consoleEntries,
} = storeToRefs(browserStore);

const viewHost = ref<HTMLElement | null>(null);
const urlInputEl = ref<HTMLInputElement | null>(null);
const suggestOpen = ref(false);
const suggestIndex = ref(0);
/** 用户是否用方向键明确选择过联想项 */
const suggestSelected = ref(false);
let unbind: (() => void) | null = null;
let ro: ResizeObserver | null = null;

const formattedHistory = computed(() =>
  history.value.map((item) => ({
    ...item,
    timeLabel: formatTime(item.visitedAt),
  })),
);

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function hostVisible(): boolean {
  return (
    !layoutStore.rightCollapsed &&
    !settingsStore.settingsOpen &&
    !showHome.value &&
    rightPanel.activeTab?.kind === "browser" &&
    Boolean(viewHost.value)
  );
}

async function pushBounds() {
  await nextTick();
  const el = viewHost.value;
  if (!el || showHome.value) {
    await browserStore.syncBounds(null, false);
    return;
  }
  const rect = el.getBoundingClientRect();
  await browserStore.syncBounds(rect, hostVisible());
}

function onBoundsEvent() {
  void pushBounds();
}

function onSubmitUrl() {
  suggestOpen.value = false;
  suggestSelected.value = false;
  void browserStore.openUrl();
}

function onFocusUrl() {
  suggestOpen.value = true;
  suggestIndex.value = 0;
  suggestSelected.value = false;
  // 防止 WebContentsView 抢走键盘焦点
  void browserStore.focusHostInput();
  urlInputEl.value?.focus();
}

function onBlurUrl() {
  setTimeout(() => {
    suggestOpen.value = false;
    suggestSelected.value = false;
  }, 150);
}

function onUrlKeydown(event: KeyboardEvent) {
  const hasSuggest = suggestOpen.value && suggestions.value.length > 0;

  if (event.key === "Enter") {
    event.preventDefault();
    // 仅在用户用 ↑↓ 明确选过联想项时才采用联想 URL；否则始终用输入框内容
    if (hasSuggest && suggestSelected.value) {
      const hit = suggestions.value[suggestIndex.value];
      if (hit) {
        urlInput.value = hit.url;
      }
    }
    void onSubmitUrl();
    return;
  }
  if (!hasSuggest) {
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    suggestSelected.value = true;
    suggestIndex.value = (suggestIndex.value + 1) % suggestions.value.length;
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    suggestSelected.value = true;
    suggestIndex.value =
      (suggestIndex.value - 1 + suggestions.value.length) % suggestions.value.length;
    return;
  }
  if (event.key === "Escape") {
    suggestOpen.value = false;
    suggestSelected.value = false;
  }
}

function pickSuggestion(url: string) {
  urlInput.value = url;
  void onSubmitUrl();
}

onMounted(async () => {
  unbind = browserStore.bindEvents();
  browserStore.setBoundsPusher(pushBounds);
  await browserStore.syncStatus();
  // 刷新后主进程里视图可能仍在：若仍在运行则恢复浏览器 tab，而不是关掉面板却留下页面
  if (browserStore.status.state === "running" && browserStore.status.url) {
    showHome.value = browserStore.status.url === "about:blank";
    rightPanel.ensureTab("browser");
    urlInput.value = browserStore.status.url;
  } else if (!history.value.length) {
    showHome.value = true;
  }
  await pushBounds();
  if (viewHost.value) {
    ro = new ResizeObserver(() => {
      void pushBounds();
    });
    ro.observe(viewHost.value);
  }
  window.addEventListener("resize", pushBounds);
  window.addEventListener("zen:browser-bounds-sync", onBoundsEvent);
});

onBeforeUnmount(() => {
  browserStore.setBoundsPusher(null);
  window.removeEventListener("resize", pushBounds);
  window.removeEventListener("zen:browser-bounds-sync", onBoundsEvent);
  ro?.disconnect();
  unbind?.();
  void browserStore.syncBounds(null, false);
});

watch(
  () => [
    rightPanel.activeId,
    layoutStore.rightCollapsed,
    layoutStore.rightWidth,
    settingsStore.settingsOpen,
    showHome.value,
  ],
  () => {
    void pushBounds();
  },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-2">
    <!-- 浏览器地址栏壳：左 导航 · 中 地址 · 右 操作 -->
    <div class="flex flex-none items-center gap-1">
      <div class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="!isRunning || !status.canGoBack"
          title="后退"
          aria-label="后退"
          @click="browserStore.goBack()"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="!isRunning || !status.canGoForward"
          title="前进"
          aria-label="前进"
          @click="browserStore.goForward()"
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="busy || showHome"
          title="刷新"
          aria-label="刷新"
          @click="browserStore.reloadPage()"
        >
          <RotateCw :class="busy ? 'animate-spin' : ''" />
        </Button>
      </div>

      <div class="relative min-w-0 flex-1">
        <form class="contents" @submit.prevent="onSubmitUrl">
          <div
            class="flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-composer-surface)] px-2 [-webkit-app-region:no-drag]"
            :class="suggestOpen && suggestions.length ? 'rounded-b-none border-b-0' : ''"
          >
            <Globe class="size-3.5 flex-none text-[var(--color-dim)]" aria-hidden="true" />
            <input
              ref="urlInputEl"
              v-model="urlInput"
              class="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 font-[family-name:var(--font-mono)] text-[12px] text-[var(--color-txt)] outline-none placeholder:text-[var(--color-dim)] focus-visible:border-[var(--ring)] [-webkit-app-region:no-drag]"
              placeholder="输入网址或关键词，Enter 打开"
              spellcheck="false"
              autocomplete="off"
              aria-label="地址栏"
              @focus="onFocusUrl"
              @blur="onBlurUrl"
              @keydown="onUrlKeydown"
            />
            <button
              type="submit"
              class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
              aria-label="打开地址"
              title="打开"
              :disabled="busy"
              @mousedown.prevent
            >
              <Search class="size-3.5" />
            </button>
          </div>
        </form>
        <div
          v-if="suggestOpen && suggestions.length"
          class="absolute top-full right-0 left-0 z-[var(--z-popup)] max-h-48 overflow-auto rounded-b-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-raise)] py-1 shadow-[var(--shadow-menu)]"
        >
          <button
            v-for="(item, index) in suggestions"
            :key="item.url"
            type="button"
            class="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left"
            :class="
              index === suggestIndex
                ? 'bg-[var(--color-menu-active)]'
                : 'hover:bg-[var(--color-menu-hover)]'
            "
            @mousedown.prevent="pickSuggestion(item.url)"
          >
            <span class="truncate text-[12px] text-[var(--color-txt-strong)]">{{
              item.title || item.url
            }}</span>
            <span
              class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
              >{{ item.url }}</span
            >
          </button>
        </div>
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          title="在系统浏览器中打开"
          aria-label="在系统浏览器中打开"
          :disabled="showHome && !urlInput"
          @click="browserStore.openInSystemBrowser()"
        >
          <ExternalLink />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :class="
            annotating
              ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
              : ''
          "
          :disabled="busy || showHome"
          title="标注页面元素并插入 AI 输入框"
          aria-label="标注"
          @click="annotating ? browserStore.stopAnnotate() : browserStore.startAnnotate()"
        >
          <Crosshair />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="busy || showHome"
          title="截图并插入 AI 输入框"
          aria-label="截图"
          @click="browserStore.takeScreenshot()"
        >
          <Camera />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="新标签页（浏览历史）"
          aria-label="新标签页"
          @click="browserStore.openNewTab()"
        >
          <History />
        </Button>
      </div>
    </div>

    <div class="flex flex-none items-center gap-2 text-[11px] text-[var(--color-dim)]">
      <span class="truncate font-[family-name:var(--font-mono)]">{{ kernelLabel }}</span>
      <span v-if="annotating" class="flex-none text-[var(--color-accent)]">标注中</span>
      <span class="min-w-0 flex-1 truncate">{{ panelNote }}</span>
      <button
        v-if="history.length"
        type="button"
        class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt)]"
        @click="browserStore.clearHistory()"
      >
        清空历史
      </button>
    </div>

    <div v-if="status.error" class="flex-none text-[11px] text-[var(--color-err)]">
      {{ status.error }}
    </div>

    <!-- 新标签 / 历史页 -->
    <div
      v-if="showHome"
      class="min-h-0 flex-1 overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-sunken)] p-2"
    >
      <div class="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-mut)]">
        <Search class="size-3.5" aria-hidden="true" />
        历史链接
      </div>
      <div v-if="!formattedHistory.length" class="px-1 py-6 text-center text-[12px] text-[var(--color-dim)]">
        暂无历史。在上方地址栏输入 URL 打开页面后，这里会记录访问过的链接。
      </div>
      <ul v-else class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="item in formattedHistory" :key="item.url">
          <div
            class="group flex items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-[var(--color-menu-hover)]"
          >
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              @click="browserStore.openHistoryItem(item)"
            >
              <div class="truncate text-[12px] text-[var(--color-txt)]">
                {{ item.title || item.url }}
              </div>
              <div
                class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
              >
                {{ item.url }}
              </div>
            </button>
            <span class="flex-none font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-dim)]">
              {{ item.timeLabel }}
            </span>
            <button
              type="button"
              class="flex-none opacity-0 group-hover:opacity-100 text-[var(--color-dim)] hover:text-[var(--color-del)]"
              aria-label="删除该历史"
              @click="browserStore.removeHistory(item.url)"
            >
              <X class="size-3.5" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- WebContentsView 宿主：主进程视图叠在该矩形上（必须 relative，避免 absolute 逃逸到窗口左上角） -->
    <div
      v-else
      ref="viewHost"
      class="relative min-h-[160px] flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-sunken)]"
      data-browser-view-host
    />

    <div
      v-if="lastPicked"
      class="flex-none rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-sunken)] px-2 py-1.5"
      :title="formatElementDetail(lastPicked)"
    >
      <div class="text-[11px] text-[var(--color-dim)]">最近标注（已插入输入框）</div>
      <div class="flex min-w-0 items-center gap-1.5">
        <Globe class="size-3.5 flex-none text-[var(--color-accent)]" aria-hidden="true" />
        <span class="truncate text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ elementLabel(lastPicked) }}
        </span>
        <span class="flex-none text-[11px] text-[var(--color-mut)]">{{ lastPicked.tag }}</span>
      </div>
      <div
        class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
      >
        {{ lastPicked.selector }}
      </div>
    </div>

    <div
      v-if="consoleEntries.length"
      class="max-h-24 flex-none overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-sunken)] p-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]"
    >
      <div v-for="(entry, index) in consoleEntries.slice(-8)" :key="index" class="truncate">
        [{{ entry.level }}] {{ entry.text }}
      </div>
    </div>
  </div>
</template>
