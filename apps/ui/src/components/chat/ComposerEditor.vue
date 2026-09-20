<script setup lang="ts">
import { Globe, Sparkles } from "@lucide/vue";
import { h, nextTick, onBeforeUnmount, onMounted, ref, render as renderVue, watch } from "vue";

import FileLabel from "@/components/files/FileLabel.vue";
import { formatElementDetail } from "@/lib/browser-element";

import type { ComposerAttachment } from "@/stores/chat-types";
import type { ComposerElementMark } from "@/lib/browser-element";

const props = defineProps<{
  modelValue: string;
  /** 已添加的附件：正文里 `$文件名` 会被渲染成可悬浮的引用 token */
  attachments: ComposerAttachment[];
  /** 浏览器标注元素：正文里 `$el:id` 渲染为链接 chip，title/明细见 tooltip */
  elements?: ComposerElementMark[];
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

type SegmentKind = "text" | "bold" | "link" | "marker" | "token" | "skill";

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

const vueContainers: HTMLElement[] = [];

function unmountTokenViews(): void {
  for (const container of vueContainers) {
    renderVue(null, container);
  }
  vueContainers.length = 0;
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

  // 技能 token：`/skill:名称`（从 / 弹窗选中后内联在正文里）
  const skillRe = /\/skill:[^\s/]+/g;
  for (;;) {
    const match = skillRe.exec(source);
    if (!match || !match[0]) {
      break;
    }
    if (!overlaps(marked, match.index, match.index + match[0].length)) {
      marked.push({
        start: match.index,
        end: match.index + match[0].length,
        segment: { kind: "skill", text: match[0] },
      });
    }
  }

  // 浏览器标注元素：`$el:id`（长 token 优先）
  const elements = [...(props.elements ?? [])].sort((a, b) => b.token.length - a.token.length);
  for (const item of elements) {
    const needle = item.token;
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
          segment: { kind: "token", text: needle, attachmentId: item.id },
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

/** 页面元素 tag：与技能同构 —— 地球 icon + 名称；源文本保留 `$el:名称` 供 Agent 展开 */
function renderElementToken(mark: ComposerElementMark): HTMLElement {
  const token = el("span", "composer-token composer-token-skill composer-token-element");
  token.contentEditable = "false";
  token.dataset.elementId = mark.id;
  token.setAttribute("aria-label", `页面元素 ${mark.label}`);
  token.setAttribute("role", "button");
  token.tabIndex = -1;
  const icon = el("span", "composer-token-icon");
  renderVue(h(Globe, { size: 12, "aria-hidden": "true" }), icon);
  vueContainers.push(icon);
  // prefix 仅存在于 textContent（display:none），视觉上只有 icon + 名称
  token.append(
    el("span", "composer-token-prefix", "$el:"),
    icon,
    el("span", "composer-token-name", mark.label),
  );
  token.addEventListener("mouseenter", (event) => {
    emit("tokenHover", mark.id);
    showElementTooltip(token, mark);
  });
  token.addEventListener("mouseleave", () => {
    emit("tokenHover", null);
    hideElementTooltip();
  });
  return token;
}

/* ---------- 元素 tag 悬浮明细 ---------- */

let tooltipEl: HTMLElement | null = null;
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

function ensureTooltipEl(): HTMLElement {
  if (tooltipEl && document.body.contains(tooltipEl)) {
    return tooltipEl;
  }
  tooltipEl = document.createElement("div");
  tooltipEl.className = "composer-el-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function showElementTooltip(token: HTMLElement, mark: ComposerElementMark) {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
  }
  tooltipTimer = setTimeout(() => {
    const tip = ensureTooltipEl();
    const detail = formatElementDetail(mark.ref);
    tip.innerHTML = "";
    const title = document.createElement("div");
    title.className = "composer-el-tooltip-title";
    title.textContent = mark.label;
    tip.appendChild(title);
    for (const line of detail.split("\n")) {
      const row = document.createElement("div");
      row.className = "composer-el-tooltip-row";
      row.textContent = line;
      tip.appendChild(row);
    }
    tip.style.display = "block";
    const rect = token.getBoundingClientRect();
    const tipW = 280;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + tipW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - tipW - 8);
    }
    if (top + 140 > window.innerHeight) {
      top = Math.max(8, rect.top - 8 - 120);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, 120);
}

function hideElementTooltip() {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  if (tooltipEl) {
    tooltipEl.style.display = "none";
  }
}

function renderToken(segment: Segment): HTMLElement {
  const mark = (props.elements ?? []).find(
    (item) => item.token === segment.text || item.id === segment.attachmentId,
  );
  if (mark) {
    return renderElementToken(mark);
  }

  const att = props.attachments.find((item) => item.id === segment.attachmentId);
  const name = att?.name ?? segment.text.slice(1);
  const token = el("span", "composer-token composer-token-file");
  token.contentEditable = "false";
  if (segment.attachmentId) {
    token.dataset.attachmentId = segment.attachmentId;
  }
  const label = el("span", "composer-token-name");
  renderVue(h(FileLabel, { path: att?.path ?? name, name, variant: "link" }), label);
  vueContainers.push(label);
  token.append(el("span", "composer-token-prefix", "$"), label);
  token.addEventListener("mouseenter", () => emit("tokenHover", segment.attachmentId ?? null));
  token.addEventListener("mouseleave", () => emit("tokenHover", null));
  return token;
}

/** 前缀保留在 textContent 中，但不参与 token 的布局。 */
function renderSkillToken(text: string): HTMLElement {
  const name = text.slice("/skill:".length);
  const token = el("span", "composer-token composer-token-skill");
  token.contentEditable = "false";
  token.title = `技能：${name}`;
  const icon = el("span", "composer-token-icon");
  renderVue(h(Sparkles, { size: 12, "aria-hidden": "true" }), icon);
  vueContainers.push(icon);
  token.append(
    el("span", "composer-token-prefix", "/skill:"),
    icon,
    el("span", "composer-token-name", name),
  );
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
      case "skill":
        return renderSkillToken(segment.text);
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

/** 全量重渲染（装饰不改字符，重渲染后按偏移恢复光标） */
function render(source: string, caret: number | null): void {
  const el = editorEl.value;
  if (!el) {
    return;
  }
  unmountTokenViews();
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

function tokenBoundary(offset: number, edge: "start" | "end" | "nearest"): number {
  let start = 0;
  for (const segment of parseSegments(currentSource())) {
    const end = start + segment.text.length;
    if ((segment.kind === "token" || segment.kind === "skill") && offset > start && offset < end) {
      return edge === "start" || (edge === "nearest" && offset - start <= end - offset) ? start : end;
    }
    start = end;
  }
  return offset;
}

function selectionOffsets(): { start: number; end: number } {
  const start = caretOffset();
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editorEl.value?.contains(range.endContainer)) {
    return { start, end: start };
  }
  const probe = document.createRange();
  probe.selectNodeContents(editorEl.value);
  probe.setEnd(range.endContainer, range.endOffset);
  return { start, end: probe.toString().length };
}

function insertSourceAt(offset: number, text: string, replaceSelection = false): void {
  const el = editorEl.value;
  if (!el || !text || props.disabled || composing) {
    return;
  }
  const source = currentSource();
  const selected = selectionOffsets();
  const hasSelection = replaceSelection && selected.start !== selected.end;
  const safe = tokenBoundary(Math.min(Math.max(offset, 0), source.length), hasSelection ? "start" : "nearest");
  const end = hasSelection ? tokenBoundary(selected.end, "end") : safe;
  el.focus();
  applySource(source.slice(0, safe) + text + source.slice(end), safe + text.length);
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
  onInput();
}

/** Enter 换行 / 粘贴 / 拖文本统一收口为纯文本 \n 插入，防止 contenteditable 产生结构化节点 */
function onBeforeInput(event: InputEvent): void {
  const el = editorEl.value;
  if (!el || props.disabled || composing || event.isComposing) {
    return;
  }
  const selected = selectionOffsets();
  const start = tokenBoundary(selected.start, "start");
  const end = tokenBoundary(selected.end, "end");
  if (event.inputType.startsWith("delete")) {
    let from = start;
    let to = end;
    if (selected.start === selected.end && start === selected.start && end === selected.end) {
      from = event.inputType === "deleteContentBackward" ? tokenBoundary(start - 1, "start") : start;
      to = event.inputType === "deleteContentForward" ? tokenBoundary(end + 1, "end") : end;
    }
    const partialToken = start !== selected.start || end !== selected.end;
    const adjacentToken = selected.start === selected.end && to - from > 1;
    if (partialToken || adjacentToken) {
      event.preventDefault();
      const source = currentSource();
      applySource(source.slice(0, Math.max(0, from)) + source.slice(to), Math.max(0, from));
      return;
    }
  }
  if (event.inputType === "insertText" && event.data && (start !== selected.start || end !== selected.end)) {
    event.preventDefault();
    insertSourceAt(selected.start, event.data, true);
    return;
  }
  if (event.inputType === "insertParagraph") {
    // 普通 Enter 在 ChatComposer 拦截为发送；Shift+Enter / Cmd+Enter 走到这里换行
    event.preventDefault();
    insertSourceAt(caretOffset(), "\n", true);
    return;
  }
  if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") {
    const transfer = event.dataTransfer;
    const text = transfer?.files?.length ? "" : (transfer?.getData("text/plain") ?? "");
    event.preventDefault();
    if (text) {
      insertSourceAt(caretOffset(), text, true);
    }
  }
}

watch(
  () => props.modelValue,
  (value) => {
    if (composing || value === currentSource()) {
      return;
    }
    const focused = editorEl.value !== null && document.activeElement === editorEl.value;
    render(value, focused ? value.length : null);
  },
);

watch(() => props.attachments, () => {
  if (!composing) {
    render(currentSource(), caretOffset());
  }
}, { deep: true });

onMounted(() => {
  render(props.modelValue, null);
});

// 元素列表变化（标注插入/删除）后重渲染，保证 tag 立刻出现
watch(
  () => props.elements,
  () => {
    if (!composing) {
      render(currentSource(), caretOffset());
    }
  },
  { deep: true },
);

onBeforeUnmount(() => {
  hideElementTooltip();
  if (tooltipEl?.parentElement) {
    tooltipEl.parentElement.removeChild(tooltipEl);
  }
  tooltipEl = null;
  unmountTokenViews();
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
    insertSourceAt(caretOffset(), text, true);
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
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-chip-bg);
  color: var(--color-link);
  font-size: 12px;
  line-height: 18px;
  vertical-align: text-bottom;
  cursor: default;
}

.composer-token-prefix {
  display: none;
}

.composer-token-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-token-file {
  padding: 0;
  background: none;
  border-radius: 0;
}

.composer-token-file .composer-token-name {
  display: inline-flex;
  max-width: 100%;
}

.composer-token:hover .composer-token-name {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.composer-token-icon {
  display: inline-flex;
  flex: none;
}

/* 技能 token：强调色，与附件引用区分 */
.composer-token-skill {
  color: var(--color-accent);
}

/* 页面元素 tag：与技能同构（chip + icon + 名称），仅地球图标区分 */
.composer-token-element {
  color: var(--color-accent);
  background: var(--color-chip-bg);
  border: 1px solid color-mix(in srgb, var(--color-accent) 22%, var(--color-line-soft));
  padding: 1px 8px 1px 6px;
  gap: 5px;
}

.composer-token-element .composer-token-icon {
  color: var(--color-accent);
}

.composer-token-element .composer-token-name {
  color: var(--color-txt-strong);
  font-weight: 500;
}

.composer-token-element:hover {
  background: var(--color-menu-active);
  border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-line));
}

.composer-token-element:hover .composer-token-name {
  text-decoration: none;
}

/* 元素 tag 悬浮明细（挂在 body，避免被 editor overflow 裁切） */
.composer-el-tooltip {
  display: none;
  position: fixed;
  z-index: var(--z-tip, 90);
  width: 280px;
  max-width: min(280px, calc(100vw - 16px));
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-raise);
  box-shadow: var(--shadow-tip, var(--shadow-menu));
  pointer-events: none;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-txt);
}

.composer-el-tooltip-title {
  margin-bottom: 4px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.composer-el-tooltip-row {
  color: var(--color-mut);
  word-break: break-all;
}
</style>
