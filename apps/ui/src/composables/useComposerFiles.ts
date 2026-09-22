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
 * Composer 的文件进入通道：文件选择器、粘贴、拖放三条路径共用 addAttachment，
 * 并管理附件图像 objectURL 的生命周期（附件移除或组件卸载时 revoke）。
 * 拖放/粘贴/选择处理函数从 ChatComposer 拆出，编辑器交互经 options 注入。
 */
export function useComposerFiles(options: ComposerFilesOptions) {
  const chatStore = useChatStore();
  const { attachments, insertAtCaret, insertAtPoint } = options;

  const dragging = ref(false);
  const fileInputEl = ref<HTMLInputElement | null>(null);
  /** 附件图像的 objectURL：chip 预览用，随附件移除/组件卸载 revoke */
  const imageUrls = ref(new Map<string, string>());

  watch(() => attachments.value.map((att) => att.id), (ids) => {
    for (const [id, url] of imageUrls.value) {
      if (!ids.includes(id)) {
        URL.revokeObjectURL(url);
        imageUrls.value.delete(id);
      }
    }
  });

  onBeforeUnmount(() => {
    endFileDialog();
    for (const url of imageUrls.value.values()) {
      URL.revokeObjectURL(url);
    }
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
      imageUrls.value.set(attachment.id, URL.createObjectURL(file));
    }
  }

  function onPickFiles(event: Event) {
    endFileDialog();
    const target = event.target as HTMLInputElement;
    const zen = window.zen;
    for (const file of Array.from(target.files ?? [])) {
      const path = zen ? zen.pathForFile(file) : "";
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
    const zen = window.zen;
    for (const file of files) {
      let path = zen ? zen.pathForFile(file) : "";
      if (!path && zen?.cache?.savePaste) {
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
      }
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
  function onDrop(event: DragEvent) {
    dragDepth = 0;
    dragging.value = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    const zen = window.zen;
    let refs = "";
    for (const file of files) {
      const path = zen ? zen.pathForFile(file) : "";
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
