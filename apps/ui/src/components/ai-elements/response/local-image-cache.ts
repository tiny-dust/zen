import { reactive } from "vue";

import { localPathFromMarker } from "@/components/ai-elements/response/local-file-links";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

/**
 * markdown 本地图片加载缓存：key = 工作区 root + 原始引用。
 * ResponseImage 渲染 marker src 时查缓存，命中前显示占位，取回后自动刷新。
 */
const cache = reactive(new Map<string, string | null>());

function cacheKey(rawRef: string, cwd: string | undefined): string {
  return `${cwd ?? ""}::${rawRef}`;
}

/** 触发一次加载（幂等）；加载完成/失败写入缓存并触发依赖刷新 */
export function ensureLocalImage(rawRef: string, cwd: string | undefined): string | null {
  const key = cacheKey(rawRef, cwd);
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }
  cache.set(key, null);
  const zen = window.zen;
  if (!zen) {
    return null;
  }
  void zen.workspace
    .previewFile(cwd, rawRef)
    .then((preview) => {
      cache.set(key, preview?.kind === "image" ? preview.dataUrl : null);
    })
    .catch(() => {
      cache.set(key, null);
    });
  return null;
}

/** 当前缓存的 data URL（未取回/不可读为 null） */
export function cachedLocalImage(src: string | undefined): string | null {
  const rawRef = localPathFromMarker(src);
  if (!rawRef) {
    return null;
  }
  const workspaceStore = useWorkspaceStore();
  const chatStore = useChatStore();
  const cwd = workspaceStore.pathOf(chatStore.sessionWorkspaceId);
  return ensureLocalImage(rawRef, cwd);
}
