<script setup lang="ts">
import {
  Bookmark,
  Camera,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Globe,
  History,
  PictureInPicture2,
  RotateCw,
  Search,
  Settings2,
  X,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import SiteFavicon from "@/components/brand/SiteFavicon.vue";
import BrowserImportDialog from "@/components/right/BrowserImportDialog.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { elementLabel, formatElementDetail } from "@/lib/browser-element";
import { siteHost, siteInitial } from "@/lib/site-url";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useBrowserStore } from "@/stores/browser";
import { useLayoutStore } from "@/stores/layout";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSettingsStore } from "@/stores/settings";

const browserStore = useBrowserStore();
const layoutStore = useLayoutStore();
const rightPanel = useRightPanelStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();
const {
  status,
  urlInput,
  history,
  bookmarks,
  suggestions,
  showHome,
  annotating,
  panelNote,
  busy,
  isRunning,
  kernelLabel,
  lastPicked,
  consoleEntries,
  isPip,
  isPipHidden,
  browserSettings,
} = storeToRefs(browserStore);

const viewHost = ref<HTMLElement | null>(null);
const urlInputEl = ref<InstanceType<typeof Input> | null>(null);
const suggestOpen = ref(false);
const suggestIndex = ref(0);
/** 用户是否用方向键明确选择过联想项 */
const suggestSelected = ref(false);
let unbind: (() => void) | null = null;
let ro: ResizeObserver | null = null;

/** 系统浏览器数据导入弹层（书签/历史/密码 CSV） */
const importOpen = ref(false);

/** 设置弹层（UA / 视口缩放） */
const settingsOpen = ref(false);
const uaDraft = ref("");
const zoomDraft = ref(100);
// 弹层覆盖在页面视图区上方：打开期间压制原生 WebContentsView，否则被其盖住（表现为点了没反应）
useBrowserOverlayGuard(settingsOpen);
// 地址联想下拉同样落到页面视图区上方，展开期间一并压制原生视图
useBrowserOverlayGuard(computed(() => suggestOpen.value && suggestions.value.length > 0));

function openSettings() {
  settingsOpen.value = !settingsOpen.value;
  if (settingsOpen.value) {
    void browserStore.loadBrowserSettingsState();
    uaDraft.value = browserSettings.value.userAgent;
    zoomDraft.value = browserSettings.value.zoomPercent;
  }
}

async function saveSettings() {
  await browserStore.updateBrowserSettings({
    userAgent: uaDraft.value.trim(),
    zoomPercent: zoomDraft.value,
  });
  settingsOpen.value = false;
  browserStore.panelNote = uaDraft.value.trim()
    ? t("panels.settingsSaved")
    : t("panels.settingsSavedDefault");
}

/** 画中画切换：悬浮中 → 返回面板；后台运行 → 重新悬浮；否则进入悬浮 */
function togglePip() {
  if (isPip.value) {
    void browserStore.exitPip();
  } else if (isPipHidden.value) {
    void browserStore.enterPip();
  } else {
    void browserStore.enterPip();
  }
}

const formattedBookmarks = computed(() =>
  bookmarks.value.map((item) => ({
    ...item,
    host: siteHost(item.url),
    initial: siteInitial(item.url),
  })),
);

