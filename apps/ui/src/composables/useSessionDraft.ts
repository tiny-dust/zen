import { watch } from "vue";

import type { Ref } from "vue";

/**
 * 输入草稿随输随存：防抖 400ms 落库，切换会话回来可恢复。
 * flushDraft 在切换/新建会话前同步调用，避免丢掉最后一次输入。
 */
export function useSessionDraft(input: Ref<string>, sessionId: Ref<string>) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(input, (value) => {
    const zen = window.zen;
    if (!zen || !sessionId.value) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      void zen.session.setDraft(sessionId.value, value);
    }, 400);
  });

  function flushDraft() {
    const zen = window.zen;
    clearTimeout(timer);
    if (zen && sessionId.value) {
      void zen.session.setDraft(sessionId.value, input.value);
    }
  }

  return { flushDraft };
}
