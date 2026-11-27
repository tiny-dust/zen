import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { createSessionBuckets } from "@/stores/session-buckets";
import { useLayoutStore } from "@/stores/layout";
import { i18n } from "@/locales";

export type RightPanelKind =
  | "files"
  | "browser"
  | "git"
  | "agents"
  | "terminals"
  | "services"
  | "skill"
  | "workflow"
  | "errors"
  | "external"
  | "trace"
  | "side-chat";

/** 常规面板：每种至多一个实例；侧边对话按记录多开，走 ensureSideChat */
export type ManagedPanelKind = Exclude<RightPanelKind, "side-chat">;

export interface RightPanelTab {
  id: string;
  kind: RightPanelKind;
  title: string;
}

/** 侧边对话 tab id：一条记录只允许一个标签 */
export function sideChatTabId(recordId: string): string {
  return `side-chat:${recordId}`;
}

/** tab id → 侧边对话记录 id（非侧边对话 tab 返回空串） */
export function sideChatRecordId(tabId: string): string {
  return tabId.startsWith("side-chat:") ? tabId.slice("side-chat:".length) : "";
}

/** 面板类型 → 标题：tab 与右栏「打开面板」菜单共用，同一文案只写一次（getter 延迟翻译，随语言切换刷新） */
export const PANEL_TITLES: Record<RightPanelKind, string> = {
  get files() {
    return i18n.global.t("app.panel.files");
  },
  get browser() {
    return i18n.global.t("app.panel.browser");
  },
  get git() {
    return i18n.global.t("app.panel.git");
  },
  get agents() {
    return i18n.global.t("app.panel.agents");
  },
  get terminals() {
    return i18n.global.t("app.panel.terminals");
  },
  get services() {
    return i18n.global.t("app.panel.services");
  },
  get skill() {
    return i18n.global.t("app.panel.skill");
  },
  get errors() {
    return i18n.global.t("app.panel.errors");
  },
  get workflow() {
    return i18n.global.t("app.panel.workflow");
  },
  get external() {
    return i18n.global.t("app.panel.external");
  },
  get trace() {
    return i18n.global.t("trace.panelTitle");
  },
  get "side-chat"() {
    return i18n.global.t("sideChat.tabTitle");
  },
};

/**
 * 右侧工具栏 Tab：每种面板至多一个实例（新建后不能再建，只能关闭后再开）。
 * Tab 布局按工作区分桶：同一工作目录的会话共享右栏面板现场，
 * 切换工作区时暂存已开面板，切回时恢复。
 */
