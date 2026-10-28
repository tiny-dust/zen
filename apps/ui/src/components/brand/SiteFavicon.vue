<script setup lang="ts">
import { ref, watch } from "vue";

import { siteOrigin } from "@/lib/site-url";

/**
 * 站点图标：浏览器历史 / 网络搜索来源左侧的小图标。
 *
 * 渲染层 CSP 不放行外域图片，所以图标由主进程抓取成 data URL（带磁盘缓存）；
 * 取不到时渲染默认插槽（字母徽标 / Globe），列表不会因为图标缺失而空一块。
 * origin 级别缓存 + 最多 3 个并发：一次打开几十条历史不会同时打几十个请求。
 */

const props = withDefaults(
  defineProps<{
    url: string;
    /** 图标边长（px）：历史卡片 16，参考列表 12 */
    size?: number;
  }>(),
  { size: 16 },
);

/** origin → dataUrl（null = 取不到）；模块级共享，重渲染/切面板不重复请求 */
const resolved = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

const MAX_PARALLEL = 3;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function loadFavicon(origin: string): Promise<string | null> {
  const zen = window.zen;
  if (!zen?.browser?.favicon) {
    return Promise.resolve(null);
  }
  return withSlot(() => zen.browser.favicon(origin).catch(() => null));
}

const src = ref<string | null>(null);

watch(
  () => props.url,
  (url) => {
    const origin = siteOrigin(url);
    if (!origin) {
      src.value = null;
      return;
    }
    if (resolved.has(origin)) {
      src.value = resolved.get(origin) ?? null;
      return;
    }
    let task = pending.get(origin);
    if (!task) {
      task = loadFavicon(origin).then((value) => {
        resolved.set(origin, value);
        pending.delete(origin);
        return value;
      });
      pending.set(origin, task);
    }
    void task.then((value) => {
      // 等待期间换了站点：丢弃过期结果
      if (siteOrigin(props.url) === origin) {
        src.value = value;
      }
    });
  },
  { immediate: true },
);
</script>

<template>
  <img
    v-if="src"
    :src="src"
    alt=""
    aria-hidden="true"
    class="flex-none rounded-[3px] object-contain"
    decoding="async"
    referrerpolicy="no-referrer"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
  <slot v-else />
</template>
