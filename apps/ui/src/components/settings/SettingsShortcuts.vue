<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { GLOBAL_SHORTCUT_COMMANDS, normalizeShortcutKey } from "@zen/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { shortcutKeyLabel, shortcutKeyParts } from "@/lib/shortcut-display";
import { useSettingsStore } from "@/stores/settings";

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

function onCaptureKey(event: KeyboardEvent, id: string) {
  event.preventDefault();
  event.stopPropagation();

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) {
    parts.push(event.metaKey ? "Cmd" : "Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  const key = event.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) {
    return;
  }

  const pretty =
    key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key.replace("Arrow", "");
  parts.push(pretty);
  void settingsStore.updateShortcut(id, normalizeShortcutKey(parts.join("+")));
}

function canGlobalize(command: string): boolean {
  return GLOBAL_SHORTCUT_COMMANDS.has(command);
}
</script>

<template>
  <section id="set-shortcuts" class="flex flex-col scroll-mt-2">
    <Card size="sm" class="settings-card">
      <CardContent class="p-0">
        <div class="flex flex-col text-[12px]">
          <div
            class="grid grid-cols-[1.2fr_1.4fr_140px_72px] gap-3 border-b border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-dim)]"
          >
            <span>{{ t("settings.shortcut.action") }}</span>
            <span>{{ t("settings.shortcut.command") }}</span>
            <span>{{ t("settings.shortcut.key") }}</span>
            <span
              class="text-right"
              :title="t('settings.shortcut.globalHint')"
            >{{ t("settings.shortcut.global") }}</span>
          </div>
          <div
            v-for="item in settings.shortcuts"
            :key="item.id"
            class="grid grid-cols-[1.2fr_1.4fr_140px_72px] items-center gap-3 border-b border-[var(--color-line-soft)] px-3 py-1.5 last:border-b-0"
          >
            <span class="text-[12px] text-[var(--color-txt-strong)]">{{ t(`settings.shortcut.${item.id}`) }}</span>
            <span
              class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
            >
              {{ item.command }}
            </span>
            <Button
              variant="outline"
              class="h-7 w-full justify-start gap-1 bg-[var(--color-np-btn-bg)] px-2"
              :aria-label="t('settings.shortcut.key')"
              @keydown="onCaptureKey($event, item.id)"
            >
              <Kbd v-for="part in shortcutKeyParts(item.key)" :key="part">
                {{ shortcutKeyLabel(part) }}
              </Kbd>
            </Button>
            <!-- 系统全局注册：仅白名单命令显示开关，其余显示占位符保持对齐 -->
            <div v-if="canGlobalize(item.command)" class="flex justify-end">
              <Switch
                :model-value="item.global === true"
                :aria-label="t('settings.shortcut.global')"
                @update:model-value="(on: boolean) => void settingsStore.setShortcutGlobal(item.id, on)"
              />
            </div>
            <span v-else class="text-right text-[11px] text-[var(--color-dim)]">—</span>
          </div>
        </div>
      </CardContent>
    </Card>
    <p class="m-0 px-1 text-[11px] text-[var(--color-dim)]">
      {{ t("settings.shortcut.globalHint") }}
    </p>
  </section>
</template>
