<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useSettingsStore } from "@/stores/settings";

import type { UpdateStatusInfo } from "@zen/shared";

/** 软件更新（临时开放）：generic 更新源 + 检查/下载/安装 */
const { t } = useI18n();
const settingsStore = useSettingsStore();

const feedDraft = ref("");
const updateStatus = ref<UpdateStatusInfo>({ phase: "idle" });
const updateError = ref("");

const updateStatusText = computed(() => {
  switch (updateStatus.value.phase) {
    case "checking":
      return t("settings.update.statusChecking");
    case "available":
      return t("settings.update.statusAvailable", { version: updateStatus.value.version ?? "" });
    case "not-available":
      return t("settings.update.statusNotAvailable");
    case "downloading":
      return t("settings.update.statusDownloading", { percent: updateStatus.value.percent ?? 0 });
    case "downloaded":
      return t("settings.update.statusDownloaded", { version: updateStatus.value.version ?? "" });
    case "error":
      return updateStatus.value.message || t("settings.update.statusError");
    default:
      return "";
  }
});

const canInstall = computed(() => updateStatus.value.phase === "downloaded");
const canDownload = computed(() => updateStatus.value.phase === "available");
const appVersion = ref("");

onMounted(() => {
  feedDraft.value = settingsStore.settings.updateFeedUrl ?? "";
  const zen = window.zen;
  if (!zen) {
    return;
  }
  void zen.app.info().then((info) => {
    appVersion.value = info.version;
  });
  const off = zen.updates.onStatus((status) => {
    updateStatus.value = status;
    if (status.phase === "error") {
      updateError.value = status.message ?? t("settings.update.statusError");
    }
  });
  onUnmounted(off);
});

function installUpdate() {
  window.zen?.updates.install();
}

async function saveFeed() {
  const url = feedDraft.value.trim() || null;
  // 与同页其他设置保持一致：失焦即保存，未变更时静默返回
  if ((settingsStore.settings.updateFeedUrl ?? null) === url) {
    return;
  }
  await settingsStore.setFeedUrl(url);
  feedDraft.value = url ?? "";
  toast.ok(t("settings.update.feedSaved"));
}

async function checkUpdate() {
  const zen = window.zen;
  if (!zen || updateStatus.value.phase === "checking" || updateStatus.value.phase === "downloading") {
    return;
  }
  updateError.value = "";
  await saveFeed();
  const result = await zen.updates.check();
  if (!result.ok) {
    updateError.value = result.error ?? t("settings.update.checkFailed");
  }
}

async function downloadUpdate() {
  const zen = window.zen;
  if (!zen) {
    return;
  }
  updateError.value = "";
  const result = await zen.updates.download();
  if (!result.ok) {
    updateError.value = result.error ?? t("settings.update.downloadFailed");
  }
}
</script>

<template>
  <section id="set-general-update" class="flex flex-col scroll-mt-2">
    <h3 class="settings-section-title">{{ t("settings.update.title") }}</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <div class="flex items-center gap-2">
          <Input
            v-model="feedDraft"
            class="h-8 min-w-0 flex-1 font-[family-name:var(--font-mono)] text-[12px]"
            :placeholder="t('settings.update.feedPlaceholder')"
            :aria-label="t('settings.update.feedAriaLabel')"
            @keydown.enter="saveFeed"
            @blur="saveFeed"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="updateStatus.phase === 'checking' || updateStatus.phase === 'downloading'"
            @click="checkUpdate"
          >
            {{ updateStatus.phase === "checking" ? t("settings.update.checking") : t("settings.update.check") }}
          </Button>
          <Button
            v-if="canDownload"
            size="sm"
            @click="downloadUpdate"
          >
            {{ t("settings.update.download") }}
          </Button>
          <Button
            v-if="canInstall"
            size="sm"
            @click="installUpdate"
          >
            {{ t("settings.update.install") }}
          </Button>
          <span class="text-[11px] text-[var(--color-dim)]">{{ t("settings.update.currentVersion", { version: appVersion }) }}</span>
        </div>
        <p
          v-if="updateStatusText"
          class="m-0 text-[12px]"
          :class="updateStatus.phase === 'error' ? 'text-[var(--color-err)]' : 'text-[var(--color-mut)]'"
          role="status"
        >
          {{ updateStatusText }}
        </p>
        <p v-if="updateError && updateStatus.phase !== 'error'" class="m-0 text-[12px] text-[var(--color-err)]">
          {{ updateError }}
        </p>
        <p class="m-0 text-[11px] leading-relaxed text-[var(--color-dim)]">
          {{ t("settings.update.hint") }}
        </p>
      </CardContent>
    </Card>
  </section>
</template>
