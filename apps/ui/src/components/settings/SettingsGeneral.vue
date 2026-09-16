<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref } from "vue";

import AppIcon from "@/components/base/AppIcon.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings";
import { BUILTIN_APP_ICONS } from "@zen/shared";

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const menuBarVisible = ref(true);
</script>

<template>
  <section class="flex flex-col">
    <Card size="sm" class="settings-card">
      <CardContent class="p-0">
        <div class="settings-row">
          <div>
            <div class="settings-row-title">默认打开目标</div>
            <div class="settings-row-desc">默认用哪个程序打开文件夹/位置</div>
          </div>
          <Badge variant="secondary">Finder</Badge>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">默认新建项目位置</div>
            <div class="settings-row-desc">新建空白项目默认落盘位置</div>
          </div>
          <Button variant="ghost" size="sm">选择目录</Button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">语言</div>
            <div class="settings-row-desc">应用 UI 语言</div>
          </div>
          <Badge variant="outline">简体中文</Badge>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">在菜单栏中显示</div>
            <div class="settings-row-desc">在 macOS 菜单栏显示 Zen 图标</div>
          </div>
          <Switch v-model="menuBarVisible" />
        </div>
      </CardContent>
    </Card>
  </section>

  <section class="flex flex-col">
    <h3 class="settings-section-title">应用图标</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col gap-3 p-4">
        <p class="mb-0 text-[12px] text-[var(--color-mut)]">切换后窗口 / Dock 图标会立即更新。</p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5">
          <button
            v-for="item in BUILTIN_APP_ICONS"
            :key="item.id"
            type="button"
            class="flex flex-col items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 py-3 text-[12px] text-[var(--color-mut)] transition-colors hover:border-[var(--color-btn-border)] hover:text-[var(--color-txt)]"
            :class="settings.iconId === item.id ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] text-[var(--color-txt-strong)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : ''"
            @click="settingsStore.setIcon(item.id)"
          >
            <AppIcon :id="item.id" :size="40" />
            <span>{{ item.label }}</span>
          </button>
          <button
            type="button"
            class="flex flex-col items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2 py-3 text-[12px] text-[var(--color-mut)] transition-colors hover:border-[var(--color-btn-border)] hover:text-[var(--color-txt)]"
            :class="settings.iconId === 'custom' ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] text-[var(--color-txt-strong)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : ''"
            @click="settingsStore.pickCustomIcon()"
          >
            <AppIcon
              id="custom-preview"
              :size="40"
              :custom-path="settings.customIconPath"
            />
            <span>自定义</span>
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="w-fit"
          @click="settingsStore.pickCustomIcon()"
        >
          上传图标…
        </Button>
      </CardContent>
    </Card>
  </section>
</template>
