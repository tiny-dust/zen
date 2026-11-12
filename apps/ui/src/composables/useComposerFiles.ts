import { onBeforeUnmount, ref, watch, type Ref } from "vue";

import { useBrowserStore } from "@/stores/browser";
import { useChatStore } from "@/stores/chat";
import type { ComposerAttachment } from "@/stores/chat-types";

/** useComposerFiles 的注入回调：编辑器插入能力由宿主组件提供 */
interface ComposerFilesOptions {
  /** chat store 附件列表：新增后回读末项判断是否图像 */
  attachments: Ref<ComposerAttachment[]>;
  /** 插入到编辑器光标处 */
  insertAtCaret: (text: string) => void;
  /** 按坐标插入（拖放落点），返回是否落点成功 */
  insertAtPoint: (x: number, y: number, refs: string) => boolean;
}

/**
 * 批内文件名去重：同名文件从 -2 起取最小可用序号（image.png → image-2.png → image-3.png），
 * 避免粘贴多图时全部叫 image.png 导致附件互相冲突。首个保持原名，序号与批内已有名顺延。
 */
export function dedupeFileNames(files: File[]): File[] {
  const used = new Set<string>();
  return files.map((file) => {
    if (!file.name) {
      // 空文件名沿用 onPaste 的 pasted-image.png 兜底，不在此改名
      return file;
    }
    if (!used.has(file.name)) {
      used.add(file.name);
      return file;
    }
    const dot = file.name.lastIndexOf(".");
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    const ext = dot > 0 ? file.name.slice(dot) : "";
    let index = 2;
    while (used.has(`${base}-${index}${ext}`)) {
      index += 1;
    }
    const renamed = `${base}-${index}${ext}`;
    used.add(renamed);
    return new File([file], renamed, { type: file.type, lastModified: file.lastModified });
  });
}

/**
 * Composer 的文件进入通道：文件选择器、粘贴、拖放三条路径共用 addAttachment，
 * 并管理附件图像预览（File 使用 objectURL，路径型图片使用 data URL）。
 * 拖放/粘贴/选择处理函数从 ChatComposer 拆出，编辑器交互经 options 注入。
 */
