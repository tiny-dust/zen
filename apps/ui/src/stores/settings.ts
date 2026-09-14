import { defineStore } from "pinia";
import { ref } from "vue";

import type { AppIconId, AppSettings, ShortcutBinding } from "@zen/shared";
import { DEFAULT_SHORTCUTS } from "@zen/shared";

const fallbackSettings: AppSettings = {
  iconId: "zen-ink",
  customIconPath: null,
  shortcuts: DEFAULT_SHORTCUTS.map((item) => ({ ...item })),
};

export type SettingsTab = "general" | "profile" | "models" | "shortcuts";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>({ ...fallbackSettings });
  const settingsOpen = ref(false);
  const activeTab = ref<SettingsTab>("general");

  function openSettings(tab: SettingsTab = "general") {
    activeTab.value = tab;
    settingsOpen.value = true;
  }

  function closeSettings() {
    settingsOpen.value = false;
  }

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen) {
      return () => undefined;
    }

    void zen.settings.get().then((value) => {
      settings.value = value;
    });

    return zen.settings.onChanged((value) => {
      settings.value = value;
    });
  }

  async function setIcon(iconId: Exclude<AppIconId, "custom">) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    settings.value = await zen.settings.set({
      iconId,
      customIconPath: null,
    });
    await zen.settings.applyIcon();
  }

  async function pickCustomIcon() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    settings.value = await zen.settings.pickIcon();
  }

  async function updateShortcut(id: string, key: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    const shortcuts: ShortcutBinding[] = settings.value.shortcuts.map((item) =>
      item.id === id ? { ...item, key } : item,
    );
    settings.value = await zen.settings.set({ shortcuts });
  }

  return {
    settings,
    settingsOpen,
    activeTab,
    openSettings,
    closeSettings,
    bootstrap,
    setIcon,
    pickCustomIcon,
    updateShortcut,
  };
});
