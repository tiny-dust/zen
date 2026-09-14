<script setup lang="ts">
import { Boxes, Keyboard, Settings2, UserRound } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import AppIcon from "@/components/base/AppIcon.vue";
import SettingsModels from "@/components/settings/SettingsModels.vue";
import SettingsProfile from "@/components/settings/SettingsProfile.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const paneTitle = computed(() => {
  switch (activeTab.value) {
    case "models":
      return "模型";
    case "profile":
      return "个人资料";
    case "shortcuts":
      return "键盘快捷键";
    default:
      return "常规";
  }
});

function selectTab(next: SettingsTab) {
  settingsStore.openSettings(next);
  const hash = `#settings/${next}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

watch(
  () => settingsOpen.value,
  (open) => {
    if (!open && window.location.hash.startsWith("#settings")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  },
);

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
        <Input v-model="search" class="nav-search !h-8 !text-sm" placeholder="搜索设置" />

        <div class="nav-scroll">
          <div class="nav-groups">
            <div v-for="group in filteredGroups" :key="group.title" class="nav-group">
              <div class="nav-group-title">{{ group.title }}</div>
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="nav-item"
                :class="{ 'is-active': activeTab === item.id }"
                @click="selectTab(item.id)"
              >
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main class="pane">
        <header class="pane-head">
          <h2>{{ paneTitle }}</h2>
          <Button
            variant="ghost"
            size="icon"
            class="close-btn"
            aria-label="关闭"
            @click="settingsStore.closeSettings()"
          >
            ×
          </Button>
        </header>

        <div class="pane-body">
          <div class="pane-inner">
            <template v-if="activeTab === 'general'">
              <section class="section">
                <h3>常规</h3>
                <Card size="sm" class="settings-card">
                  <CardContent class="p-0">
                    <div class="row">
                      <div class="row-text">
                        <div class="row-title">默认打开目标</div>
                        <div class="row-desc">默认用哪个程序打开文件夹/位置</div>
                      </div>
                      <Badge variant="secondary">Finder</Badge>
                    </div>
                    <div class="row">
                      <div class="row-text">
                        <div class="row-title">默认新建项目位置</div>
                        <div class="row-desc">新建空白项目默认落盘位置</div>
                      </div>
                      <Button variant="ghost" size="sm">选择目录</Button>
                    </div>
                    <div class="row">
                      <div class="row-text">
                        <div class="row-title">语言</div>
                        <div class="row-desc">应用 UI 语言</div>
                      </div>
                      <Badge variant="outline">简体中文</Badge>
                    </div>
                    <div class="row">
                      <div class="row-text">
                        <div class="row-title">在菜单栏中显示</div>
                        <div class="row-desc">在 macOS 菜单栏显示 Zen 图标</div>
                      </div>
                      <Switch v-model="menuBarVisible" />
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section class="section">
                <h3>软件图标</h3>
                <Card size="sm" class="settings-card">
                  <CardHeader>
                    <CardTitle class="text-sm">应用图标</CardTitle>
                  </CardHeader>
                  <CardContent class="flex flex-col gap-3 pt-0">
                    <p class="mt-[-8px] text-xs text-muted-foreground">
                      切换后窗口 / Dock 图标会立即更新。
                    </p>
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

            <SettingsProfile v-else-if="activeTab === 'profile'" />

            <SettingsModels v-else-if="activeTab === 'models'" />

            <section v-else-if="activeTab === 'shortcuts'" class="section">
              <h3>键盘快捷键</h3>
              <Card size="sm" class="settings-card">
                <CardContent class="p-0">
                  <div class="shortcut-table-wrap">
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
                              class="key-input !h-7 !text-xs"
                              :model-value="item.key"
                              readonly
                              @keydown="onCaptureKey($event, item.id)"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
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
  width: min(960px, calc(100vw - 40px));
  height: min(700px, calc(100vh - 48px));
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
  background: #141414;
  min-height: 0;
  overflow: hidden;
}

.nav-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-txt-strong);
  padding: 0 4px;
}

.nav-search {
  width: 100%;
  flex: none;
}

.nav-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
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
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--color-mut);
  font-size: 13px;
  text-align: left;
}

.nav-item :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.nav-item:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt);
}

.nav-item.is-active {
  background: #2a2a2a;
  color: var(--color-txt-strong);
  font-weight: 500;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.pane-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 10px;
}

.pane-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.close-btn {
  color: var(--color-mut);
  font-size: 20px;
  line-height: 1;
}

.pane-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.pane-inner {
  padding: 4px 22px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.section h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.settings-card {
  border-color: var(--color-line);
  background: #1f1f1f;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.row + .row {
  border-top: 1px solid var(--color-line-soft);
}

.row-text {
  min-width: 0;
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
  background: #181818;
  color: var(--color-mut);
  font-size: 12px;
}

.icon-card:hover {
  border-color: var(--color-btn-border);
  color: var(--color-txt);
}

.icon-card.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-line));
  color: var(--color-txt-strong);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
}

.shortcut-table-wrap {
  overflow-x: auto;
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
  vertical-align: middle;
  white-space: nowrap;
}

.shortcut-table tr:last-child td {
  border-bottom: 0;
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
