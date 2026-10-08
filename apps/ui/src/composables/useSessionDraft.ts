import { watch } from "vue";

import type { Ref } from "vue";

import type { ComposerElementMark } from "@/lib/browser-element";
import { serializeSessionDraft } from "@/lib/session-draft";
import type { ComposerAttachment } from "@/stores/chat-types";

/** composer 草稿三件套：正文 + 附件 + 浏览器标注，一起落库一起恢复 */
export interface SessionDraftSources {
  input: Ref<string>;
  attachments: Ref<ComposerAttachment[]>;
  elementMarks: Ref<ComposerElementMark[]>;
}

/**
 * 输入草稿随输随存：防抖 400ms 落库，切换会话回来可恢复。
 * 载荷含附件与标注（serializeSessionDraft），空状态落空串清掉旧草稿。
 * flushDraft 在切换/新建会话前同步调用，避免丢掉最后一次输入。
 */
export function useSessionDraft(state: SessionDraftSources, sessionId: Ref<string>) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function persistDraft() {
    const zen = window.zen;
    if (!zen || !sessionId.value) {
      return;
    }
    const payload = serializeSessionDraft({
      text: state.input.value,
      attachments: state.attachments.value,
      elementMarks: state.elementMarks.value,
    });
    void zen.session.setDraft(sessionId.value, payload);
  }

  // 附件/标注多为原地增删（push/filter），deep 才能捕获；空状态也落库（清残留）
  watch([state.input, state.attachments, state.elementMarks], schedulePersist, {
    deep: true,
  });

  function schedulePersist() {
    clearTimeout(timer);
    timer = setTimeout(persistDraft, 400);
  }

  function flushDraft() {
    clearTimeout(timer);
    persistDraft();
  }

  return { flushDraft };
}
