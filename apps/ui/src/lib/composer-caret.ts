// ComposerEditor 的光标/选区计算：以「源文本偏移」为唯一坐标，在 DOM 与偏移之间互相换算。
// 全部函数以编辑器元素为参数，不持有组件状态。

export function sourceText(el: HTMLElement | null): string {
  return el?.textContent ?? "";
}

/** 光标（或选区锚点）对应的源文本偏移；不在编辑器内时返回源文本长度 */
export function caretOffsetIn(el: HTMLElement | null): number {
  const selection = window.getSelection();
  if (!el || !selection || selection.rangeCount === 0) {
    return sourceText(el).length;
  }
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) {
    return sourceText(el).length;
  }
  const probe = document.createRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
}

/** 把光标放到源文本偏移处；偏移落在 token 内时吸附到 token 前后，非聚焦时不抢选区 */
export function setCaretAt(el: HTMLElement | null, offset: number): void {
  const selection = window.getSelection();
  if (!el || !selection) {
    return;
  }
  // 非聚焦时不抢选区（外部 setValue 场景）
  if (document.activeElement !== el) {
    return;
  }
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node.parentElement?.closest(".composer-token")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeType === Node.TEXT_NODE || (node instanceof Element && node.matches(".composer-token"))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      if (node instanceof Element && node.matches(".composer-token")) {
        if (remaining <= length / 2) {
          range.setStartBefore(node);
        } else {
          range.setStartAfter(node);
        }
      } else {
        range.setStart(node, remaining);
      }
      placed = true;
      break;
    }
    remaining -= length;
  }
  if (!placed) {
    range.setStart(el, el.childNodes.length);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 当前选区在源文本上的起止偏移；选区不在编辑器内时起止相同 */
export function selectionOffsetsIn(el: HTMLElement | null): { start: number; end: number } {
  const start = caretOffsetIn(el);
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !el?.contains(range.endContainer)) {
    return { start, end: start };
  }
  const probe = document.createRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.endContainer, range.endOffset);
  return { start, end: probe.toString().length };
}
