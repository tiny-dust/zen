<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings";

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