export const useRightPanelStore = defineStore("rightPanel", () => {
  const tabs = ref<RightPanelTab[]>([{ id: "files", kind: "files", title: PANEL_TITLES.files }]);
  const activeId = ref("files");
  /** 待定位文件路径：消息流点击文件名时设置，FilePanel 消费后清空 */
  const pendingReveal = ref("");
  /** 技能文档面板目标：输入框技能 tag 点击时设置（name 展示、dir 取文件） */
  const skillPreview = ref<{ name: string; dir: string } | null>(null);

  /** 单个工作区的右栏 Tab 布局（分桶快照） */
  interface PanelBucketState {
    tabs: RightPanelTab[];
    activeId: string;
  }

  const buckets = createSessionBuckets<PanelBucketState>({
    initial: () => ({ tabs: [{ id: "files", kind: "files", title: PANEL_TITLES.files }], activeId: "files" }),
    // 侧边对话 tab 属于某个主会话（见 bindSideChatScope），不进工作区快照
    capture: () => {
      const own = tabs.value.filter((item) => item.kind !== "side-chat");
      return {
        tabs: own,
        activeId: own.some((item) => item.id === activeId.value)
          ? activeId.value
          : (own[own.length - 1]?.id ?? "files"),
      };
    },
    restore: (state) => {
      tabs.value = state.tabs;
      activeId.value = state.activeId;
    },
  });

  /** 侧边对话 tab 按主会话分桶：切走会话暂存，切回恢复（关标签不动记录） */
  const sideChatBuckets = new Map<string, { tabs: RightPanelTab[]; activeId: string }>();
  const sideChatScope = ref("");

  /** 把当前会话的 side-chat tab 拼回标签条（工作区布局恢复后也调用） */
  function applySideChatTabs() {
    const saved = sideChatBuckets.get(sideChatScope.value);
    const kept = tabs.value.filter((item) => item.kind !== "side-chat");
    const next = [...kept, ...(saved?.tabs ?? [])];
    tabs.value = next;
    if (!next.some((item) => item.id === activeId.value)) {
      activeId.value =
        saved?.activeId && next.some((item) => item.id === saved.activeId)
          ? saved.activeId
          : (kept[kept.length - 1]?.id ?? next[0]?.id ?? "");
    }
  }

  /** 工作区切换（chat store 调用）：旧工作区 Tab 布局入桶，目标工作区恢复自己的面板 */
  function bindWorkspaceScope(workspaceId: string) {
    buckets.switchTo(workspaceId);
    applySideChatTabs();
  }

  /** 主会话切换（RightPanel 监听 chatStore.sessionId）：侧边对话 tab 跟着会话走 */
  function bindSideChatScope(sessionId: string) {
    const key = sessionId ?? "";
    if (key === sideChatScope.value) {
      return;
    }
    if (sideChatScope.value) {
      const own = tabs.value.filter((item) => item.kind === "side-chat");
      if (own.length || sideChatBuckets.has(sideChatScope.value)) {
        sideChatBuckets.set(sideChatScope.value, {
          tabs: own.map((item) => ({ ...item })),
          activeId: own.some((item) => item.id === activeId.value) ? activeId.value : "",
        });
      }
    }
    sideChatScope.value = key;
    applySideChatTabs();
  }

  const activeTab = computed(() => tabs.value.find((item) => item.id === activeId.value) ?? null);
  const kinds = computed(() => new Set(tabs.value.map((item) => item.kind)));

  function hasKind(kind: RightPanelKind) {
    return kinds.value.has(kind);
  }

  function activate(id: string) {
    if (tabs.value.some((item) => item.id === id)) {
      activeId.value = id;
    }
  }

  /** 打开（或创建）某类面板并切到它；已存在则只激活 */
  function ensureTab(kind: ManagedPanelKind) {
    const layout = useLayoutStore();
    if (layout.rightCollapsed) {
      layout.rightCollapsed = false;
    }
    const existing = tabs.value.find((item) => item.kind === kind);
    if (existing) {
      activeId.value = existing.id;
      return existing;
    }
    const tab: RightPanelTab = { id: kind, kind, title: PANEL_TITLES[kind] };
    tabs.value.push(tab);
    activeId.value = tab.id;
    return tab;
  }

  function closeTab(id: string) {
    if (tabs.value.length <= 1) {
      return;
    }
    const index = tabs.value.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }
    const closed = tabs.value[index];
    tabs.value.splice(index, 1);
    if (activeId.value === id) {
      activeId.value = tabs.value[Math.max(0, index - 1)].id;
    }
    // 关闭浏览器 tab 时立刻隐藏原生视图，避免残留页面盖住 UI
    if (closed?.kind === "browser") {
      void window.zen?.browser?.setBounds(null, false).catch(() => undefined);
    }
  }

  /** 打开文件面板并定位到指定文件（消息流内点击文件名） */
  function revealFile(path: string) {
    pendingReveal.value = path;
    ensureTab("files");
  }

  /** 打开技能文档面板并切到指定技能（输入框技能 tag 点击） */
  function openSkill(name: string, dir: string) {
    skillPreview.value = { name, dir };
    const tab = ensureTab("skill");
    tab.title = name;
    return tab;
  }

  /**
   * 打开某条侧边对话的记录标签并切到它：同一条记录只允许一个标签。
   * 关闭标签不删记录，历史菜单再调一次即可重开。
   */
  function ensureSideChat(record: { id: string; title: string }) {
    const layout = useLayoutStore();
    if (layout.rightCollapsed) {
      layout.rightCollapsed = false;
    }
    const id = sideChatTabId(record.id);
    const existing = tabs.value.find((item) => item.id === id);
    if (existing) {
      existing.title = record.title;
      activeId.value = id;
      return existing;
    }
    const tab: RightPanelTab = { id, kind: "side-chat", title: record.title };
    tabs.value.push(tab);
    activeId.value = id;
    return tab;
  }

  /** 关闭侧边对话标签（只关视图，记录不动） */
  function closeSideChat(recordId: string) {
    closeTab(sideChatTabId(recordId));
  }

  const sideChatTabIds = computed(() =>
    tabs.value.filter((item) => item.kind === "side-chat").map((item) => item.id),
  );

  return {
    tabs,
    activeId,
    pendingReveal,
    skillPreview,
    activeTab,
    kinds,
    sideChatTabIds,
    hasKind,
    activate,
    ensureTab,
    ensureSideChat,
    closeTab,
    closeSideChat,
    revealFile,
    openSkill,
    bindWorkspaceScope,
    bindSideChatScope,
  };
});
