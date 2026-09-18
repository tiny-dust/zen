<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";

import type { ComposerAttachment } from "@/stores/chat-types";

const props = defineProps<{
  modelValue: string;
  /** 已添加的附件：正文里 `$文件名` 会被渲染成可悬浮的引用 token */
  attachments: ComposerAttachment[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "tokenHover", attachmentId: string | null): void;
}>();

const editorEl = ref<HTMLDivElement | null>(null);
/** IME 组合期间跳过重渲染，避免打断中文输入 */
let composing = false;

// ---------- 源文本模型：DOM 的 textContent 即 markdown 源文本，装饰只改样式不改字符 ----------

type SegmentKind = "text" | "bold" | "link" | "marker" | "token";

interface Segment {
  kind: SegmentKind;
  text: string;
  attachmentId?: string;
}

interface MarkedRange {
  start: number;
  end: number;
  segment: Segment;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

/** token 内联图标（lucide 线稿路径，自绘 SVG 显式 fill/stroke，线宽对齐 --icon-stroke） */
const ICON_IMAGE =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
const ICON_FILE =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isImageName(name: string): boolean {
  return IMAGE_EXT.has(extOf(name));
}

function overlaps(marked: MarkedRange[], start: number, end: number): boolean {
  return marked.some((range) => start < range.end && end > range.start);
}

/** 把 source 解析成装饰分段：token（附件引用）> 行首清单标记 > 加粗 > 链接，其余为纯文本 */
function parseSegments(source: string): Segment[] {
  const marked: MarkedRange[] = [];

  // 附件引用 token：`$文件名`（长名优先，避免同名前缀互相吞并）
  const attachments = [...props.attachments].sort((a, b) => b.name.length - a.name.length);
  for (const att of attachments) {
    const needle = `$${att.name}`;
    let from = 0;
    for (;;) {
      const index = source.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      const end = index + needle.length;
      if (!overlaps(marked, index, end)) {
        marked.push({
          start: index,
          end,
          segment: { kind: "token", text: needle, attachmentId: att.id },
        });
      }
      from = index + 1;
    }
  }

  scanMarkdown(source, marked);

  marked.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of marked) {
    if (range.start > cursor) {
      segments.push({ kind: "text", text: source.slice(cursor, range.start) });
    }
    segments.push(range.segment);
    cursor = range.end;
  }
  if (cursor < source.length) {
    segments.push({ kind: "text", text: source.slice(cursor) });
  }
  return segments;
}

/** 在源文本上扫描 markdown 装饰（与 token 区间重叠的丢弃） */
function scanMarkdown(source: string, marked: MarkedRange[]): void {
  const mark = (start: number, end: number, segment: Segment) => {
    if (!overlaps(marked, start, end)) {
      marked.push({ start, end, segment });
    }
  };

  // 清单标记：行首的 - / * / 1.（含缩进），只弱化标记符本身
  const markerRe = /^[ \t]*([-*+]|\d+\.)[ \t]/gm;
  for (;;) {
    const match = markerRe.exec(source);
    if (!match || !match[1]) {
      break;
    }
    const markerText = match[1];
    // match[0] = 缩进 + 标记符 + 一个空白；标记符起点从行尾往回推
    const start = match.index + match[0].length - markerText.length - 1;
    mark(start, start + markerText.length, { kind: "marker", text: markerText });
  }

  // 加粗：**文字**
  const boldRe = /\*\*([^*\n]+)\*\*/g;
  for (;;) {
    const match = boldRe.exec(source);
    if (!match) {
      break;
    }
    mark(match.index, match.index + match[0].length, { kind: "bold", text: match[0] });
  }

  // 链接：[文字](url)
  const linkRe = /\[([^\]\n]+)\]\(([^()\s]+)\)/g;
  for (;;) {
    const match = linkRe.exec(source);
    if (!match) {
      break;
    }
    mark(match.index, match.index + match[0].length, { kind: "link", text: match[0] });
  }
}

