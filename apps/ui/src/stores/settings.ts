import { defineStore } from "pinia";
import { ref } from "vue";

import { setCodeThemeId } from "@/components/ai-elements/response/extensions";

import type { AppIconId, AppSettings, DisplayAccount, ShortcutBinding } from "@zen/shared";
import { DEFAULT_CODE_THEME, DEFAULT_SHORTCUTS, DEFAULT_UPDATE_FEED_URL, normalizeShortcutKey } from "@zen/shared";

const fallbackSettings: AppSettings = {
  iconId: "zen-ink",
  customIconPath: null,
  shortcuts: DEFAULT_SHORTCUTS.map((item) => ({ ...item })),
  updateFeedUrl: DEFAULT_UPDATE_FEED_URL,
  codeTheme: DEFAULT_CODE_THEME,
  displayAccount: "auto",
};

export type SettingsTab =
  | "general"
  | "profile"
  | "models"
  | "shortcuts"
  | "agent"
  | "lark"
  | "skills"
  | "mcp"
  | "prompts";

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
    const allowed: SettingsTab[] = [
      "general",
      "profile",
      "models",
      "shortcuts",
      "agent",
      "lark",
      "skills",
      "mcp",
      "prompts",
    ];
    openSettings(allowed.includes(tab) ? tab : "general");
  }

  function normalizeSettings(value: AppSettings): AppSettings {
    return {
      ...value,
      codeTheme: value.codeTheme || DEFAULT_CODE_THEME,
      shortcuts: value.shortcuts.map((item) => ({
        ...item,
        key: normalizeShortcutKey(item.key),
      })),
    };
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
      settings.value = normalizeSettings(value);
      setCodeThemeId(settings.value.codeTheme);
    });

    const offChanged = zen.settings.onChanged((value) => {
      settings.value = normalizeSettings(value);
      setCodeThemeId(settings.value.codeTheme);
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

  async function setFeedUrl(url: string | null) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    settings.value = await zen.settings.set({ updateFeedUrl: url });
  }

  /** 切换代码高亮主题：持久化 + 即时驱动渲染层刷新 */
  async function setCodeTheme(id: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    setCodeThemeId(id);
    settings.value = await zen.settings.set({ codeTheme: id });
  }

  async function updateShortcut(id: string, key: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    const normalizedKey = normalizeShortcutKey(key);
    if (!normalizedKey) {
      return;
    }
    const shortcuts: ShortcutBinding[] = settings.value.shortcuts.map((item) =>
      item.id === id ? { ...item, key: normalizedKey } : item,
    );
    settings.value = await zen.settings.set({ shortcuts });
  }

  /** 切换左下角/资料页展示的账户身份（持久化） */
  async function setDisplayAccount(value: DisplayAccount) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    settings.value = await zen.settings.set({ displayAccount: value });
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
    setFeedUrl,
    setCodeTheme,
    updateShortcut,
    setDisplayAccount,
  };
});
