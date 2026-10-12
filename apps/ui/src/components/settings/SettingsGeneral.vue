<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import AppIcon from "@/components/base/AppIcon.vue";
import { Response } from "@/components/ai-elements/response";
import { CODE_THEMES } from "@/components/ai-elements/response/extensions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useSettingsStore } from "@/stores/settings";
import { BUILTIN_APP_ICONS } from "@zen/shared";

import type { AppLocale, ThemeMode, UpdateStatusInfo } from "@zen/shared";

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

/** 主题三档与语言两档：值即设置项，label 走语言包 */
const THEME_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  { value: "dark", labelKey: "settings.general.themeDark" },
  { value: "light", labelKey: "settings.general.themeLight" },
  { value: "system", labelKey: "settings.general.themeSystem" },
];
const LOCALE_OPTIONS: Array<{ value: AppLocale; labelKey: string }> = [
  { value: "zh-CN", labelKey: "settings.general.localeZh" },
  { value: "en-US", labelKey: "settings.general.localeEn" },
];

/** 代码主题预览片段：同一份代码左浅右深各渲染一份（取色规则见 styles.css 预览节） */
const PREVIEW_SNIPPET = `function greet() {
  const name = "world"
  console.log(name)
  return true
}`;

/** 软件更新（临时开放）：更新源 + 检查/下载/安装 */
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
  feedDraft.value = settings.value.updateFeedUrl ?? "";
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
  if ((settings.value.updateFeedUrl ?? null) === url) {
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
  <section class="flex flex-col">
    <h3 class="settings-section-title">{{ t("settings.general.appearance") }}</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
          <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.general.theme") }}</span>
          <Select
            :model-value="settings.theme"
            @update:model-value="settingsStore.setTheme(String($event) as ThemeMode)"
          >
            <SelectTrigger class="h-8 w-full rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="item in THEME_OPTIONS"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ t(item.labelKey) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
          <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.general.language") }}</span>
          <Select
            :model-value="settings.locale"
            @update:model-value="settingsStore.setLocale(String($event) as AppLocale)"
          >
            <SelectTrigger class="h-8 w-full rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="item in LOCALE_OPTIONS"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ t(item.labelKey) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  </section>

  <section class="flex flex-col">
    <!-- 软件更新（临时开放）：generic 更新源，局域网/本机静态目录即可 -->
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

  <section class="flex flex-col">
    <h3 class="settings-section-title">{{ t("settings.codeTheme.title") }}</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <Select
          :model-value="settings.codeTheme"
          @update:model-value="settingsStore.setCodeTheme(String($event))"
        >
          <SelectTrigger class="h-9 w-full rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]">
            <SelectValue :placeholder="t('settings.codeTheme.selectPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="theme in CODE_THEMES"
                :key="theme.id"
                :value="theme.id"
              >
                {{ theme.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <!-- 预览：同一片段左浅右深各一份，切换主题即时刷新 -->
        <div class="grid grid-cols-2 overflow-hidden rounded-[10px] border border-[var(--color-line)]">
          <Response
            :key="`light-${settings.codeTheme}`"
            :content="'```ts\n' + PREVIEW_SNIPPET + '\n```'"
            class="md-content code-theme-preview code-theme-preview--light"
          />
          <Response
            :key="`dark-${settings.codeTheme}`"
            :content="'```ts\n' + PREVIEW_SNIPPET + '\n```'"
            class="md-content code-theme-preview code-theme-preview--dark"
          />
        </div>
        <p class="m-0 text-[11px] text-[var(--color-dim)]">
          {{ t("settings.codeTheme.hint") }}
        </p>
      </CardContent>
    </Card>
  </section>

  <section class="flex flex-col">
    <h3 class="settings-section-title">{{ t("settings.icon.title") }}</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <p class="mb-0 text-[12px] text-[var(--color-mut)]">{{ t("settings.icon.hint") }}</p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5">
          <Button
            v-for="item in BUILTIN_APP_ICONS"
            :key="item.id"
            variant="ghost"
            class="h-auto flex flex-col items-center gap-2 whitespace-normal rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2 py-3 text-[12px] font-normal text-[var(--color-mut)] transition-colors hover:border-[var(--color-btn-border)] hover:text-[var(--color-txt)] hover:bg-[var(--color-np-btn-bg)] dark:hover:bg-[var(--color-np-btn-bg)]"
            :class="settings.iconId === item.id ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] text-[var(--color-txt-strong)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : ''"
            @click="settingsStore.setIcon(item.id)"
          >
            <AppIcon :id="item.id" :size="40" />
            <span>{{ t(`settings.icon.${item.id}`) }}</span>
          </Button>
          <Button
            variant="ghost"
            class="h-auto flex flex-col items-center gap-2 whitespace-normal rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2 py-3 text-[12px] font-normal text-[var(--color-mut)] transition-colors hover:border-[var(--color-btn-border)] hover:text-[var(--color-txt)] hover:bg-[var(--color-np-btn-bg)] dark:hover:bg-[var(--color-np-btn-bg)]"
            :class="settings.iconId === 'custom' ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] text-[var(--color-txt-strong)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : ''"
            @click="settingsStore.pickCustomIcon()"
          >
            <AppIcon
              id="custom-preview"
              :size="40"
              :custom-path="settings.customIconPath"
            />
            <span>{{ t("settings.icon.custom") }}</span>
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="w-fit"
          @click="settingsStore.pickCustomIcon()"
        >
          {{ t("settings.icon.upload") }}
        </Button>
      </CardContent>
    </Card>
  </section>
</template>