const formattedHistory = computed(() =>
  history.value.map((item) => ({
    ...item,
    host: siteHost(item.url),
    initial: siteInitial(item.url),
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
    rightPanel.ensureTab("browser");
  }
  // 面板内容随会话绑定：本会话有浏览现场则把共享视图对齐回来（必要时导航），
  // 本会话从未浏览则回到新标签页（历史页），不吞并其它会话的页面
  await browserStore.reconcileView();
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
    <!-- 浏览器地址栏壳：左 导航 · 中 地址 · 右 操作（relative 承载设置弹层） -->
    <div class="relative flex flex-none items-center gap-1">
      <div class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="!isRunning || !status.canGoBack"
          :title="t('panels.back')"
          :aria-label="t('panels.back')"
          @click="browserStore.goBack()"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="!isRunning || !status.canGoForward"
          :title="t('panels.forward')"
          :aria-label="t('panels.forward')"
          @click="browserStore.goForward()"
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="busy || showHome"
          :title="t('panels.refresh')"
          :aria-label="t('panels.refresh')"
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
            <Input
              ref="urlInputEl"
              v-model="urlInput"
              variant="ghost"
              class="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 font-[family-name:var(--font-mono)] text-[12px] md:text-[12px] text-[var(--color-txt)] outline-none placeholder:text-[var(--color-dim)] focus-visible:border-[var(--ring)] [-webkit-app-region:no-drag]"
              :placeholder="t('panels.urlPlaceholder')"
              spellcheck="false"
              autocomplete="off"
              :aria-label="t('panels.urlBar')"
              @focus="onFocusUrl"
              @blur="onBlurUrl"
              @keydown="onUrlKeydown"
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
              :aria-label="t('panels.openAddress')"
              :title="t('panels.open')"
              :disabled="busy"
              @mousedown.prevent
            >
              <Search class="size-3.5" />
            </Button>
          </div>
        </form>
        <div
          v-if="suggestOpen && suggestions.length"
          class="absolute top-full right-0 left-0 z-[var(--z-popup)] max-h-48 overflow-auto rounded-b-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-raise)] py-1 shadow-[var(--shadow-menu)]"
        >
          <Button
            v-for="(item, index) in suggestions"
            :key="item.url"
            variant="ghost"
            class="flex h-auto w-full flex-col items-start justify-start gap-0.5 rounded-none px-2.5 py-1.5 text-left font-normal"
            :class="
              index === suggestIndex
                ? 'bg-[var(--color-menu-active)] hover:bg-[var(--color-menu-active)] dark:hover:bg-[var(--color-menu-active)]'
                : 'hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
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
          </Button>
        </div>
      </div>

      <div class="flex flex-none items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          :class="isPip ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]' : ''"
          :title="t('panels.pipTitle')"
          :aria-label="t('panels.pip')"
          @click="togglePip()"
        >
          <PictureInPicture2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :class="settingsOpen ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]' : ''"
          :title="t('panels.browserSettingsTitle')"
          :aria-label="t('panels.browserSettings')"
          @click="openSettings()"
        >
          <Settings2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :title="t('panels.openInSystemBrowser')"
          :aria-label="t('panels.openInSystemBrowser')"
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
          :title="t('panels.annotateTitle')"
          :aria-label="t('panels.annotate')"
          @click="annotating ? browserStore.stopAnnotate() : browserStore.startAnnotate()"
        >
          <Crosshair />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :disabled="busy || showHome"
          :title="t('panels.screenshotTitle')"
          :aria-label="t('panels.screenshot')"
          @click="browserStore.takeScreenshot()"
        >
          <Camera />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :title="t('panels.newTabTitle')"
          :aria-label="t('panels.newTab')"
          @click="browserStore.openNewTab()"
        >
          <History />
        </Button>
      </div>

      <!-- 浏览器设置弹层：UA + 视口缩放，保存后主进程持久化（~/.zen/config.json）。
           必须在地址栏壳（relative）内部：原先放在壳外，absolute 会锚到更外层容器（top-full = 整个面板高度），
           弹层落到面板底部之外且被 overflow-hidden 裁剪，表现为「点击设置没反应」 -->
      <div
        v-if="settingsOpen"
        class="absolute top-full right-0 z-[var(--z-popup)] mt-1 w-72 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-raise)] p-2.5 shadow-[var(--shadow-menu)]"
      >
        <div class="mb-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
          {{ t("panels.browserSettings") }}
        </div>
        <label class="mb-2 block">
          <span class="mb-0.5 block text-[11px] text-[var(--color-dim)]">
            {{ t("panels.uaLabel") }}
          </span>
          <Input
            v-model="uaDraft"
            variant="ghost"
            class="h-7 w-full border border-[var(--color-line)] bg-[var(--color-composer-surface)] px-2 font-[family-name:var(--font-mono)] text-[11px] md:text-[11px] text-[var(--color-txt)]"
            placeholder="Mozilla/5.0 …"
            spellcheck="false"
            autocomplete="off"
            @keydown.enter.prevent="saveSettings()"
          />
        </label>
        <label class="mb-2 block">
          <span class="mb-0.5 block text-[11px] text-[var(--color-dim)]">
            {{ t("panels.zoomLabel") }}
          </span>
          <select
            v-model.number="zoomDraft"
            class="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-composer-surface)] px-1.5 text-[12px] text-[var(--color-txt)] outline-none"
          >
            <option :value="50">50%</option>
            <option :value="67">67%</option>
            <option :value="80">80%</option>
            <option :value="90">90%</option>
            <option :value="100">{{ t("panels.zoomDefault") }}</option>
            <option :value="110">110%</option>
            <option :value="125">125%</option>
            <option :value="150">150%</option>
            <option :value="200">200%</option>
            <option :value="300">300%</option>
          </select>
        </label>
        <div class="flex items-center justify-end gap-1">
          <Button variant="ghost" size="xs" class="font-normal text-[11px] md:text-[11px] text-[var(--color-dim)]" @click="settingsOpen = false">
            {{ t("panels.cancel") }}
          </Button>
          <Button size="xs" class="font-normal text-[11px] md:text-[11px]" @click="saveSettings()">
            {{ t("panels.save") }}
          </Button>
        </div>
      </div>
    </div>

    <div class="flex flex-none items-center gap-2 text-[11px] text-[var(--color-dim)]">
      <span class="truncate font-[family-name:var(--font-mono)]">{{ kernelLabel }}</span>
      <span v-if="annotating" class="flex-none text-[var(--color-accent)]">
        {{ t("panels.annotating") }}
      </span>
      <span class="min-w-0 flex-1 truncate">{{ panelNote }}</span>
    </div>

    <div v-if="status.error" class="flex-none text-[11px] text-[var(--color-err)]">
      {{ status.error }}
    </div>

    <!-- 画中画已关闭、页面后台运行：提示并允许拉回面板/恢复悬浮 -->
    <div
      v-if="isPipHidden"
      class="flex flex-none items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-sunken)] px-2 py-1 text-[11px] text-[var(--color-dim)]"
    >
      <PictureInPicture2 class="size-3.5 flex-none" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ t("panels.pipHiddenNote") }}</span>
      <Button
        variant="ghost"
        size="xs"
        class="h-auto flex-none px-1 font-normal text-[11px] md:text-[11px] text-[var(--color-accent)]"
        @click="browserStore.enterPip()"
      >
        {{ t("panels.restorePip") }}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        class="h-auto flex-none px-1 font-normal text-[11px] md:text-[11px] text-[var(--color-dim)]"
        @click="browserStore.exitPip()"
      >
        {{ t("panels.backToPanel") }}
      </Button>
    </div>

    <!-- 新标签 / 历史页 -->
    <div
      v-if="showHome"
      class="min-h-0 flex-1 overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-sunken)] p-2"
    >
      <div class="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-mut)]">
        <Search class="size-3.5" aria-hidden="true" />
        <span class="flex-none">{{ t("panels.historyLinks") }}</span>
        <span
          v-if="formattedHistory.length"
          class="inline-flex h-4 flex-none items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-dim)]"
        >
          {{ formattedHistory.length }}
        </span>
        <Button
          variant="ghost"
          size="xs"
          class="ml-auto h-auto flex-none px-1 font-normal text-[11px] md:text-[11px] text-[var(--color-dim)] hover:bg-transparent! hover:text-[var(--color-txt)]"
          :title="t('panels.importTitle')"
          @click="importOpen = true"
        >
          {{ t("panels.importEntry") }}
        </Button>
        <Button
          v-if="history.length"
          variant="ghost"
          size="xs"
          class="h-auto flex-none px-1 font-normal text-[11px] md:text-[11px] text-[var(--color-dim)] hover:bg-transparent! hover:text-[var(--color-txt)]"
          @click="browserStore.clearHistory()"
        >
          {{ t("panels.clearHistory") }}
        </Button>
      </div>
      <!-- 书签卡片：导入/收藏的站点，点击直接打开 -->
      <div v-if="formattedBookmarks.length" class="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-mut)]">
        <Bookmark class="size-3.5" aria-hidden="true" />
        <span class="flex-none">{{ t("panels.bookmarks") }}</span>
        <span
          class="inline-flex h-4 flex-none items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-dim)]"
        >
          {{ formattedBookmarks.length }}
        </span>
      </div>
      <ul v-if="formattedBookmarks.length" class="m-0 mb-3 grid list-none grid-cols-1 gap-1.5 p-0">
        <li v-for="item in formattedBookmarks" :key="item.url">
          <div
            class="group flex items-stretch rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-menu-hover)]"
          >
            <Button
              variant="ghost"
              class="h-auto min-w-0 flex-1 items-start justify-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left font-normal hover:bg-transparent! dark:hover:bg-transparent!"
              :title="item.url"
              @click="browserStore.openUrl(item.url)"
            >
              <span
                class="mt-0.5 inline-flex size-6 flex-none items-center justify-center rounded-[6px] bg-[var(--color-chip-bg)] text-[11px] font-semibold text-[var(--color-mut)]"
                aria-hidden="true"
              >
                <SiteFavicon :url="item.url" :size="16">{{ item.initial }}</SiteFavicon>
              </span>
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate text-[12px] text-[var(--color-txt)]">
                  {{ item.title || item.host }}
                </span>
                <span
                  class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
                >
                  {{ item.host }}
                </span>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="hidden flex-none self-start text-[var(--color-dim)] hover:text-[var(--color-del)] group-hover:inline-flex focus-visible:inline-flex"
              :aria-label="t('panels.deleteBookmark')"
              :title="t('panels.deleteBookmark')"
              @click="browserStore.removeBookmark(item.url)"
            >
              <X class="size-3.5" />
            </Button>
          </div>
        </li>
      </ul>

      <div v-if="!formattedHistory.length" class="px-1 py-6 text-center text-[12px] text-[var(--color-dim)]">
        {{ t("panels.noHistory") }}
      </div>
      <!-- 历史卡片：每条一个独立卡片（站点徽标 + 标题 + 域名 + 时间），悬停时右上角时间让位给删除 -->
      <ul v-else class="m-0 grid list-none grid-cols-1 gap-1.5 p-0">
        <li v-for="item in formattedHistory" :key="item.url">
          <div
            class="group flex items-stretch rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-menu-hover)]"
          >
            <Button
              variant="ghost"
              class="h-auto min-w-0 flex-1 items-start justify-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left font-normal hover:bg-transparent! dark:hover:bg-transparent!"
              :title="item.url"
              @click="browserStore.openUrl(item.url)"
            >
              <span
                class="mt-0.5 inline-flex size-6 flex-none items-center justify-center rounded-[6px] bg-[var(--color-chip-bg)] text-[11px] font-semibold text-[var(--color-mut)]"
                aria-hidden="true"
              >
                <SiteFavicon :url="item.url" :size="16">{{ item.initial }}</SiteFavicon>
              </span>
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex min-w-0 items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">
                    {{ item.title || item.host }}
                  </span>
                  <span
                    class="flex-none text-[10px] tabular-nums text-[var(--color-dim)] group-hover:hidden"
                  >
                    {{ item.timeLabel }}
                  </span>
                </span>
                <span
                  class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
                >
                  {{ item.host }}
                </span>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="hidden flex-none self-start text-[var(--color-dim)] hover:text-[var(--color-del)] group-hover:inline-flex focus-visible:inline-flex"
              :aria-label="t('panels.deleteHistoryItem')"
              :title="t('panels.deleteHistoryItem')"
              @click="browserStore.removeHistory(item.url)"
            >
              <X class="size-3.5" />
            </Button>
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
      <div class="text-[11px] text-[var(--color-dim)]">{{ t("panels.lastPickedLabel") }}</div>
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

    <BrowserImportDialog v-model:open="importOpen" />

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
