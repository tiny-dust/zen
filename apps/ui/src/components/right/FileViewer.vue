<script setup lang="ts">
import { FileCode } from "@lucide/vue";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  /** 文件相对路径（含文件名，用于推断语言）；空表示未选择 */
  path?: string;
  /** 工作区目录（绝对路径） */
  root?: string;
}>();

const hostEl = ref<HTMLDivElement | null>(null);
const failed = ref(false);
const truncated = ref(false);
let view: EditorView | null = null;

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

function extensionList(path: string) {
  return [lineNumbers(), langExtension(path), oneDark, EditorView.lineWrapping];
}

function render() {
  if (view) {
    view.destroy();
    view = null;
  }
  if (!hostEl.value || !props.path || !props.root) {
    return;
  }
  const zen = window.zen;
  if (!zen) {
    return;
  }
  void zen.workspace.readFile(props.root, props.path).then((result) => {
    if (!result || !hostEl.value) {
      failed.value = true;
      return;
    }
    failed.value = false;
    truncated.value = result.truncated;
    view = new EditorView({
      parent: hostEl.value,
      state: EditorState.create({
        doc: result.content,
        extensions: [
          extensionList(props.path!),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    });
  });
}

watch(
  () => [props.path, props.root],
  () => render(),
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

defineExpose({ render });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <template v-if="path && root">
      <p
        v-if="failed"
        class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]"
        role="status"
      >
        无法读取该文件（二进制或超出大小限制）。
      </p>
      <template v-else>
        <p
          v-if="truncated"
          class="m-0 px-1 pb-1 text-[11px] text-[var(--color-accent)]"
          role="status"
        >
          文件过大，仅展示前 512KB。
        </p>
        <div
          ref="hostEl"
          class="min-h-0 flex-1 overflow-auto font-[family-name:var(--font-mono)] text-[12px]"
        />
      </template>
    </template>
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--color-dim)]">
      <FileCode class="size-5" aria-hidden="true" />
      <p class="m-0 text-[12px]">在上方选择文件预览</p>
    </div>
  </div>
</template>
