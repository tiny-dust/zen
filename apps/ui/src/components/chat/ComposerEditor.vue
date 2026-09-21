<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { caretOffsetIn, selectionOffsetsIn, setCaretAt } from "@/lib/composer-caret";
import { parseSegments, snapToToken } from "@/lib/composer-segments";
import { createTokenView } from "@/lib/composer-token-view";

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

// ---------- 装饰渲染：token 视图（含 tooltip）由工厂持有，状态随编辑器实例隔离 ----------

const tokenView = createTokenView({
  onTokenHover: (id) => emit("tokenHover", id),
  attachments: () => props.attachments,
  elements: () => props.elements,
});

// ---------- 源文本模型：DOM 的 textContent 即 markdown 源文本，装饰只改样式不改字符 ----------

function currentSource(): string {
  return editorEl.value?.textContent ?? "";
}

/** 全量重渲染（装饰不改字符，重渲染后按偏移恢复光标） */
function render(source: string, caret: number | null): void {
  const el = editorEl.value;
  if (!el) {
    return;
  }
  tokenView.unmountTokenViews();
  el.replaceChildren(
    ...tokenView.renderSegments(parseSegments(source, props.attachments, props.elements)),
  );
  if (caret !== null) {
    setCaretAt(el, caret);
  }
}

/** 改写源文本并同步到 v-model */
function applySource(source: string, caret: number): void {
  emit("update:modelValue", source);
  render(source, caret);
}

// ---------- 光标与插入 ----------

function caretOffset(): number {
  return caretOffsetIn(editorEl.value);
}

function tokenBoundary(offset: number, edge: "start" | "end" | "nearest"): number {
  return snapToToken(parseSegments(currentSource(), props.attachments, props.elements), offset, edge);
}

function selectionOffsets(): { start: number; end: number } {
  return selectionOffsetsIn(editorEl.value);
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
  tokenView.disposeTooltip();
  tokenView.unmountTokenViews();
});

defineExpose({
  focus: () => {
    editorEl.value?.focus();
  },
  caretOffset,
  /** 在下一次重渲染完成后设置光标（供 setValue 之后的落点） */
  setCaretSoon: (offset: number) => {
    void nextTick(() => setCaretAt(editorEl.value, offset));
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