// ---------- 渲染：按分段构建 DOM（手动建节点，scoped 样式命中不了，用 composer- 前缀全局类） ----------

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function renderBold(text: string): HTMLElement {
  const wrapper = el("span", "composer-md-bold");
  wrapper.append(
    el("span", "composer-md-mark", "**"),
    el("span", "composer-md-bold-text", text.slice(2, -2)),
    el("span", "composer-md-mark", "**"),
  );
  return wrapper;
}

function renderLink(text: string): HTMLElement {
  const match = /^\[([^\]]+)\]\(([^()]*)\)$/.exec(text);
  if (!match || !match[1]) {
    return el("span", "composer-md-link-label", text);
  }
  const wrapper = el("span", "composer-md-link");
  wrapper.append(
    el("span", "composer-md-mark", "["),
    el("span", "composer-md-link-label", match[1]),
    el("span", "composer-md-mark", "]("),
    el("span", "composer-md-url", match[2] ?? ""),
    el("span", "composer-md-mark", ")"),
  );
  return wrapper;
}

function renderToken(segment: Segment): HTMLElement {
  const att = props.attachments.find((item) => item.id === segment.attachmentId);
  const name = att?.name ?? segment.text.slice(1);
  const token = el("span", "composer-token");
  token.contentEditable = "false";
  if (segment.attachmentId) {
    token.dataset.attachmentId = segment.attachmentId;
  }
  const icon = el("span", "composer-token-icon");
  icon.innerHTML = isImageName(name) ? ICON_IMAGE : ICON_FILE;
  token.append(el("span", "composer-md-mark", "$"), icon, el("span", "composer-token-name", name));
  token.addEventListener("mouseenter", () => emit("tokenHover", segment.attachmentId ?? null));
  token.addEventListener("mouseleave", () => emit("tokenHover", null));
  return token;
}

function renderSegments(segments: Segment[]): Node[] {
  return segments.map((segment) => {
    switch (segment.kind) {
      case "bold":
        return renderBold(segment.text);
      case "link":
        return renderLink(segment.text);
      case "marker":
        return el("span", "composer-md-marker", segment.text);
      case "token":
        return renderToken(segment);
      default:
        return document.createTextNode(segment.text);
    }
  });
}

// ---------- 光标：以「源文本偏移」为唯一坐标，重渲染前后互相换算 ----------

function currentSource(): string {
  return editorEl.value?.textContent ?? "";
}

function caretOffset(): number {
  const el = editorEl.value;
  const selection = window.getSelection();
  if (!el || !selection || selection.rangeCount === 0) {
    return currentSource().length;
  }
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) {
    return currentSource().length;
  }
  const probe = document.createRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
}

function setCaretAt(offset: number): void {
  const el = editorEl.value;
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
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      range.setStart(node, remaining);
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

/** 全量重渲染（装饰不改字符，重渲染后按偏移恢复光标） */
function render(source: string, caret: number | null): void {
  const el = editorEl.value;
  if (!el) {
    return;
  }
  el.replaceChildren(...renderSegments(parseSegments(source)));
  if (caret !== null) {
    setCaretAt(caret);
  }
}

/** 改写源文本并同步到 v-model */
function applySource(source: string, caret: number): void {
  emit("update:modelValue", source);
  render(source, caret);
}

function insertSourceAt(offset: number, text: string): void {
  const el = editorEl.value;
  if (!el || !text) {
    return;
  }
  const source = currentSource();
  const safe = Math.min(Math.max(offset, 0), source.length);
  if (!props.disabled) {
    el.focus();
  }
  applySource(source.slice(0, safe) + text + source.slice(safe), safe + text.length);
}

// ---------- 事件 ----------

function onInput(): void {
  const source = currentSource();
  emit("update:modelValue", source);
  if (!composing) {
    render(source, caretOffset());
  }
}

function onCompositionStart(): void {
  composing = true;
}

function onCompositionEnd(): void {
  composing = false;
  render(currentSource(), caretOffset());
}

/** Enter 换行 / 粘贴 / 拖文本统一收口为纯文本 \n 插入，防止 contenteditable 产生结构化节点 */
function onBeforeInput(event: InputEvent): void {
  const el = editorEl.value;
  if (!el || props.disabled) {
    return;
  }
  if (event.inputType === "insertParagraph") {
    // 普通 Enter 在 ChatComposer 拦截为发送；Shift+Enter 走到这里换行
    event.preventDefault();
    insertSourceAt(caretOffset(), "\n");
    return;
  }
  if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") {
    const transfer = event.dataTransfer;
    const text = transfer?.files?.length ? "" : (transfer?.getData("text/plain") ?? "");
    event.preventDefault();
    if (text) {
      insertSourceAt(caretOffset(), text);
    }
  }
}

