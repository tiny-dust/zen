<script setup lang="ts">
import { IconCheck as Check } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import CustomThemeEditor from "@/components/settings/CustomThemeEditor.vue";
import { SliderRange } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { useSettingsStore } from "@/stores/settings";

import { ACCENT_COLORS, THEME_PRESET_INFO, THEME_MODES, customThemeSwatch } from "@zen/shared";
import type { AppLocale, CustomTheme, ThemeMode } from "@zen/shared";

/** 外观与语言：七套主题预设 + 跟随系统（色卡预览）、强调色、界面语言 */
const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

interface ThemeOption {
  value: ThemeMode;
  labelKey: string;
  /** 色卡：背景 / 表面 / 文字 / 强调；system 用明暗对半预览 */
  swatch: readonly [string, string, string, string] | null;
}

const THEME_OPTIONS: ThemeOption[] = [
  ...THEME_PRESET_INFO.map((info) => ({
    value: info.id as ThemeMode,
    labelKey: `settings.general.themePresets.${info.id}`,
    swatch: info.swatch,
  })),
  { value: "system", labelKey: "settings.general.themeSystem", swatch: null },
];

/** 图片背景：选中的图只在内存里，设置文件只留文件名与参数 */
const imageEnabled = computed(() => settings.value.themeImage.enabled && Boolean(settingsStore.themeImageUrl));
const imageBusy = ref(false);

async function pickImage(): Promise<void> {
  imageBusy.value = true;
  try {
    await settingsStore.pickThemeImage();
  } finally {
    imageBusy.value = false;
  }
}

async function toggleImage(next: boolean): Promise<void> {
  if (next && !settings.value.themeImage.id) {
    await pickImage();
    return;
  }
  await settingsStore.setThemeImage({ enabled: next });
}

function imageErrorMessage(): string | null {
  const code = settingsStore.themeImageError;
  if (!code) return null;
  if (code === "too-large") return t("settings.general.imageTooLarge");
  if (code === "unsupported-format") return t("settings.general.imageUnsupported");
  if (code === "missing") return t("settings.general.imageMissing");
  return t("settings.general.imagePickFailed");
}

/** 自定义主题：卡片应用 / 编辑 / 导出，删除用两步确认避免误删 */
const editorOpen = ref(false);
const editing = ref<CustomTheme | null>(null);
const pendingDelete = ref<string | null>(null);
const customError = ref("");
const customBusy = ref(false);

function nameOf(theme: CustomTheme): string {
  return theme.name.zh || theme.name.en || theme.id;
}

function openEditor(theme: CustomTheme | null): void {
  editing.value = theme;
  editorOpen.value = true;
}

async function importPack(): Promise<void> {
  customBusy.value = true;
  customError.value = "";
  try {
    const result = await settingsStore.importThemePack();
    if (!result.ok && !result.canceled) {
      customError.value = t(`settings.general.customErrors.${result.error ?? "import-failed"}`, t("settings.general.customImportFailed"));
    }
  } finally {
    customBusy.value = false;
  }
}

async function exportTheme(id: string): Promise<void> {
  customBusy.value = true;
  customError.value = "";
  try {
    const result = await settingsStore.exportThemePack(id);
    if (!result.ok && !result.canceled) {
      customError.value = t("settings.general.customExportFailed");
    }
  } finally {
    customBusy.value = false;
  }
}

async function removeTheme(id: string): Promise<void> {
  if (pendingDelete.value !== id) {
    pendingDelete.value = id;
    return;
  }
  pendingDelete.value = null;
  await settingsStore.deleteCustomTheme(id);
}

/** 预览块内的小气泡：保持与 nomi 主题卡同样的构图，纯装饰 */
function swatchStyle(swatch: readonly [string, string, string, string]) {
  return {
    backgroundColor: swatch[0],
    "--preview-surface": swatch[1],
    "--preview-text": swatch[2],
    "--preview-accent": swatch[3],
  } as Record<string, string>;
}
const LOCALE_OPTIONS: Array<{ value: AppLocale; labelKey: string }> = [
  { value: "zh-CN", labelKey: "settings.general.localeZh" },
  { value: "en-US", labelKey: "settings.general.localeEn" },
];
</script>

