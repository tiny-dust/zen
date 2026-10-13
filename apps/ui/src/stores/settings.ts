import { defineStore } from "pinia";
import { ref, watch } from "vue";

import { setCodeThemeId } from "@/components/ai-elements/response/extensions";
import { useAppTheme } from "@/composables/useAppTheme";
import { setAppLocale } from "@/locales";

import type { AppLocale, AppSettings, DisplayAccount, ShortcutBinding, ThemeMode } from "@zen/shared";
import {
  DEFAULT_CODE_THEME,
  DEFAULT_LOCALE,
  DEFAULT_SHORTCUTS,
  DEFAULT_THEME,
  DEFAULT_UPDATE_FEED_URL,
  normalizeShortcutKey,
} from "@zen/shared";

const fallbackSettings: AppSettings = {
  shortcuts: DEFAULT_SHORTCUTS.map((item) => ({ ...item })),
  updateFeedUrl: DEFAULT_UPDATE_FEED_URL,
  codeTheme: DEFAULT_CODE_THEME,
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  displayAccount: "auto",
};

export type SettingsTab =
  | "general"
  | "appearance"
  | "permissions"
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
      "appearance",
      "permissions",
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
    const theme: ThemeMode =
      value.theme === "light" || value.theme === "system" ? value.theme : DEFAULT_THEME;
    const locale: AppLocale = value.locale === "en-US" ? value.locale : DEFAULT_LOCALE;
    // 老配置里没有的默认快捷键（新增功能）自动补齐；已存在条目尊重用户自定义
    const knownIds = new Set(value.shortcuts.map((item) => item.id));
    const missingDefaults = DEFAULT_SHORTCUTS.filter((item) => !knownIds.has(item.id));
    return {
      ...value,
      theme,
      locale,
      codeTheme: value.codeTheme || DEFAULT_CODE_THEME,
      shortcuts: [
        ...value.shortcuts.map((item) => ({
          ...item,
          key: normalizeShortcutKey(item.key),
        })),
        ...missingDefaults,
      ],
    };
  }

  // 主题与语言是全局副作用：settings 一变（含其它窗口的 onChanged 广播）即刻应用
  const { setThemeMode } = useAppTheme();
  watch(
    () => settings.value.theme,
    (theme) => {
      setThemeMode(theme);
    },
  );
  watch(
    () => settings.value.locale,
    (locale) => {
      setAppLocale(locale);
    },
  );

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

  /** 切换界面主题三档（dark/light/system）：主进程同步 nativeTheme，渲染层 watch 生效 */
  async function setTheme(theme: ThemeMode) {
    const zen = window.zen;
    if (!zen) {
      setThemeMode(theme);
      return;
    }
    settings.value = await zen.settings.set({ theme });
  }

  /** 切换界面语言：即时生效 + 持久化 */
  async function setLocale(locale: AppLocale) {
    const zen = window.zen;
    if (!zen) {
      setAppLocale(locale);
      return;
    }
    settings.value = await zen.settings.set({ locale });
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

  /** 切换某快捷键的系统全局注册（仅白名单命令允许开启） */
  async function setShortcutGlobal(id: string, on: boolean) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    const shortcuts: ShortcutBinding[] = settings.value.shortcuts.map((item) =>
      item.id === id ? { ...item, global: on || undefined } : item,
    );
    settings.value = await zen.settings.set({ shortcuts: JSON.parse(JSON.stringify(shortcuts)) });
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
    setFeedUrl,
    setCodeTheme,
    setTheme,
    setLocale,
    updateShortcut,
    setShortcutGlobal,
    setDisplayAccount,
  };
});
