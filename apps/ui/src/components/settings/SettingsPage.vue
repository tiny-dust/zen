<script setup lang="ts">
import { storeToRefs } from "pinia";

import AppIcon from "@/components/base/AppIcon.vue";
import BaseButton from "@/components/base/BaseButton.vue";
import SettingsProfile from "@/components/settings/SettingsProfile.vue";
import { useSettingsStore } from "@/stores/settings";
import { BUILTIN_APP_ICONS } from "@zen/shared";

const settingsStore = useSettingsStore();
const { settings, settingsOpen } = storeToRefs(settingsStore);

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
      <header class="header">
        <h2>设置</h2>
        <button type="button" class="close" aria-label="关闭" @click="settingsStore.closeSettings()">
          ×
        </button>
      </header>

      <div class="content">
        <SettingsProfile />

        <section class="section">
          <h3>软件图标</h3>
          <p class="hint">选择内置图标，或上传本地图标。切换后窗口 / Dock 图标会立即更新。</p>
          <div class="icon-grid">
            <button
              v-for="item in BUILTIN_APP_ICONS"
              :key="item.id"
              type="button"
              class="icon-card"
              :class="{ 'is-active': settings.iconId === item.id }"
              @click="settingsStore.setIcon(item.id)"
            >
              <AppIcon :id="item.id" :size="48" />
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
                :size="48"
                :custom-path="settings.customIconPath"
              />
              <span>自定义</span>
            </button>
          </div>
          <BaseButton variant="ghost" @click="settingsStore.pickCustomIcon()">
            上传图标…
          </BaseButton>
        </section>

        <section class="section">
          <h3>快捷键</h3>
          <p class="hint">
            默认对齐 VS Code 快捷键体系（命令 ID + 键位）。点击键位后直接按下新的组合键即可修改。
          </p>
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
                  <input
                    class="key-input"
                    :value="item.key"
                    readonly
                    @keydown="onCaptureKey($event, item.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--color-scrim, #00000061);
  display: grid;
  place-items: center;
}

.sheet {
  width: min(720px, calc(100vw - 48px));
  max-height: min(760px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-line);
}

.header h2 {
  margin: 0;
  font-size: 14px;
  color: var(--color-txt-strong);
}

.close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--color-mut);
  font-size: 18px;
  line-height: 1;
}

.close:hover {
  background: var(--color-menu-hover);
  color: var(--color-txt-strong);
}

.content {
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.section h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--color-txt-strong);
}

.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--color-mut);
  line-height: 1.5;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.icon-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-composer-surface);
  color: var(--color-mut);
  font-size: 12px;
}

.icon-card:hover {
  border-color: var(--color-btn-border);
  color: var(--color-txt);
}

.icon-card.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-line));
  color: var(--color-txt-strong);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
}

.shortcut-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.shortcut-table th,
.shortcut-table td {
  text-align: left;
  padding: 8px 6px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
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
  min-height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-input-bg);
  color: var(--color-txt-strong);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}

.key-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-line));
}
</style>
