import { defineStore } from "pinia";
import { computed, nextTick, ref, watch } from "vue";

import type {
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserExtractResult,
  BrowserHistoryItem,
  BrowserSnapshot,
  BrowserStatus,
} from "@zen/shared";
import { useChatStore } from "@/stores/chat";
import { useLayoutStore } from "@/stores/layout";
import { useRightPanelStore } from "@/stores/right-panel";

const HISTORY_KEY = "zen.browser.history";
const HISTORY_LIMIT = 50;

const emptyStatus = (): BrowserStatus => ({
  state: "stopped",
  chromeVersion: "",
  electronVersion: "",
  kernelSource: "",
  pageId: null,
  url: "",
  title: "",
  picking: false,
  visible: false,
  canGoBack: false,
  canGoForward: false,
});

function loadHistory(): BrowserHistoryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter(
        (item): item is BrowserHistoryItem =>
          Boolean(item) &&
          typeof (item as BrowserHistoryItem).url === "string" &&
          Boolean((item as BrowserHistoryItem).url),
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistory(items: BrowserHistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {
    // quota / private mode
  }
}

/** 非空输入补全为可导航 URL；非地址输入转为搜索引擎 */
export function normalizeBrowserUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  if (/^(https?:\/\/|about:|file:)/i.test(value)) {
    return value;
  }
  if (/^localhost(:\d+)?(\/|$)/i.test(value) || /^127\.0\.0\.1(:\d+)?(\/|$)/.test(value) || /^\[::1\](:\d+)?(\/|$)/i.test(value)) {
    // 保留原始 host（含 [::1]），主进程会按 IPv4/IPv6 候选重试
    return `http://${value}`;
  }
  // 域名启发式（含路径）
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(value) && !/\s/.test(value)) {
    return `https://${value}`;
  }
  // 其它输入（中文/关键词）→ 搜索，避免 loadURL 拒绝后「毫无反应」
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