export function useComposerFiles(options: ComposerFilesOptions) {
  const chatStore = useChatStore();
  const { attachments, insertAtCaret, insertAtPoint } = options;

  const dragging = ref(false);
  const fileInputEl = ref<HTMLInputElement | null>(null);
  /** chip 预览：File 的 objectURL 或路径型图片的 data URL */
  const imageUrls = ref(new Map<string, string>());
  const objectUrls = new Map<string, string>();
  const pathPreviews = new Map<string, string>();
  const pendingPreviews = new Map<string, { path: string }>();
  let disposed = false;

  async function loadPathPreview(att: { id: string; path: string }) {
    const zen = window.zen;
    if (!zen?.workspace?.previewFile) return;
    const request = { path: att.path };
    pendingPreviews.set(att.id, request);
    try {
      const preview = await zen.workspace.previewFile(undefined, att.path);
      const current = attachments.value.find((item) => item.id === att.id);
      if (
        preview?.kind !== "image" || disposed || pendingPreviews.get(att.id) !== request ||
        imageUrls.value.has(att.id) || current?.path !== att.path || !current.isImage
      ) {
        return;
      }
      imageUrls.value.set(att.id, preview.dataUrl);
      pathPreviews.set(att.id, att.path);
      current.size = preview.size;
    } catch {
      // 文件不可预览时仍保留附件 chip 的文件图标
    } finally {
      if (pendingPreviews.get(att.id) === request) pendingPreviews.delete(att.id);
    }
  }

  watch(
    () => attachments.value.map((att) => ({ id: att.id, path: att.path, isImage: att.isImage })),
    (items) => {
      const ids = new Set(items.map((item) => item.id));
      for (const [id, url] of objectUrls) {
        if (!ids.has(id)) {
          URL.revokeObjectURL(url);
          objectUrls.delete(id);
        }
      }
      for (const [id, path] of pathPreviews) {
        if (!items.some((item) => item.id === id && item.path === path && item.isImage)) {
          pathPreviews.delete(id);
          imageUrls.value.delete(id);
        }
      }
      for (const id of imageUrls.value.keys()) {
        if (!ids.has(id)) imageUrls.value.delete(id);
      }
      for (const item of items) {
        if (
          item.isImage && item.path && !imageUrls.value.has(item.id) &&
          pendingPreviews.get(item.id)?.path !== item.path
        ) {
          void loadPathPreview(item);
        }
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    disposed = true;
    endFileDialog();
    for (const url of objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrls.clear();
    imageUrls.value.clear();
  });

  /** 文件弹窗期间的浏览器视图恢复函数（选完或取消后恢复显示） */
  let dialogRestore: (() => Promise<void>) | null = null;

  function endFileDialog() {
    const restore = dialogRestore;
    dialogRestore = null;
    window.removeEventListener("focus", onFileDialogClosed);
    if (restore) {
      void restore();
    }
  }

  function onFileDialogClosed() {
    // 用户取消（未选文件）时 input 不触发 change，靠窗口重新聚焦恢复
    endFileDialog();
  }

  function openFilePicker() {
    // 系统文件弹窗会被内嵌浏览器视图盖住：打开前隐藏原生视图，弹窗关闭后恢复
    void useBrowserStore()
      .beginFileDialog()
      .then((restore) => {
        dialogRestore = restore;
        window.addEventListener("focus", onFileDialogClosed);
        fileInputEl.value?.click();
      });
  }

  function addAttachment(file: File, path: string) {
    chatStore.addAttachment(file, path);
    const attachment = attachments.value.at(-1);
    if (attachment?.isImage) {
      const url = URL.createObjectURL(file);
      objectUrls.set(attachment.id, url);
      imageUrls.value.set(attachment.id, url);
    }
  }

  /**
   * 文件真实路径解析：pathForFile 拿不到（部分拖放来源/web 环境返回空）时
   * 把内容落盘到 ~/.zen/cache 兜底——否则附件无路径，Agent 读不到、图片也不加载
   * （与粘贴通道同一兜底策略）。
   */
  async function resolveFilePath(file: File): Promise<string> {
    const zen = window.zen;
    let path = zen ? zen.pathForFile(file) : "";
    if (path || !zen?.cache?.savePaste) {
      return path;
    }
    try {
      const buffer = await file.arrayBuffer();
      const saved = await zen.cache.savePaste({
        name: file.name || (file.type.startsWith("image/") ? "pasted-image.png" : "pasted.bin"),
        mime: file.type,
        data: buffer,
      });
      if (saved.ok && saved.path) {
        path = saved.path;
      }
    } catch {
      path = "";
    }
    return path;
  }

  async function onPickFiles(event: Event) {
    endFileDialog();
    const target = event.target as HTMLInputElement;
    for (const file of dedupeFileNames(Array.from(target.files ?? []))) {
      const path = await resolveFilePath(file);
      addAttachment(file, path);
      insertAtCaret(`$${file.name} `);
    }
    target.value = "";
  }

  /** 粘贴板：文本交给编辑器默认行为；文件/图像作为附件（无路径时落到 ~/.zen/cache） */
  async function onPaste(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) {
      return;
    }
    const fileItems = Array.from(data.files ?? []);
    const pathItems = Array.from(data.items ?? []).filter((item) => item.kind === "file");
    const files: File[] = [];
    if (fileItems.length) {
      files.push(...fileItems);
    } else {
      for (const item of pathItems) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    if (!files.length) {
      // 纯文本：不拦截，交给 contenteditable
      return;
    }
    event.preventDefault();
    for (const file of dedupeFileNames(files)) {
      const path = await resolveFilePath(file);
      addAttachment(file, path);
      insertAtCaret(`$${file.name} `);
    }
  }

  // ---------- 拖放：只接管文件；纯文本拖放不拦截，交给编辑器 beforeinput ----------

  let dragDepth = 0;

  function onDragEnter(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) {
      return;
    }
    dragDepth += 1;
    dragging.value = true;
  }

  function onDragLeave() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dragging.value = false;
    }
  }

  function onDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
    }
  }

  /** 文件落点：编辑器内按坐标插到光标处，壳内其他区域追加到末尾 */
  async function onDrop(event: DragEvent) {
    dragDepth = 0;
    dragging.value = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    let refs = "";
    for (const file of dedupeFileNames(files)) {
      const path = await resolveFilePath(file);
      addAttachment(file, path);
      refs += `$${file.name} `;
    }
    const dropped = insertAtPoint(event.clientX, event.clientY, refs);
    if (!dropped) {
      insertAtCaret(refs);
    }
  }

  return {
    dragging,
    fileInputEl,
    imageUrls,
    openFilePicker,
    onPickFiles,
    onPaste,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
