<script setup lang="ts">
import { Check } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings";

import { ACCENT_COLORS } from "@zen/shared";
import type { AppLocale, ThemeMode } from "@zen/shared";

/** 外观与语言：主题三档 + 界面语言两档（值即设置项，label 走语言包） */
const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const THEME_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  { value: "dark", labelKey: "settings.general.themeDark" },
  { value: "light", labelKey: "settings.general.themeLight" },
  { value: "system", labelKey: "settings.general.themeSystem" },
];
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