export const useBrowserStore = defineStore("browser", () => {
  const status = ref<BrowserStatus>(emptyStatus());
  const urlInput = ref("");
  const consoleEntries = ref<BrowserConsoleEntry[]>([]);
  const lastSnapshot = ref<BrowserSnapshot | null>(null);
  const lastExtract = ref<BrowserExtractResult | null>(null);
  const lastPicked = ref<BrowserElementRef | null>(null);
  const panelNote = ref("");
  const busy = ref(false);
  const history = ref<BrowserHistoryItem[]>(loadHistory());
  /** 新标签/历史页：原生视图隐藏，展示历史列表 */
  const showHome = ref(true);
  const annotating = ref(false);
  const lastScreenshotPath = ref("");
  /** 短暂抑制「自动展开右栏」，避免循环打开 */
  const agentNavLock = ref(false);

  const isRunning = computed(() => status.value.state === "running");
  const kernelLabel = computed(() => {
    if (status.value.electronVersion || status.value.chromeVersion) {
      return `Electron ${status.value.electronVersion} · Chromium ${status.value.chromeVersion}`;
    }
    return "内嵌 Chromium";
  });

  const suggestions = computed(() => {
    const q = urlInput.value.trim().toLowerCase();
    if (!q) {
      return history.value.slice(0, 8);
    }
    return history.value
      .filter(
        (item) =>
          item.url.toLowerCase().includes(q) || (item.title || "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  });

  function pushHistory(url: string, title: string) {
    if (!url || url === "about:blank") {
      return;
    }
    const next = [
      { url, title: title || url, visitedAt: Date.now() },
      ...history.value.filter((item) => item.url !== url),
    ].slice(0, HISTORY_LIMIT);
    history.value = next;
    saveHistory(next);
  }

  function removeHistory(url: string) {
    history.value = history.value.filter((item) => item.url !== url);
    saveHistory(history.value);
  }

  function clearHistory() {
    history.value = [];
    saveHistory([]);
    panelNote.value = "已清空浏览历史";
  }

  function bindEvents() {
    const zen = window.zen;
    if (!zen?.browser) {
      panelNote.value = "浏览器 IPC 未就绪：请完全退出后重新 pnpm dev（主进程/preload 需重启）";
      return () => undefined;
    }
    const offStatus = zen.browser.onStatus((next) => {
      status.value = next;
      if (next.error) {
        panelNote.value = next.error;
      }
      if (next.url && next.url !== "about:blank") {
        urlInput.value = next.url;
        showHome.value = false;
        pushHistory(next.url, next.title);
        // 任意来源（消息链接 / IPC / Agent）导航到真实页面时，展开右栏浏览器
        ensurePanelVisible();
      }
      if (!next.picking) {
        annotating.value = false;
      }
    });
    const offPick = zen.browser.onElementPicked((ref) => {
      lastPicked.value = ref;
      annotating.value = false;
      status.value = { ...status.value, picking: false };
      insertElementAtCaret(ref);
    });
    return () => {
      offStatus();
      offPick();
    };
  }

  function insertElementAtCaret(ref: BrowserElementRef) {
    const chat = useChatStore();
    const mark = chat.insertBrowserElement(ref);
    panelNote.value = `已插入元素标签「${mark.label}」`;
    lastPicked.value = ref;
  }

  /** Agent 使用 browser* 工具时：自动展示右栏浏览器并同步导航 */
  function ensurePanelVisible() {
    const layout = useLayoutStore();
    const right = useRightPanelStore();
    layout.rightCollapsed = false;
    right.ensureTab("browser");
  }

  async function onAgentBrowserTool(toolName: string, args: unknown) {
    ensurePanelVisible();
    const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    panelNote.value = `Agent 正在使用 ${toolName}`;
    if (toolName === "browserOpen" && typeof record.url === "string" && record.url.trim()) {
      await openUrl(record.url.trim());
      return;
    }
    // 其它浏览器工具：确保内嵌浏览器已启动并露出页面区
    await ensureRunning();
    if (status.value.state === "running" && status.value.url && status.value.url !== "about:blank") {
      showHome.value = false;
      await pushBoundsNow();
    }
  }

  async function syncStatus() {
    if (!window.zen?.browser) {
      return;
    }
    status.value = await window.zen.browser.status();
  }

  async function ensureRunning() {
    const zen = window.zen?.browser;
    if (!zen) {
      panelNote.value = "浏览器 IPC 未就绪：请完全退出后重新 pnpm dev";
      return status.value;
    }
    busy.value = true;
    panelNote.value = "正在启动内嵌浏览器…";
    try {
      // 渲染层再套一层超时，防止主进程 handler 卡死导致 UI 永久 loading
      const statusPromise = zen.ensureRunning();
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("启动内嵌浏览器超时（12s）")), 12_000);
      });
      status.value = await Promise.race([statusPromise, timeout]);
      if (status.value.error) {
        panelNote.value = status.value.error;
      } else if (status.value.state === "running") {
        panelNote.value = "内嵌浏览器已就绪";
      }
      return status.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动内嵌浏览器失败";
      panelNote.value = message;
      status.value = { ...status.value, state: "error", error: message };
      return status.value;
    } finally {
      busy.value = false;
    }
  }

  async function syncBounds(rect: DOMRect | null, visible: boolean) {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    // 历史页/隐藏时不对齐原生视图
    const effective = visible && !showHome.value;
    if (!effective || !rect || rect.width < 2 || rect.height < 2) {
      await zen.setBounds(null, false);
      return;
    }
    await zen.setBounds(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      true,
    );
  }

  async function openUrl(url?: string) {
    const zen = window.zen?.browser;
    if (!zen) {
      panelNote.value = "浏览器 IPC 未就绪：请完全退出后重新 pnpm dev";
      return;
    }
    const normalized = normalizeBrowserUrl(url ?? urlInput.value);
    if (!normalized) {
      showHome.value = true;
      await syncBoundsHost();
      panelNote.value = "请输入地址";
      return;
    }
    urlInput.value = normalized;
    ensurePanelVisible();
    busy.value = true;
    panelNote.value = `正在打开 ${normalized}…`;
    agentNavLock.value = true;
    try {
      const runStatus = await ensureRunning();
      if (runStatus.state === "error") {
        panelNote.value = runStatus.error || "内嵌浏览器启动失败";
        return;
      }
      showHome.value = false;
      // 等宿主 div 挂载后再对齐原生视图
      await nextTick();
      await syncBoundsHost();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await pushBoundsNow();
      const result = await Promise.race([
        zen.open(normalized),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("打开页面超时（15s）")), 15_000);
        }),
      ]);
      if (!result.ok) {
        panelNote.value = result.error || "打开失败";
        return;
      }
      urlInput.value = result.url;
      status.value = {
        ...status.value,
        url: result.url,
        title: result.title,
        error: undefined,
      };
      pushHistory(result.url, result.title);
      panelNote.value = `已打开：${result.title || result.url}`;
      await nextTick();
      await pushBoundsNow();
      // 再拉一次诊断，便于排查「打开了但看不见」
      if (zen.debug) {
        const debug = await zen.debug();
        const visible = debug.viewVisible === true;
        const bounds = debug.viewBounds as { width?: number; height?: number } | null;
        if (!visible || (bounds && (bounds.width || 0) < 2)) {
          panelNote.value = `${panelNote.value}｜视图未显示 bounds=${JSON.stringify(bounds)} visible=${String(debug.viewVisible)}`;
        }
      }
    } catch (error) {
      panelNote.value = error instanceof Error ? error.message : "打开地址失败";
    } finally {
      agentNavLock.value = false;
      busy.value = false;
    }
  }

  /** 由面板注入的 bounds 推送器（避免 store 无法直接读 DOM） */
  let boundsPusher: (() => Promise<void>) | null = null;
  function setBoundsPusher(fn: (() => Promise<void>) | null) {
    boundsPusher = fn;
  }
  async function pushBoundsNow() {
    if (boundsPusher) {
      await boundsPusher();
      return;
    }
    window.dispatchEvent(new CustomEvent("zen:browser-bounds-sync"));
  }

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  async function syncBoundsHost() {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
    }
    boundsTimer = setTimeout(() => {
      void pushBoundsNow();
    }, 0);
  }

  /** 地址栏聚焦时把焦点从 WebContentsView 抢回渲染进程，保证能输入 */
  async function focusHostInput() {
    const zen = window.zen?.browser;
    if (zen?.focusHost) {
      await zen.focusHost();
    }
  }

  async function goBack() {
    const zen = window.zen?.browser;
    if (!zen || !isRunning.value) {
      return;
    }
    const result = await zen.goBack();
    if (!result.ok) {
      panelNote.value = result.error || "无法后退";
      return;
    }
    urlInput.value = result.url || urlInput.value;
    panelNote.value = "";
  }

  async function goForward() {
    const zen = window.zen?.browser;
    if (!zen || !isRunning.value) {
      return;
    }
    const result = await zen.goForward();
    if (!result.ok) {
      panelNote.value = result.error || "无法前进";
      return;
    }
    urlInput.value = result.url || urlInput.value;
    panelNote.value = "";
  }

  async function reloadPage(ignoreCache = false) {
    const zen = window.zen?.browser;
    if (!zen || !isRunning.value) {
      return;
    }
    const result = await zen.reload(ignoreCache);
    if (!result.ok) {
      panelNote.value = result.error || "刷新失败";
    }
  }

  async function openInSystemBrowser() {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    // 显式「在系统浏览器中打开」仍走系统；其余链接一律应用内
    const result = await zen.openExternal(status.value.url || urlInput.value);
    if (!result.ok) {
      panelNote.value = result.error || "无法在系统浏览器打开";
      return;
    }
    panelNote.value = "已在系统浏览器打开";
  }

  async function startAnnotate() {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    await ensureRunning();
    if (showHome.value) {
      panelNote.value = "请先打开页面再标注";
      return;
    }
    const result = await zen.pickStart();
    if (!result.ok) {
      panelNote.value = result.error || "无法启动标注";
      return;
    }
    annotating.value = true;
    status.value = { ...status.value, picking: true };
    panelNote.value = "标注中：在页面上点击元素，插入到 AI 输入框光标处；Esc 取消";
  }

  async function stopAnnotate() {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    await zen.pickStop();
    annotating.value = false;
    status.value = { ...status.value, picking: false };
    panelNote.value = "";
  }

  async function takeScreenshot() {
    const zen = window.zen?.browser;
    if (!zen || showHome.value) {
      panelNote.value = "请先打开页面再截图";
      return;
    }
    busy.value = true;
    try {
      const result = await zen.screenshot();
      if (!result.ok || !result.path) {
        panelNote.value = result.error || "截图失败";
        return;
      }
      lastScreenshotPath.value = result.path;
      const chat = useChatStore();
      chat.insertAtComposerCaret(`[浏览器截图] ${result.path}`);
      panelNote.value = `截图已保存并插入输入框：${result.path}`;
    } finally {
      busy.value = false;
    }
  }

  async function captureConsole() {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    const result = await zen.console(80);
    consoleEntries.value = result.entries;
  }

  async function captureSnapshot() {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    busy.value = true;
    try {
      lastSnapshot.value = await zen.snapshot();
    } finally {
      busy.value = false;
    }
  }

  async function captureExtract() {
    const zen = window.zen?.browser;
    if (!zen) {
      return;
    }
    busy.value = true;
    try {
      lastExtract.value = await zen.extract();
    } finally {
      busy.value = false;
    }
  }

  async function pushPageContextToComposer() {
    await captureExtract();
    const extract = lastExtract.value;
    if (!extract) {
      return;
    }
    const chat = useChatStore();
    const lines = [
      `[浏览器页面] ${extract.title} — ${extract.url}`,
      extract.buttons
        .slice(0, 6)
        .map((item) => `按钮 ${item.selector}：“${item.text}”`)
        .join("\n"),
      extract.inputs.slice(0, 6).map((item) => `输入框 ${item.selector}`).join("\n"),
    ].filter(Boolean);
    chat.insertAtComposerCaret(lines.filter(Boolean).join("\n"));
    panelNote.value = "页面结构已插入输入框光标处";
  }

  function openHistoryItem(item: BrowserHistoryItem) {
    urlInput.value = item.url;
    void openUrl(item.url);
  }

  function openNewTab() {
    showHome.value = true;
    urlInput.value = "";
    void syncBoundsHost();
  }

  function openPanel() {
    useRightPanelStore().ensureTab("browser");
  }

  watch(showHome, () => {
    void syncBoundsHost();
  });

  watch(
    () => status.value.url,
    (url) => {
      if (url && url !== "about:blank") {
        urlInput.value = url;
        showHome.value = false;
      }
    },
  );

  return {
    status,
    urlInput,
    consoleEntries,
    lastSnapshot,
    lastExtract,
    lastPicked,
    panelNote,
    busy,
    history,
    suggestions,
    showHome,
    annotating,
    lastScreenshotPath,
    isRunning,
    kernelLabel,
    bindEvents,
    syncStatus,
    ensureRunning,
    syncBounds,
    openUrl,
    openNewTab,
    openHistoryItem,
    removeHistory,
    clearHistory,
    goBack,
    goForward,
    reloadPage,
    openInSystemBrowser,
    startAnnotate,
    stopAnnotate,
    takeScreenshot,
    captureConsole,
    captureSnapshot,
    captureExtract,
    pushPageContextToComposer,
    openPanel,
    setBoundsPusher,
    focusHostInput,
    onAgentBrowserTool,
    ensurePanelVisible,
    openInPanel: openUrl,
  };
});
