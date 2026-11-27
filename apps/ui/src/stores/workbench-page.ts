import { defineStore } from "pinia";
import { computed, ref } from "vue";

/**
 * 轨道分类入口 → 内容区整页（对齐 nomi：点分类在内容区切页，不弹窗）。
 * 单值状态即单一真源：同时只有一个整页打开，`chat` 表示回到对话。
 */
export type WorkbenchPage =
  | "chat"
  | "fleet"
  | "scheduler"
  | "skills"
  | "mcp"
  | "features"
  | "inbox"
  | "tasks"
  | "settings";

export const useWorkbenchPageStore = defineStore("workbenchPage", () => {
  const page = ref<WorkbenchPage>("chat");

  const isChat = computed(() => page.value === "chat");
  const isOpen = (target: WorkbenchPage) => page.value === target;

  function open(next: WorkbenchPage) {
    page.value = next;
  }

  function close() {
    page.value = "chat";
  }

  /** 再点同一个分类回到对话（与 nomi 的分类入口一致） */
  function toggle(next: WorkbenchPage) {
    page.value = page.value === next ? "chat" : next;
  }

  return { page, isChat, isOpen, open, close, toggle };
});
