import { ref } from "vue";

export interface ToastItem {
  id: number;
  kind: "ok" | "err" | "info";
  message: string;
}

/** 全局单例状态：Toaster 挂载一次即可收集全应用反馈 */
const toasts = ref<ToastItem[]>([]);
let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

/**
 * 轻量反馈：异步操作（提交/推送/保存等）的成功与失败提示。
 * 内联按钮自身的即时态反馈（如复制打勾）不在此列，仍走各自组件状态。
 */
export function toast(message: string, kind: ToastItem["kind"] = "info", ttl = 2600) {
  const id = ++seq;
  toasts.value = [...toasts.value, { id, kind, message }];
  if (ttl > 0) {
    timers.set(id, setTimeout(() => dismiss(id), ttl));
  }
  return id;
}

export function useToasts() {
  return { toasts, dismiss };
}

toast.ok = (message: string, ttl?: number) => toast(message, "ok", ttl);
toast.err = (message: string, ttl?: number) => toast(message, "err", ttl);
toast.info = (message: string, ttl?: number) => toast(message, "info", ttl);
