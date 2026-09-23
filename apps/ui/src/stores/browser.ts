import { defineStore } from "pinia";
import { computed, nextTick, ref, watch } from "vue";

import type {
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserExtractResult,
  BrowserHistoryItem,
  BrowserSettings,
  BrowserSnapshot,
  BrowserStatus,
} from "@zen/shared";
import { DEFAULT_BROWSER_SETTINGS } from "@zen/shared";
import { useChatStore } from "@/stores/chat";
import { createBrowserHistory } from "@/stores/browser-history";
import { buildPageContextText, emptyStatus, normalizeBrowserUrl } from "@/stores/browser-utils";
import { useLayoutStore } from "@/stores/layout";
import { useRightPanelStore } from "@/stores/right-panel";

export { normalizeBrowserUrl };

export const useBrowserStore = defineStore("browser", () => {
  const status = ref<BrowserStatus>(emptyStatus());
  const urlInput = ref("");
  const consoleEntries = ref<BrowserConsoleEntry[]>([]);
  const lastSnapshot = ref<BrowserSnapshot | null>(null);
  const lastExtract = ref<BrowserExtractResult | null>(null);
  const lastPicked = ref<BrowserElementRef | null>(null);
  const panelNote = ref("");
  const busy = ref(false);
  const { history, suggestions, pushHistory, removeHistory, clearHistory } = createBrowserHistory({
    urlInput,
    panelNote,
  });
  /** 新标签/历史页：原生视图隐藏，展示历史列表 */
  const showHome = ref(true);
  /** 渲染层弹窗（技能/MCP 等 HTML 覆盖层）打开期间压制原生视图：WebContentsView 层级高于一切 HTML */
  const overlayDepth = ref(0);
  const annotating = ref(false);
  const lastScreenshotPath = ref("");
  /** 短暂抑制「自动展开右栏」，避免循环打开 */
  const agentNavLock = ref(false);
  /** 浏览器设置（UA / 缩放），持久化在 ~/.zen/config.json */
  const browserSettings = ref<BrowserSettings>({ ...DEFAULT_BROWSER_SETTINGS });

  const isRunning = computed(() => status.value.state === "running");
  const isPip = computed(() => status.value.pip);
  const isPipHidden = computed(() => status.value.pipHidden);
  const kernelLabel = computed(() => {
    if (status.value.electronVersion || status.value.chromeVersion) {
      return `Electron ${status.value.electronVersion} · Chromium ${status.value.chromeVersion}`;
    }
    return "内嵌 Chromium";
  });

  function bindEvents() {
    const zen = window.zen;
    if (!zen?.browser) {
      panelNote.value = "浏览器 IPC 未就绪：请完全退出后重新 pnpm dev（主进程/preload 需重启）";
      return () => undefined;
    }
    const offStatus = zen.browser.onStatus((next) => {
      const prevUrl = status.value.url;
      status.value = next;
      if (next.error) {
        panelNote.value = next.error;
      }
      // 仅在真正导航到新 URL 时拉起页面视图：可见性/标题等状态事件若也重置
      // showHome，会把用户刚打开的历史页（新标签页）立刻弹回原页面
      if (next.url && next.url !== "about:blank" && next.url !== prevUrl) {
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
    // 画中画悬浮/后台运行时不推送面板 bounds：视图由主进程 PiP 逻辑接管，面板推送会把它拽回主窗口
    if (status.value.pip || status.value.pipHidden) {
      return;
    }
    // 历史页/弹窗压制/隐藏时不对齐原生视图
    const effective = visible && !showHome.value && overlayDepth.value === 0;
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

  /**
   * 系统文件弹窗会被内嵌浏览器视图盖住：弹窗打开前隐藏原生视图，
   * 返回恢复函数（弹窗关闭后调用，按当前布局重新显示并对齐 bounds）。
   */
  async function beginFileDialog(): Promise<() => Promise<void>> {
    const zen = window.zen?.browser;
    if (!zen || !isRunning.value || showHome.value) {
      return async () => undefined;
    }
    await zen.setVisible(false);
    return async () => {
      await zen.setVisible(true);
      await pushBoundsNow();
    };
  }

  /**
   * HTML 弹窗打开期间压制原生浏览器视图（计数制，支持弹窗叠弹窗）。
   * 计数增减同步执行避免竞态；关闭时按当前布局重新评估可见性。
   */
  function beginOverlay(): void {
    overlayDepth.value += 1;
    if (overlayDepth.value === 1) {
      void window.zen?.browser?.setBounds(null, false);
    }
  }

  function endOverlay(): void {
    overlayDepth.value = Math.max(0, overlayDepth.value - 1);
    if (overlayDepth.value === 0) {
      void pushBoundsNow();
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
    chat.insertAtComposerCaret(buildPageContextText(extract));
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

  /** 读取浏览器设置（面板设置弹层打开时调用） */
  async function loadBrowserSettingsState() {
    const zen = window.zen?.browser;
    if (!zen?.getSettings) {
      return;
    }
    browserSettings.value = await zen.getSettings();
  }

  /** 保存浏览器设置（UA / 缩放），主进程落盘并即时生效 */
  async function updateBrowserSettings(partial: Partial<BrowserSettings>) {
    const zen = window.zen?.browser;
    if (!zen?.setSettings) {
      return;
    }
    browserSettings.value = await zen.setSettings(partial);
  }

  /** 进入画中画悬浮窗（off/hidden → floating） */
  async function enterPip() {
    const zen = window.zen?.browser;
    if (!zen?.pipEnter) {
      return;
    }
    status.value = await zen.pipEnter();
    panelNote.value = status.value.pip ? "已进入画中画悬浮窗" : panelNote.value;
  }

  /** 退出画中画：视图放回浏览器面板（floating/hidden → off，随后面板 bounds 推送接管） */
  async function exitPip() {
    const zen = window.zen?.browser;
    if (!zen?.pipExit) {
      return;
    }
    status.value = await zen.pipExit();
    // 面板重新接管视图
    await pushBoundsNow();
    panelNote.value = status.value.pipHidden ? "浏览器页面在后台运行" : "";
  }

  /** 关闭画中画悬浮窗（页面转入后台运行，面板暂不接管） */
  async function hidePip() {
    const zen = window.zen?.browser;
    if (!zen?.pipHide) {
      return;
    }
    status.value = await zen.pipHide();
    panelNote.value = "画中画已关闭，浏览器页面在后台运行";
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
    isPip,
    isPipHidden,
    browserSettings,
    kernelLabel,
    bindEvents,
    syncStatus,
    ensureRunning,
    syncBounds,
    openUrl,
    loadBrowserSettingsState,
    updateBrowserSettings,
    enterPip,
    exitPip,
    hidePip,
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
    beginFileDialog,
    beginOverlay,
    endOverlay,
    onAgentBrowserTool,
    ensurePanelVisible,
    openInPanel: openUrl,
  };
});
