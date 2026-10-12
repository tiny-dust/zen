<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import FileLabel from "@/components/files/FileLabel.vue";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { FilePreview } from "@zen/shared";

/**
 * 文件预览面板：悬浮面板「参考」里的用户上传文件/图片直接打开本面板，
 * 不经过右侧文件浏览器。图片支持适应面板/原始尺寸切换，文本只读。
 */
const props = defineProps<{
  open: boolean;
  /** 文件路径：绝对路径或工作区相对路径 */
  path: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
}>();

const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();
const { sessionWorkspaceId } = storeToRefs(chatStore);
const { t } = useI18n();

const preview = ref<FilePreview | null>(null);
const loading = ref(false);
/** 图片缩放：fit（适应面板）↔ actual（原始尺寸） */
const imageZoomed = ref(false);

const cwd = computed(() => workspaceStore.pathOf(sessionWorkspaceId.value));

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

const sizeText = computed(() =>
  preview.value ? formatSize(preview.value.size) : "",
);

async function load() {
  preview.value = null;
  imageZoomed.value = false;
  if (!props.open || !props.path) {
    return;
  }
  const zen = window.zen;
  if (!zen) {
    return;
  }
  loading.value = true;
  try {
    preview.value = await zen.workspace.previewFile(cwd.value, props.path);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.path] as const,
  () => void load(),
  { immediate: true },
);
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex max-h-[min(76vh,720px)] w-[min(880px,calc(100vw-64px))] flex-col gap-0 overflow-hidden bg-[var(--color-set-card)] p-0"
      :aria-label="t('shell.filePreview')"
    >
      <header
        class="flex flex-none items-center gap-2 border-b border-[var(--color-line)] px-4 py-3"
      >
        <DialogTitle class="m-0 min-w-0 flex-1 text-left">
          <FileLabel :path="path" class="text-[13px] text-[var(--color-txt-strong)]" />
        </DialogTitle>
        <span class="flex-none text-[11px] tabular-nums text-[var(--color-dim)]">
          {{ sizeText }}
        </span>
      </header>

      <div class="flex min-h-0 flex-1 flex-col">
        <p
          v-if="loading"
          class="m-0 px-4 py-10 text-center text-[12px] text-[var(--color-dim)]"
          role="status"
        >
          {{ t("shell.reading") }}
        </p>
        <template v-else-if="preview?.kind === 'image'">
          <div
            class="flex min-h-[240px] flex-1 items-center justify-center overflow-auto bg-[var(--color-code-bg)] p-4"
          >
            <img
              :src="preview.dataUrl"
              :alt="path"
              class="block"
              :class="imageZoomed ? 'max-w-none cursor-zoom-out' : 'max-h-[64vh] max-w-full cursor-zoom-in'"
              @click="imageZoomed = !imageZoomed"
            >
          </div>
          <p class="m-0 border-t border-[var(--color-line-soft)] px-4 py-2 text-center text-[11px] text-[var(--color-dim)]">
            {{ imageZoomed ? t("shell.clickToShrink") : t("shell.clickToViewOriginal") }}
          </p>
        </template>
        <template v-else-if="preview?.kind === 'text'">
          <pre
            class="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-[family-name:var(--font-mono)] text-[12px] leading-relaxed text-[var(--color-code-fg)]"
          >{{ preview.content }}</pre>
          <p
            v-if="preview.truncated"
            class="m-0 border-t border-[var(--color-line-soft)] px-4 py-2 text-[11px] text-[var(--color-accent)]"
            role="status"
          >
            {{ t("shell.fileTooLarge") }}
          </p>
        </template>
        <p
          v-else-if="preview?.kind === 'unsupported'"
          class="m-0 px-4 py-10 text-center text-[12px] text-[var(--color-dim)]"
          role="status"
        >
          {{ t("shell.unsupportedPreview", { size: sizeText }) }}
        </p>
        <p
          v-else
          class="m-0 px-4 py-10 text-center text-[12px] text-[var(--color-dim)]"
          role="status"
        >
          {{ t("shell.cannotReadFile") }}
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
