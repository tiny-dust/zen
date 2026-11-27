import { onBeforeUnmount, ref } from "vue";

/**
 * 长列表按视口懒挂载：元素第一次靠近视口才置为可见，之后保持挂载
 * （滚回去不重新解析内容）。observing 用元素自身，不额外包一层 DOM。
 */
export function useLazyReveal(margin = "800px") {
  const revealed = ref<Set<string>>(new Set());
  let observer: IntersectionObserver | null = null;

  function ensureObserver(): IntersectionObserver {
    observer ??= new IntersectionObserver(
      (entries) => {
        let next: Set<string> | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const key = (entry.target as HTMLElement).dataset.lazyKey;
          if (!key) {
            continue;
          }
          next ??= new Set(revealed.value);
          next.add(key);
          observer?.unobserve(entry.target);
        }
        if (next) {
          revealed.value = next;
        }
      },
      { rootMargin: margin },
    );
    return observer;
  }

  /** 模板里当 ref 用：v-for 元素首次出现时登记进出视口观察 */
  function observe(el: Element | null, key: string) {
    if (!el || revealed.value.has(key)) {
      return;
    }
    const target = el as HTMLElement;
    if (target.dataset.lazyKey === key) {
      return;
    }
    target.dataset.lazyKey = key;
    ensureObserver().observe(target);
  }

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { revealed, observe };
}
