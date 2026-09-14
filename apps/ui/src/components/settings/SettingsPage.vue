<script setup lang="ts">
import {
  Keyboard,
  Settings2,
  UserRound,
  Boxes,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import SettingsModels from "@/components/settings/SettingsModels.vue";
import SettingsProfile from "@/components/settings/SettingsProfile.vue";
import AppIcon from "@/components/base/AppIcon.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings";
import { BUILTIN_APP_ICONS } from "@zen/shared";

import type { SettingsTab } from "@/stores/settings";

const settingsStore = useSettingsStore();
const { settings, settingsOpen, activeTab } = storeToRefs(settingsStore);

const search = ref("");
const menuBarVisible = ref(true);

const navGroups = computed(() => [
  {
    title: "个人",
    items: [
      { id: "general" as const, label: "常规", icon: Settings2 },
      { id: "profile" as const, label: "个人资料", icon: UserRound },
      { id: "models" as const, label: "模型", icon: Boxes },
      { id: "shortcuts" as const, label: "键盘快捷键", icon: Keyboard },
    ],
  },
]);

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) {
    return navGroups.value;
  }
  return navGroups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
    }))
    .filter((group) => group.items.length > 0);
});

const tab = computed({
  get: () => activeTab.value,
  set: (value: SettingsTab) => {
    settingsStore.openSettings(value);
  },
});

const showAppearance = computed(() => activeTab.value === "general");

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
  void settingsStore.updateShortcut(id, parts.join("+"));
}
</script>

<template>
  <div v-if="settingsOpen" class="overlay" @click.self="settingsStore.closeSettings()">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="设置">
      <aside class="nav">
        <div class="nav-title">设置</div>
        <Input v-model="search" class="nav-search" placeholder="搜索设置" />

        <ScrollArea class="nav-scroll">
          <div class="nav-groups">
            <div v-for="group in filteredGroups" :key="group.title" class="nav-group">
              <div class="nav-group-title">{{ group.title }}</div>
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="nav-item"
                :class="{ 'is-active': tab === item.id }"
                @click="tab = item.id as SettingsTab"
              >
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>
        </ScrollArea>
      </aside>

      <main class="pane">
        <header class="pane-head">
          <h2>{{ activeTab === "models" ? "模型" : activeTab === "profile" ? "个人资料" : activeTab === "shortcuts" ? "键盘快捷键" : "常规" }}</h2>
          <Button variant="ghost" size="icon" class="close" aria-label="关闭" @click="settingsStore.closeSettings()">
            ×
          </Button>
        </header>

        <ScrollArea class="pane-body">
          <div class="pane-inner">
            <template v-if="activeTab === 'general'">
              <section class="section">
                <h3>常规</h3>
                <Card>
                  <CardContent class="divide-y divide-border p-0">
                    <div class="row">
                      <div>
                        <div class="row-title">默认打开目标</div>
                        <div class="row-desc">默认用哪个程序打开文件夹/位置</div>
                      </div>
                      <Badge variant="secondary">Finder</Badge>
                    </div>
                    <div class="row">
                      <div>
                        <div class="row-title">默认新建项目位置</div>
                        <div class="row-desc">新建空白项目默认落盘位置</div>
                      </div>
                      <Button variant="ghost" size="sm">选择目录</Button>
                    </div>
                    <div class="row">
                      <div>
                        <div class="row-title">语言</div>
                        <div class="row-desc">应用 UI 语言</div>
                      </div>
                      <Badge variant="outline">简体中文</Badge>
                    </div>
                    <div class="row">
                      <div>
                        <div class="row-title">在菜单栏中显示</div>
                        <div class="row-desc">在 macOS 菜单栏显示 Zen 图标</div>
                      </div>
                      <Switch v-model="menuBarVisible" />
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section v-if="showAppearance" class="section">
                <h3>软件图标</h3>
                <Card>
                  <CardHeader>
                    <CardTitle class="text-sm">应用图标</CardTitle>
                    <CardDescription>切换后窗口 / Dock 图标会立即更新。</CardDescription>
                  </CardHeader>
                  <CardContent class="flex flex-col gap-3">
                    <div class="icon-grid">
                      <button
                        v-for="item in BUILTIN_APP_ICONS"
                        :key="item.id"
                        type="button"
                        class="icon-card"
                        :class="{ 'is-active': settings.iconId === item.id }"
                        @click="settingsStore.setIcon(item.id)"
                      >
                        <AppIcon :id="item.id" :size="40" />
                        <span>{{ item.label }}</span>
                      </button>
                      <button
                        type="button"
                        class="icon-card"
                        :class="{ 'is-active': settings.iconId === 'custom' }"
                        @click="settingsStore.pickCustomIcon()"
                      >
                        <AppIcon id="custom-preview" :size="40" :custom-path="settings.customIconPath" />
                        <span>自定义</span>
                      </button>
                    </div>
                    <Button variant="outline" size="sm" class="w-fit" @click="settingsStore.pickCustomIcon()">
                      上传图标…
                    </Button>
                  </CardContent>
                </Card>
              </section>
            </template>

            <SettingsProfile v-else-if="activeTab === 'profile'" />

            <SettingsModels v-else-if="activeTab === 'models'" />

            <section v-else-if="activeTab === 'shortcuts'" class="section">
              <h3>键盘快捷键</h3>
              <Card>
                <CardContent class="p-0">
                  <table class="shortcut-table">
                    <thead>
                      <tr>
                        <th>功能</th>
                        <th>命令</th>
                        <th>快捷键</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in settings.shortcuts" :key="item.id">
                        <td>{{ item.label }}</td>
                        <td class="command">{{ item.command }}</td>
                        <td>
                          <Input
                            class="key-input"
                            :model-value="item.key"
                            readonly
                            @keydown="onCaptureKey($event, item.id)"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </section>
          </div>
        </ScrollArea>
      </main>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--color-scrim);
  display: grid;
  place-items: center;
}

.sheet {
  width: min(980px, calc(100vw - 40px));
  height: min(720px, calc(100vh - 48px));
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  border-radius: 16px;
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  color: var(--color-txt);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 12px;
  border-right: 1px solid var(--color-line);
  background: color-mix(in srgb, var(--color-side) 92%, transparent);
  min-height: 0;
}

.nav-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-txt-strong);
  padding: 0 4px;
}

.nav-search {
  width: 100%;
}

.nav-scroll {
  flex: 1;
  min-height: 0;
}

.nav-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 12px;
}

.nav-group-title {
  padding: 0 10px 6px;
  font-size: 11px;
  color: var(--color-mut);
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--color-mut);
  font-size: 13px;
  text-align: left;
}

.nav-item svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.nav-item:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt);
}

.nav-item.is-active {
  background: var(--color-side-sel);
  color: var(--color-txt-strong);
  font-weight: 500;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 8px;
}

.pane-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.close {
  color: var(--color-mut);
  font-size: 18px;
}

.pane-body {
  flex: 1;
  min-height: 0;
}

.pane-inner {
  padding: 8px 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.row-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-txt-strong);
}

.row-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-mut);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.icon-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 8px;
  border-radius: 12px;
  border: 1px solid var(--color-line);
  background: var(--color-composer-surface);
  color: var(--color-mut);
  font-size: 12px;
}

.icon-card.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-line));
  color: var(--color-txt-strong);
}

.shortcut-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.shortcut-table th,
.shortcut-table td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-line-soft);
}

.shortcut-table th {
  color: var(--color-mut);
  font-weight: 500;
}

.command {
  font-family: var(--font-mono);
  color: var(--color-dim);
  font-size: 11px;
}

.key-input {
  width: 140px;
}
</style>
