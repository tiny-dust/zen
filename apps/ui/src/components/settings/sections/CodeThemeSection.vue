<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { Response } from "@/components/ai-elements/response";
import { CODE_THEMES } from "@/components/ai-elements/response/extensions";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings";

/** 代码主题：选择 + 左浅右深双预览（取色规则见 styles.css 预览节） */
const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const PREVIEW_SNIPPET = `function greet() {
  const name = "world"
  console.log(name)
  return true
}`;
</script>

<template>
  <section id="set-general-code-theme" class="flex flex-col scroll-mt-2">
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
</template>
