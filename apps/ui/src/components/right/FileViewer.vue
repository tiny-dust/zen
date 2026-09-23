<script setup lang="ts">
import { FileCode } from "@lucide/vue";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import { isImagePath } from "@/lib/image-file";

const props = defineProps<{
  /** 文件相对路径（含文件名，用于推断语言）；空表示未选择 */
  path?: string;
  /** 工作区目录（绝对路径） */
  root?: string;
  /** 消息流行号锚点：渲染后滚动定位到该行 */
  line?: number;
}>();

const emit = defineEmits<{
  saved: [path: string];
  dirtyChange: [dirty: boolean];
}>();

const hostEl = ref<HTMLDivElement | null>(null);
const failed = ref(false);
const truncated = ref(false);
const dirty = ref(false);
const saving = ref(false);
const saveError = ref("");
/** 图片文件：走 preview-file 的 data URL 渲染，不进 CodeMirror */
const imageDataUrl = ref("");
/** 图片缩放：fit（适应面板）↔ actual（原始尺寸） */
const imageZoomed = ref(false);
/** preview-file 回退通道（read-file 沙箱拒绝的工作区外文件）只读展示 */
const readonlyView = ref(false);
let view: EditorView | null = null;
/** 当前已加载的磁盘内容，用于脏检查与保存 */
let loadedContent = "";

function langExtension(path: string) {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
    case "vue":
      return html();
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "mdx":
      return markdown();
    case "py":
      return python();
    default:
      return [];
  }
}

function extensionList(path: string, readOnly: boolean) {
  return [
    lineNumbers(),
    history(),
    keymap.of([
      {
        key: "Mod-s",
        run: () => {
          void save();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    langExtension(path),
    oneDark,
    EditorView.lineWrapping,
    ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        dirty.value = view ? view.state.doc.toString() !== loadedContent : false;
        saveError.value = "";
        emit("dirtyChange", dirty.value);
      }
    }),
  ];
}

function destroyView() {
  if (view) {
    view.destroy();
    view = null;
  }
}

function render() {
  destroyView();
  failed.value = false;
  truncated.value = false;
  dirty.value = false;
  saveError.value = "";
  loadedContent = "";
  imageDataUrl.value = "";
  imageZoomed.value = false;
  readonlyView.value = false;
  if (!props.path || !props.root) {
    return;
  }
  const zen = window.zen;
  if (!zen) {
    return;
  }
  const requestId = `${props.root}::${props.path}`;
  // 图片：preview-file 返回 data URL，居中展示，不支持编辑
  if (isImagePath(props.path)) {
    void zen.workspace.previewFile(props.root, props.path).then((preview) => {
      if (requestId !== `${props.root}::${props.path}`) {
        return;
      }
      if (preview?.kind !== "image") {
        failed.value = true;
        return;
      }
      imageDataUrl.value = preview.dataUrl;
    });
    return;
  }
  void zen.workspace.readFile(props.root, props.path).then((result) => {
    // 异步返回时组件可能已切换文件
    if (requestId !== `${props.root}::${props.path}` || !hostEl.value) {
      return;
    }
    if (result) {
      mountEditor(result.content, result.truncated, false);
      return;
    }
    // read-file 沙箱拒绝的场景（工作区外绝对路径等）：退化为 preview-file 只读展示
    void zen.workspace.previewFile(props.root, props.path!).then((preview) => {
      if (requestId !== `${props.root}::${props.path}` || !hostEl.value) {
        return;
      }
      if (!preview || preview.kind === "unsupported") {
        failed.value = true;
        return;
      }
      if (preview.kind === "image") {
        imageDataUrl.value = preview.dataUrl;
        return;
      }
      mountEditor(preview.content, preview.truncated, true);
    });
  });
}

function mountEditor(content: string, truncatedFile: boolean, readOnly: boolean) {
  if (!hostEl.value) {
    return;
  }
  failed.value = false;
  truncated.value = truncatedFile;
  readonlyView.value = readOnly;
  loadedContent = content;
  dirty.value = false;
  destroyView();
  view = new EditorView({
    parent: hostEl.value,
    state: EditorState.create({
      doc: content,
      extensions: extensionList(props.path!, readOnly),
    }),
  });
  applyLine();
}

/** 消息流行号锚点：把光标移到目标行并滚动到可视区 */
function applyLine() {
  if (!view || !props.line || props.line < 1) {
    return;
  }
  const target = Math.min(props.line, view.state.doc.lines);
  view.dispatch({
    selection: { anchor: view.state.doc.line(Math.max(1, target)).from },
    scrollIntoView: true,
  });
}

/** 保存当前编辑器内容到磁盘；成功后重置脏标记 */
async function save(): Promise<boolean> {
  const zen = window.zen;
  if (!zen || !view || !props.path || !props.root || saving.value) {
    return false;
  }
  if (!dirty.value) {
    return true;
  }
  saving.value = true;
  saveError.value = "";
  try {
    const content = view.state.doc.toString();
    const result = await zen.workspace.writeFile(props.root, props.path, content);
    if (!result.ok) {
      saveError.value = result.error || "保存失败";
      return false;
    }
    loadedContent = content;
    dirty.value = false;
    emit("saved", props.path);
    return true;
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "保存失败";
    return false;
  } finally {
    saving.value = false;
  }
}

/** 丢弃本地修改并重新读盘 */
function revert() {
  render();
}

// 首次挂载时 path 已就绪也必须渲染；后续切换 path/root 再刷
watch(
  () => [props.path, props.root] as const,
  () => render(),
);

watch(() => props.line, () => applyLine());

onMounted(() => {
  render();
});

onBeforeUnmount(() => {
  destroyView();
});

defineExpose({ render, save, revert, dirty, saving, saveError });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <template v-if="path && root">
      <div v-if="dirty || saveError" class="flex flex-none items-center gap-1.5 pb-1">
        <span v-if="dirty" class="text-[11px] text-[var(--color-accent)]">未保存</span>
        <span v-if="saveError" class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-err)]">
          {{ saveError }}
        </span>
        <span v-else class="flex-1" />
      </div>
      <p
        v-if="failed"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
        role="status"
      >
        无法读取该文件（二进制或超出大小限制）。
      </p>
      <!-- 图片：点击在适应面板 / 原始尺寸间切换 -->
      <div
        v-else-if="imageDataUrl"
        class="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-code-bg)]"
      >
        <img
          :src="imageDataUrl"
          :alt="path"
          class="block"
          :class="imageZoomed ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in'"
          @click="imageZoomed = !imageZoomed"
        >
      </div>
      <p
        v-else-if="isImagePath(path)"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
        role="status"
      >
        读取中…
      </p>
      <template v-else>
        <p
          v-if="truncated"
          class="m-0 px-1 pb-1 text-[11px] text-[var(--color-accent)]"
          role="status"
        >
          文件过大，仅展示前 512KB（截断部分不可保存）。
        </p>
        <p
          v-if="readonlyView"
          class="m-0 px-1 pb-1 text-[11px] text-[var(--color-accent)]"
          role="status"
        >
          只读展示（工作区外文件不支持编辑保存）。
        </p>
        <div
          ref="hostEl"
          class="zen-code-viewer min-h-0 flex-1 overflow-hidden font-[family-name:var(--font-mono)] text-[12px]"
        />
      </template>
    </template>
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--color-dim)]">
      <FileCode class="size-5" aria-hidden="true" />
      <p class="m-0 text-[12px]">在左侧选择文件，可直接编辑保存</p>
    </div>
  </div>
</template>
