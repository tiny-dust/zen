import { computed } from "vue";

import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

/**
 * 当前会话绑定的工作区根（公共区/无绑定返回空串）。
 * 文件引用悬浮 title 绝对化、菜单绝对路径解析共用此基准。
 */
export function useSessionRoot() {
  return computed(() => {
    try {
      const chat = useChatStore();
      return useWorkspaceStore().pathOf(chat.sessionWorkspaceId) ?? "";
    } catch {
      // pinia 未就绪（如单测直挂组件）时退化为空根，调用方按原样展示
      return "";
    }
  });
}