<template>
  <section id="set-general-appearance" class="flex flex-col scroll-mt-2">
    <h3 class="settings-section-title">{{ t("settings.general.appearance") }}</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <div class="flex flex-col gap-2">
          <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.general.theme") }}</span>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2" role="radiogroup" :aria-label="t('settings.general.theme')" data-testid="theme-presets">
            <button
              v-for="item in THEME_OPTIONS"
              :key="item.value"
              type="button"
              role="radio"
              :aria-checked="settings.theme === item.value"
              :aria-label="t(item.labelKey)"
              :title="t(item.labelKey)"
              class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border p-1.5 text-left transition-colors"
              :class="settings.theme === item.value
                ? 'border-[var(--color-accent)] bg-[var(--color-menu-active)]'
                : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)]'"
              :data-testid="`theme-preset-${item.value}`"
              @click="settingsStore.setTheme(item.value)"
            >
              <span
                v-if="item.swatch"
                class="flex h-9 w-full items-end gap-1 overflow-hidden rounded-[var(--radius-xs)] px-1.5 pb-1"
                :style="swatchStyle(item.swatch)"
                aria-hidden="true"
              >
                <span class="h-3 w-4 rounded-t-[3px]" :style="{ backgroundColor: 'var(--preview-accent)' }" />
                <span class="h-2 w-6 rounded-t-[3px]" :style="{ backgroundColor: 'var(--preview-text)', opacity: 0.5 }" />
              </span>
              <span
                v-else
                class="flex h-9 w-full overflow-hidden rounded-[var(--radius-xs)]"
                aria-hidden="true"
              >
                <span class="h-full w-1/2" style="background-color: #fffefd" />
                <span class="h-full w-1/2" style="background-color: #141414" />
              </span>
              <span class="flex items-center gap-1 text-[12px] text-[var(--color-txt)]">
                <Check v-if="settings.theme === item.value" class="size-3 text-[var(--color-accent)]" aria-hidden="true" />
                {{ t(item.labelKey) }}
              </span>
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-2" data-testid="custom-themes">
          <div class="flex items-center gap-2">
            <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.general.customThemes") }}</span>
            <div class="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" type="button" :disabled="customBusy" data-testid="custom-theme-import" @click="importPack">
                {{ t("settings.general.customImport") }}
              </Button>
              <Button variant="outline" size="sm" type="button" data-testid="custom-theme-new" @click="openEditor(null)">
                {{ t("settings.general.customNew") }}
              </Button>
            </div>
          </div>

          <p v-if="!settings.customThemes.length" class="m-0 text-[11px] text-[var(--color-dim)]">
            {{ t("settings.general.customEmpty") }}
          </p>

          <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2" role="radiogroup" :aria-label="t('settings.general.customThemes')">
            <div
              v-for="theme in settings.customThemes"
              :key="theme.id"
              class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border p-1.5"
              :class="settings.theme === `custom:${theme.id}` ? 'border-[var(--color-accent)] bg-[var(--color-menu-active)]' : 'border-[var(--color-line)]'"
              :data-testid="`custom-theme-${theme.id}`"
            >
              <button
                type="button"
                role="radio"
                :aria-checked="settings.theme === `custom:${theme.id}`"
                class="flex flex-col gap-1 text-left"
                @click="settingsStore.setTheme(`custom:${theme.id}`)"
              >
                <span class="flex h-9 w-full overflow-hidden rounded-[var(--radius-xs)]" aria-hidden="true">
                  <span class="h-full w-1/4" :style="{ backgroundColor: customThemeSwatch(theme)[0] }" />
                  <span class="h-full w-1/4" :style="{ backgroundColor: customThemeSwatch(theme)[1] }" />
                  <span class="h-full w-1/4" :style="{ backgroundColor: customThemeSwatch(theme)[2] }" />
                  <span class="h-full w-1/4" :style="{ backgroundColor: customThemeSwatch(theme)[3] }" />
                </span>
                <span class="truncate text-[12px] text-[var(--color-txt-strong)]">{{ nameOf(theme) }}</span>
              </button>
              <div class="flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" type="button" @click="openEditor(theme)">{{ t("settings.general.customEdit") }}</Button>
                <Button variant="ghost" size="sm" type="button" :disabled="customBusy" @click="exportTheme(theme.id)">{{ t("settings.general.customExport") }}</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  :class="pendingDelete === theme.id ? 'text-[var(--color-danger)]' : ''"
                  :data-testid="`custom-theme-delete-${theme.id}`"
                  @click="removeTheme(theme.id)"
                >
                  {{ pendingDelete === theme.id ? t("settings.general.customDeleteConfirm") : t("settings.general.customDelete") }}
                </Button>
              </div>
            </div>
          </div>

          <p v-if="customError" class="m-0 text-[11px] text-[var(--color-danger)]" data-testid="custom-theme-error">{{ customError }}</p>
        </div>

        <CustomThemeEditor v-model:open="editorOpen" :theme="editing" />

        <div class="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] p-2.5" data-testid="image-theme-card">
          <div class="flex items-center gap-2">
            <span class="flex h-12 w-20 flex-none items-center justify-center overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-line-soft)] bg-[var(--color-bg)]">
              <img
                v-if="settingsStore.themeImageUrl"
                :src="settingsStore.themeImageUrl"
                :alt="t('settings.general.imageTitle')"
                class="h-full w-full object-cover"
              >
              <span v-else class="text-[10px] text-[var(--color-dim)]">{{ t("settings.general.imageEmpty") }}</span>
            </span>
            <div class="min-w-0 flex-1">
              <p class="m-0 text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.general.imageTitle") }}</p>
              <p class="m-0 text-[11px] text-[var(--color-mut)]">{{ t("settings.general.imageHint") }}</p>
            </div>
            <Switch
              :model-value="imageEnabled"
              :disabled="imageBusy"
              :aria-label="t('settings.general.imageEnabled')"
              data-testid="image-theme-toggle"
              @update:model-value="toggleImage(Boolean($event))"
            />
          </div>

          <p v-if="imageErrorMessage()" class="m-0 text-[11px] text-[var(--color-danger)]" data-testid="image-theme-error">
            {{ imageErrorMessage() }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" type="button" :disabled="imageBusy" data-testid="image-theme-pick" @click="pickImage">
              {{ settingsStore.themeImageUrl ? t("settings.general.imageChange") : t("settings.general.imagePick") }}
            </Button>
            <Button
              v-if="settingsStore.themeImageUrl"
              variant="ghost"
              size="sm"
              type="button"
              data-testid="image-theme-remove"
              @click="settingsStore.clearThemeImage()"
            >
              {{ t("settings.general.imageRemove") }}
            </Button>
          </div>

          <div class="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-2">
            <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.general.imageBlur") }}</span>
            <SliderRange
              :model-value="settings.themeImage.blur"
              :min="0"
              :max="40"
              :step="1"
              :disabled="!imageEnabled"
              :aria-label="t('settings.general.imageBlur')"
              @update:model-value="settingsStore.setThemeImage({ blur: $event })"
            />
            <span class="text-right text-[11px] tabular-nums text-[var(--color-dim)]">{{ settings.themeImage.blur }}</span>
          </div>
          <div class="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-2">
            <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.general.imageDim") }}</span>
            <SliderRange
              :model-value="Math.round(settings.themeImage.dim * 100)"
              :min="0"
              :max="90"
              :step="5"
              :disabled="!imageEnabled"
              :aria-label="t('settings.general.imageDim')"
              @update:model-value="settingsStore.setThemeImage({ dim: $event / 100 })"
            />
            <span class="text-right text-[11px] tabular-nums text-[var(--color-dim)]">{{ Math.round(settings.themeImage.dim * 100) }}%</span>
          </div>
        </div>
        <div class="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3">
          <span class="pt-2 text-[12px] text-[var(--color-mut)]">{{ t("settings.general.accentColor") }}</span>
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2" :aria-label="t('settings.general.accentColor')" role="group">
              <Button
                v-for="color in ACCENT_COLORS"
                :key="color"
                variant="ghost"
                size="icon"
                type="button"
                class="size-9 rounded-full p-1"
                :class="settings.accentColor === color ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-settings-card)]' : ''"
                :aria-label="t(`settings.general.accent.${color}`)"
                :aria-pressed="settings.accentColor === color"
                :title="t(`settings.general.accent.${color}`)"
                @click="settingsStore.setAccentColor(color)"
              >
                <span class="flex size-7 items-center justify-center rounded-full text-[var(--color-bg)]" :style="{ backgroundColor: `var(--accent-preview-${color})` }">
                  <Check v-if="settings.accentColor === color" class="size-4" aria-hidden="true" />
                </span>
              </Button>
            </div>
            <p class="mt-2 text-[11px] text-[var(--color-mut)]">{{ t("settings.general.accentHint") }}</p>
          </div>
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
</template>
