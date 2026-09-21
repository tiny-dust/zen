import { uuid } from "rattail";
import type { Ref } from "vue";
import { ref } from "vue";

import type { BrowserElementRef } from "@zen/shared";

import { createElementMark } from "@/lib/browser-element";
import type { ComposerElementMark } from "@/lib/browser-element";
import { useAgentStore } from "@/stores/agent";
import type { ComposerAttachment, SelectedSkill } from "@/stores/chat-types";

/** 输入框域的依赖：正文与附件由 chat store 持有 */
export interface ComposerDomainOptions {
  input: Ref<string>;
  attachments: Ref<ComposerAttachment[]>;
}

/**
 * Composer 本地域：附件、浏览器标注元素、技能 token 解析、外部插入载荷。
 * 只管输入框侧的状态，发送与运行控制留在 chat store。
 */
export function createComposerDomain(options: ComposerDomainOptions) {
  const { input, attachments } = options;
  /** 浏览器标注元素：正文内 `$el:id` 链接 + tooltip 明细 */
  const elementMarks = ref<ComposerElementMark[]>([]);
  let elementSeq = 0;
  /** 外部模块请求「插入到 composer 光标处」的载荷（浏览器标注等） */
  const pendingComposerInsert = ref<{ text: string; id: number } | null>(null);

  function addAttachment(file: File, path: string) {
    attachments.value.push({
      id: uuid(),
      name: file.name,
      path,
      size: file.size,
      isImage: file.type.startsWith("image/"),
    });
  }

  function removeAttachment(id: string) {
    attachments.value = attachments.value.filter((item) => item.id !== id);
  }

  /** 正文里的内联技能 token（/skill:名称）→ SelectedSkill（发送时进 meta.skills 渲染 tag） */
  function extractSkills(text: string): SelectedSkill[] {
    const known = useAgentStore().skills;
    const found: SelectedSkill[] = [];
    for (const match of text.matchAll(/\/skill:([^\s/]+)/g)) {
      const name = match[1] ?? "";
      if (!name || found.some((item) => item.name === name)) {
        continue;
      }
      const info = known.find((item) => item.name === name);
      found.push({
        name,
        description: info?.description ?? "",
        dir: info?.dir,
        source: info?.source,
      });
    }
    return found;
  }

  function insertAtComposerCaret(text: string) {
    if (!text) {
      return;
    }
    pendingComposerInsert.value = { text, id: Date.now() };
  }

  /** 浏览器标注：登记元素并以 `$el:标签` tag 插入光标处 */
  function insertBrowserElement(elementRef: BrowserElementRef) {
    elementSeq += 1;
    const used = new Set(elementMarks.value.map((item) => item.label));
    const mark = createElementMark(elementRef, elementSeq, used);
    elementMarks.value = [...elementMarks.value, mark];
    insertAtComposerCaret(`${mark.token} `);
    return mark;
  }

  function removeElementMark(id: string) {
    const mark = elementMarks.value.find((item) => item.id === id);
    elementMarks.value = elementMarks.value.filter((item) => item.id !== id);
    if (mark && input.value.includes(mark.token)) {
      input.value = input.value.split(mark.token).join("").replace(/\s{2,}/g, " ");
    }
  }

  return {
    elementMarks,
    pendingComposerInsert,
    addAttachment,
    removeAttachment,
    extractSkills,
    insertAtComposerCaret,
    insertBrowserElement,
    removeElementMark,
  };
}
