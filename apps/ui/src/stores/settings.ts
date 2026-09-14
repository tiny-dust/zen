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

  function syncFromHash() {
    const hash = window.location.hash;
    if (!hash.startsWith("#settings")) {
      return;
    }
    const parts = hash.slice(1).split("/");
    const tab = (parts[1] || "general") as SettingsTab;
    const allowed: SettingsTab[] = ["general", "profile", "models", "shortcuts"];
    openSettings(allowed.includes(tab) ? tab : "general");
  }

  function bootstrap(): () => void {
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);

    const zen = window.zen;
    if (!zen) {
      return () => {
        window.removeEventListener("hashchange", syncFromHash);
      };
    }

    void zen.settings.get().then((value) => {
      settings.value = value;
    });

    const offChanged = zen.settings.onChanged((value) => {
      settings.value = value;
    });

    return () => {
      offChanged();
      window.removeEventListener("hashchange", syncFromHash);
    };
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
    syncFromHash,
    bootstrap,
    setIcon,
    pickCustomIcon,
    updateShortcut,
  };
});
