import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { useLayoutStore } from "@/stores/layout";

export type RightPanelKind = "files" | "browser" | "changes" | "graph";

export interface RightPanelTab {
  id: string;
  kind: RightPanelKind;
  title: string;
}

const TITLE: Record<RightPanelKind, string> = {
  files: "文件",
  browser: "浏览器",
  changes: "变更",
  graph: "图谱",
};

/**
 * 右侧工具栏 Tab：每种面板至多一个实例（新建后不能再建，只能关闭后再开）。
 */
export const useRightPanelStore = defineStore("rightPanel", () => {
  const tabs = ref<RightPanelTab[]>([{ id: "files", kind: "files", title: TITLE.files }]);
  const activeId = ref("files");
  /** 待定位文件路径：消息流点击文件名时设置，FilePanel 消费后清空 */
  const pendingReveal = ref("");

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
  function ensureTab(kind: RightPanelKind) {
    const layout = useLayoutStore();
    if (layout.rightCollapsed) {
      layout.rightCollapsed = false;
    }
    const existing = tabs.value.find((item) => item.kind === kind);
    if (existing) {
      activeId.value = existing.id;
      return existing;
    }
    const tab: RightPanelTab = { id: kind, kind, title: TITLE[kind] };
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

  return {
    tabs,
    activeId,
    pendingReveal,
    activeTab,
    kinds,
    hasKind,
    activate,
    ensureTab,
    closeTab,
    revealFile,
  };
});
