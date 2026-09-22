import { type ClassValue, clsx } from "clsx";
import { toRaw } from "vue";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 深拷贝为可结构化克隆的纯对象。
 * Vue 响应式 Proxy / reactive Set 走 Electron IPC 会抛 "An object could not be cloned"。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T;
}
