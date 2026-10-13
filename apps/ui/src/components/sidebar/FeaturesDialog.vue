<script setup lang="ts">
import { Blocks, CircleCheck, CircleOff, Loader2, RefreshCw } from "@lucide/vue";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";

import type { FeatureStatus } from "@zen/shared";

const open = defineModel<boolean>("open", { default: false });

const { t, te } = useI18n();

const loading = ref(false);
const errorMsg = ref("");
const entries = ref<FeatureStatus[]>([]);

// 弹窗浮在内嵌浏览器之上时会被原生视图盖住，打开期间压制浏览器视图
useBrowserOverlayGuard(open);

async function loadList() {
  const zen = window.zen;
  if (!zen?.features) {
    errorMsg.value = t("features.loadFailed", { error: "features API unavailable" });
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    const result = await zen.features.list();
    // IPC 返回纯对象；落本地 ref 前浅拷贝，避免后续引用被复用
    entries.value = (result.entries ?? []).map((item) => ({ ...item }));
  } catch (error) {
    errorMsg.value = t("features.loadFailed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    loading.value = false;
  }
}

watch(open, (value) => {
  if (value) {
    void loadList();
  }
});

/** i18n 优先（按条目 id），缺失回退注册表兜底文案 */
function nameOf(entry: FeatureStatus): string {
  return te(`features.catalog.${entry.id}.name`) ? t(`features.catalog.${entry.id}.name`) : entry.name;
}

function descOf(entry: FeatureStatus): string {
  return te(`features.catalog.${entry.id}.desc`) ? t(`features.catalog.${entry.id}.desc`) : entry.description;
}

function categoryLabel(entry: FeatureStatus): string {
  return te(`features.category.${entry.category}`) ? t(`features.category.${entry.category}`) : entry.category;
}

function statusLabel(entry: FeatureStatus): string {
  if (entry.available) {
    return t("features.statusAvailable");
  }
  return entry.reason === "unsupported-platform"
    ? t("features.statusUnsupportedPlatform")
    : t("features.statusNotInstalled");
}

function hintOf(entry: FeatureStatus): string {
  return entry.reason === "unsupported-platform"
    ? t("features.unsupportedPlatformHint")
    : t("features.notInstalledHint");
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-large-panel="true"
      class="flex h-[min(72vh,640px)] w-[min(760px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
    >
      <DialogHeader class="flex-none border-b border-[var(--color-line-soft)] px-5 py-3.5">
        <DialogTitle class="text-[15px]">{{ t("features.title") }}</DialogTitle>
        <DialogDescription class="text-[12px]">
          {{ t("features.desc") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-none items-center border-b border-[var(--color-line-soft)] px-4 py-2.5">
        <Button variant="ghost" size="sm" :disabled="loading" @click="loadList">
          <Loader2 v-if="loading" class="size-3.5 animate-spin" data-icon="inline-start" />
          <RefreshCw v-else :size="13" data-icon="inline-start" />
          {{ t("features.refresh") }}
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p v-if="errorMsg" class="m-0 text-[12px] text-[var(--color-danger-fg)]">{{ errorMsg }}</p>
        <div v-else-if="entries.length" class="flex flex-col gap-1.5">
          <div
            v-for="entry in entries"
            :key="entry.id"
            class="flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
            :class="entry.available ? '' : 'opacity-70'"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  class="text-[12px] font-medium"
                  :class="entry.available ? 'text-[var(--color-txt-strong)]' : 'text-[var(--color-mut)]'"
                >
                  {{ nameOf(entry) }}
                </span>
                <Badge variant="secondary" class="text-[10px]">
                  {{ categoryLabel(entry) }}
                </Badge>
                <Badge
                  :class="
                    entry.available
                      ? 'border-transparent bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)]! text-[var(--color-ok)]! text-[10px]'
                      : 'text-[10px]'
                  "
                  variant="outline"
                >
                  <CircleCheck v-if="entry.available" class="size-3" data-icon="inline-start" />
                  <CircleOff v-else class="size-3" data-icon="inline-start" />
                  {{ statusLabel(entry) }}
                </Badge>
              </div>
              <p class="m-0 mt-0.5 text-[11px] text-[var(--color-mut)]">{{ descOf(entry) }}</p>
              <p v-if="!entry.available" class="m-0 mt-0.5 text-[10px] text-[var(--color-dim)]">
                {{ hintOf(entry) }}
              </p>
            </div>
            <Blocks class="mt-0.5 size-4 flex-none text-[var(--color-dim)]" aria-hidden="true" />
          </div>
        </div>
        <p v-else-if="!loading" class="m-0 text-[12px] text-[var(--color-dim)]">
          {{ t("common.empty") }}
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
