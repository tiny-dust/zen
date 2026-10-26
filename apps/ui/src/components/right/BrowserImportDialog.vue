<script setup lang="ts">
import { Check, Copy, Download, KeyRound, Loader2, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";
import { useBrowserStore } from "@/stores/browser";

import type { BrowserImportSource, BrowserImportSourceId, StoredPasswordEntry } from "@zen/shared";

/**
 * 浏览器数据导入弹窗：把系统浏览器（Chrome / Edge / Brave / Firefox / Safari）的
 * 书签、历史记录导入内置浏览器；密码只接受浏览器自己导出的 CSV（Chrome/Edge：
 * 设置 → 密码 → 导出），落本机加密库，列表不含明文，复制时才解密。
 */
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();
const browserStore = useBrowserStore();
const { passwords } = storeToRefs(browserStore);

// 弹窗浮在内嵌浏览器之上会被原生视图盖住，打开期间压制浏览器视图
useBrowserOverlayGuard(open);

const sources = ref<BrowserImportSource[]>([]);
const loadingSources = ref(false);
/** 正在进行中的导入任务（`<sourceId>:bookmarks` 等），用于按钮 loading */
const pending = ref("");
const feedback = ref("");
const passwordPending = ref(false);
const copiedId = ref("");

async function loadSources(): Promise<void> {
  const zen = window.zen?.browser;
  if (!zen?.importSources) {
    return;
  }
  loadingSources.value = true;
  try {
    sources.value = await zen.importSources();
  } finally {
    loadingSources.value = false;
  }
}

async function runImport(source: BrowserImportSource, kind: "bookmarks" | "history"): Promise<void> {
  const task = `${source.id}:${kind}`;
  if (pending.value) {
    return;
  }
  pending.value = task;
  feedback.value = "";
  try {
    const result = await browserStore.importFromSource(source.id, {
      [kind]: true,
    } as { bookmarks?: boolean; history?: boolean });
    feedback.value = result.ok
      ? kind === "bookmarks"
        ? t("panels.importBookmarksDone", { name: source.name, n: result.bookmarks ?? 0 })
        : t("panels.importHistoryDone", { name: source.name, n: result.history ?? 0 })
      : t("panels.importFailed", { error: result.error ?? "" });
  } finally {
    pending.value = "";
  }
}

async function importPasswords(): Promise<void> {
  if (passwordPending.value) {
    return;
  }
  passwordPending.value = true;
  feedback.value = "";
  try {
    const result = await browserStore.importPasswordsCsv();
    if (result.canceled) {
      feedback.value = t("features.exportCanceled");
      return;
    }
    feedback.value = result.ok
      ? t("panels.importPasswordsDone", {
          n: result.imported ?? 0,
          skipped: result.skipped ?? 0,
        })
      : t("panels.importFailed", { error: result.error ?? "" });
  } finally {
    passwordPending.value = false;
  }
}

async function copyPassword(entry: StoredPasswordEntry): Promise<void> {
  const plain = await browserStore.revealPassword(entry.id);
  if (!plain) {
    feedback.value = t("panels.importFailed", { error: "decrypt" });
    return;
  }
  try {
    await navigator.clipboard.writeText(plain);
    copiedId.value = entry.id;
    setTimeout(() => {
      copiedId.value = "";
    }, 1500);
  } catch {
    feedback.value = t("panels.importFailed", { error: "clipboard" });
  }
}

function sourceIcon(id: BrowserImportSourceId): string {
  return id.charAt(0).toUpperCase();
}

watch(
  open,
  (visible) => {
    if (!visible) {
      return;
    }
    feedback.value = "";
    void loadSources();
    void browserStore.loadPasswords();
  },
  { immediate: true },
);
</script>

<template>
  <Dialog :open="open" @update:open="(next) => (open = next)">
    <DialogContent data-large-panel="true" class="w-[min(460px,calc(100vw-48px))]">
      <DialogHeader>
        <DialogTitle>{{ t("panels.importTitle") }}</DialogTitle>
        <DialogDescription class="text-[12px] text-[var(--color-mut)]">
          {{ t("panels.importDesc") }}
        </DialogDescription>
      </DialogHeader>

      <!-- 数据源：本机实际存在数据文件的浏览器才会列出 -->
      <div class="flex flex-col gap-1.5">
        <p
          v-if="loadingSources"
          class="m-0 flex items-center gap-1.5 text-[12px] text-[var(--color-dim)]"
        >
          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
          {{ t("panels.importScanning") }}
        </p>
        <p
          v-else-if="!sources.length"
          class="m-0 text-[12px] text-[var(--color-dim)]"
        >
          {{ t("panels.importNoSource") }}
        </p>
        <div
          v-for="source in sources"
          :key="source.id"
          class="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-2 py-1.5"
        >
          <span
            class="inline-flex size-6 flex-none items-center justify-center rounded-[6px] bg-[var(--color-chip-bg)] text-[11px] font-semibold text-[var(--color-mut)]"
            aria-hidden="true"
          >
            {{ sourceIcon(source.id) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">
            {{ source.name }}
          </span>
          <Button
            variant="ghost"
            size="xs"
            class="flex-none font-normal text-[11px] md:text-[11px]"
            :disabled="!source.bookmarks || !!pending"
            @click="runImport(source, 'bookmarks')"
          >
            <Loader2
              v-if="pending === `${source.id}:bookmarks`"
              class="mr-1 size-3 animate-spin"
              aria-hidden="true"
            />
            {{ t("panels.importBookmarks") }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            class="flex-none font-normal text-[11px] md:text-[11px]"
            :disabled="!source.history || !!pending"
            @click="runImport(source, 'history')"
          >
            <Loader2
              v-if="pending === `${source.id}:history`"
              class="mr-1 size-3 animate-spin"
              aria-hidden="true"
            />
            {{ t("panels.importHistory") }}
          </Button>
        </div>
      </div>

      <!-- 密码：CSV 导入 + 已存条目（列表不含明文） -->
      <div class="mt-1 flex flex-col gap-1.5 border-t border-[var(--color-line-soft)] pt-2">
        <div class="flex items-center gap-1.5">
          <KeyRound class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
          <span class="min-w-0 flex-1 text-[12px] text-[var(--color-txt)]">
            {{ t("panels.importPasswords") }}
          </span>
          <Button
            variant="ghost"
            size="xs"
            class="flex-none font-normal text-[11px] md:text-[11px]"
            :disabled="passwordPending"
            @click="importPasswords"
          >
            <Loader2
              v-if="passwordPending"
              class="mr-1 size-3 animate-spin"
              aria-hidden="true"
            />
            <Download v-else class="mr-1 size-3" aria-hidden="true" />
            {{ t("panels.importPasswordsCsv") }}
          </Button>
        </div>
        <p class="m-0 text-[11px] text-[var(--color-dim)]">
          {{ t("panels.importPasswordsHint") }}
        </p>
        <p
          v-if="!passwords.length"
          class="m-0 text-[11px] text-[var(--color-dim)]"
        >
          {{ t("panels.importPasswordsEmpty") }}
        </p>
        <ul v-else class="m-0 flex max-h-48 list-none flex-col gap-1 overflow-auto p-0">
          <li
            v-for="entry in passwords"
            :key="entry.id"
            class="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] px-2 py-1"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[12px] text-[var(--color-txt)]">
                {{ entry.title }}
              </span>
              <span class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]">
                {{ entry.username || entry.origin }}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="flex-none text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
              :aria-label="t('panels.copyPassword')"
              :title="t('panels.copyPassword')"
              @click="copyPassword(entry)"
            >
              <Check v-if="copiedId === entry.id" class="size-3.5" />
              <Copy v-else class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              class="flex-none text-[var(--color-dim)] hover:text-[var(--color-del)]"
              :aria-label="t('panels.deletePassword')"
              :title="t('panels.deletePassword')"
              @click="browserStore.removePassword(entry.id)"
            >
              <Trash2 class="size-3.5" />
            </Button>
          </li>
        </ul>
      </div>

      <p v-if="feedback" class="m-0 text-[11px] text-[var(--color-mut)]" role="status">
        {{ feedback }}
      </p>
    </DialogContent>
  </Dialog>
</template>