watch(
  () => props.modelValue,
  (value) => {
    if (value === currentSource()) {
      return;
    }
    const focused = editorEl.value !== null && document.activeElement === editorEl.value;
    render(value, focused ? value.length : null);
  },
);

onMounted(() => {
  render(props.modelValue, null);
});

defineExpose({
  focus: () => {
    editorEl.value?.focus();
  },
  caretOffset,
  /** 在下一次重渲染完成后设置光标（供 setValue 之后的落点） */
  setCaretSoon: (offset: number) => {
    void nextTick(() => setCaretAt(offset));
  },
  /** 在光标处插入源文本 */
  insertAtCaret: (text: string) => {
    insertSourceAt(caretOffset(), text);
  },
  /**
   * 在窗口坐标处插入源文本（拖放落点）；坐标不在编辑器内时返回 false
   */
  insertAtPoint: (x: number, y: number, text: string): boolean => {
    const el = editorEl.value;
    if (!el || props.disabled || !text) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      return false;
    }
    const range = document.caretRangeFromPoint(x, y);
    if (!range || !el.contains(range.startContainer)) {
      return false;
    }
    const probe = document.createRange();
    probe.selectNodeContents(el);
    probe.setEnd(range.startContainer, range.startOffset);
    insertSourceAt(probe.toString().length, text);
    return true;
  },
});
</script>

<template>
  <!-- contenteditable 富输入：textContent 即源文本，md 语法与附件引用在渲染层装饰 -->
  <div
    ref="editorEl"
    class="composer-editor max-h-[220px] min-h-[44px] w-full overflow-y-auto text-[14px] leading-relaxed text-[var(--color-txt-strong)]"
    :contenteditable="disabled ? 'false' : 'true'"
    :data-placeholder="placeholder"
    :data-disabled="disabled ? 'true' : undefined"
    role="textbox"
    aria-multiline="true"
    :aria-label="placeholder"
    spellcheck="false"
    @input="onInput"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
    @beforeinput="onBeforeInput"
  ></div>
</template>

<!-- 动态创建的节点拿不到 scoped data-v，这里用 composer- 前缀类做组件级隔离 -->
<style>
.composer-editor {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  user-select: text;
  outline: none;
  cursor: text;
}

.composer-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--color-composer-placeholder);
  pointer-events: none;
}

.composer-editor[data-disabled="true"] {
  opacity: 0.55;
  cursor: default;
}

/* md 语法标记：字符保留（源文本不变），仅视觉弱化/隐藏 */
.composer-md-mark {
  color: transparent;
}

.composer-md-marker {
  color: var(--color-dim);
}

.composer-md-bold-text {
  font-weight: 600;
  color: var(--color-txt-strong);
}

.composer-md-link-label {
  color: var(--color-link);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--color-link) 45%, transparent);
  text-underline-offset: 2px;
}

.composer-md-url {
  color: var(--color-dim);
}

/* 附件引用 token：蓝色链接样式 + 文件图标 */
.composer-token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 1px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-chip-bg);
  color: var(--color-link);
  font-size: 12px;
  line-height: 18px;
  vertical-align: baseline;
  cursor: default;
}

.composer-token:hover .composer-token-name {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.composer-token-icon {
  display: inline-flex;
  flex: none;
}
</style>
