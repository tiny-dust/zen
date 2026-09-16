<script setup lang="ts">
import { storeToRefs } from "pinia";

import { normalizeShortcutKey } from "@zen/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings";

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
</script>

<template>
  <section class="flex flex-col">
    <Card size="sm" class="settings-card">
      <CardContent class="p-0">
        <div class="flex flex-col text-[12px]">
          <div
            class="grid grid-cols-[1.2fr_1.4fr_140px] gap-3 border-b border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-dim)]"
          >
            <span>功能</span>
            <span>命令</span>
            <span>快捷键</span>
          </div>
          <div
            v-for="item in settings.shortcuts"
            :key="item.id"
            class="grid grid-cols-[1.2fr_1.4fr_140px] items-center gap-3 border-b border-[var(--color-line-soft)] px-3 py-1.5 last:border-b-0"
          >
            <span class="text-[12.5px] text-[var(--color-txt-strong)]">{{ item.label }}</span>
            <span
              class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]"
            >
              {{ item.command }}
            </span>
            <Input
              class="h-7 font-[family-name:var(--font-mono)] text-[12px]"
              :model-value="item.key"
              readonly
              aria-label="快捷键"
              @keydown="onCaptureKey($event, item.id)"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
