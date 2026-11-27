import { defineStore } from "pinia";
import { ref, watch } from "vue";

import { setCodeThemeId } from "@/components/ai-elements/response/extensions";
import { useAppTheme } from "@/composables/useAppTheme";
import { setAppLocale } from "@/locales";
import { useWorkbenchPageStore } from "@/stores/workbench-page";

import type {
  AccentColor,
  AppLocale,
  AppSettings,
  DisplayAccount,
  PhaseModelRef,
  ShortcutBinding,
  CustomTheme,
  ThemeImageSettings,
  ThemeSelection,
} from "@zen/shared";
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_CODE_THEME,
  DEFAULT_LOCALE,
  DEFAULT_SHORTCUTS,
  DEFAULT_THEME,
  DEFAULT_THEME_IMAGE,
  DEFAULT_UPDATE_FEED_URL,
  normalizeAccentColor,
  createCustomThemeId,
  normalizeCustomThemes,
  normalizeShortcutKey,
  normalizeThemeImage,
  normalizeThemeSelection,
} from "@zen/shared";

const fallbackSettings: AppSettings = {
  shortcuts: DEFAULT_SHORTCUTS.map((item) => ({ ...item })),
  updateFeedUrl: DEFAULT_UPDATE_FEED_URL,
  codeTheme: DEFAULT_CODE_THEME,
  theme: DEFAULT_THEME,
  customThemes: [],
  accentColor: DEFAULT_ACCENT_COLOR,
  themeImage: { ...DEFAULT_THEME_IMAGE },
  locale: DEFAULT_LOCALE,
  displayAccount: "auto",
  // 阶段模型缺省 = 不指定，沿用会话模型（与主进程 defaultSettings 对齐）
  planModel: null,
  actModel: null,
};

export type SettingsTab =
  | "general"
  | "appearance"
  | "permissions"
  | "profile"
  | "models"
  | "usage"
  | "pet"
  | "shortcuts"
  | "agent"
  | "lark"
  | "remote"
  | "skills"
  | "mcp"
  | "prompts";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>({ ...fallbackSettings });
  let accentColorWrite: Promise<void> = Promise.resolve();
  let pendingAccentColorWrites = 0;
  let savedAccentColor = settings.value.accentColor;
  const settingsOpen = ref(false);
  const activeTab = ref<SettingsTab>("general");

  function openSettings(tab: SettingsTab = "general") {
    activeTab.value = tab;
    settingsOpen.value = true;
    // 设置是内容区整页（对齐 nomi）：打开即切到设置页，不再弹窗
    useWorkbenchPageStore().open("settings");
  }

  function closeSettings() {
    settingsOpen.value = false;
    const pageStore = useWorkbenchPageStore();
    if (pageStore.page === "settings") {
      pageStore.close();
    }
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
      "pet",
      "shortcuts",
      "agent",
      "lark",
      "remote",
      "skills",
      "mcp",
      "prompts",
    ];
    openSettings(allowed.includes(tab) ? tab : "general");
  }

  function normalizeSettings(value: AppSettings): AppSettings {
    const theme: ThemeSelection = normalizeThemeSelection(value.theme);
    const locale: AppLocale = value.locale === "en-US" ? value.locale : DEFAULT_LOCALE;
    // 老配置里没有的默认快捷键（新增功能）自动补齐；已存在条目尊重用户自定义
    const knownIds = new Set(value.shortcuts.map((item) => item.id));
    const missingDefaults = DEFAULT_SHORTCUTS.filter((item) => !knownIds.has(item.id));
    return {
      ...value,
      theme,
      customThemes: normalizeCustomThemes(value.customThemes),
      accentColor: normalizeAccentColor(value.accentColor),
      themeImage: normalizeThemeImage(value.themeImage),
      locale,
      codeTheme: value.codeTheme || DEFAULT_CODE_THEME,
      planModel: value.planModel ?? null,
      actModel: value.actModel ?? null,
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
  const { setThemeMode, setCustomThemes: applyCustomThemes, setAccentColor: applyAccentColor } = useAppTheme();
  watch(
    () => settings.value.customThemes,
    (customThemes) => applyCustomThemes(customThemes),
    { immediate: true, deep: true },
  );
  watch(
    () => settings.value.accentColor,
    (accentColor) => applyAccentColor(accentColor),
  );
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

    function receiveSettings(value: AppSettings) {
      const incoming = normalizeSettings(value);
      if (!pendingAccentColorWrites) savedAccentColor = incoming.accentColor;
      settings.value = pendingAccentColorWrites
        ? { ...incoming, accentColor: settings.value.accentColor }
        : incoming;
      setCodeThemeId(settings.value.codeTheme);
      // 有登记的图片背景就校验一次：文件被删/损坏时回退，不留一个打不开的背景
      if (settings.value.themeImage.id) {
        void loadThemeImage();
      }
    }

    void zen.settings.get().then(receiveSettings);
    const offChanged = zen.settings.onChanged(receiveSettings);

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
  async function setTheme(theme: ThemeSelection) {
    const zen = window.zen;
    if (!zen) {
      setThemeMode(theme);
      return;
    }
    settings.value = await zen.settings.set({ theme });
  }

  /** 强调色即时切换；写入按选择顺序串行，失败只回滚最后一次选择。 */
  /** 图片背景：data URL 只在内存里，设置文件只存文件名与参数 */
  const themeImageUrl = ref<string>("");
  /** 读取失败原因（文件被移走/损坏）：界面提示并视为未启用 */
  const themeImageError = ref<string>("");

  /** 读图请求序号：慢响应回来时如果用户已经选了别的图，就丢弃，避免旧图覆盖新选择 */
  let imageReadSeq = 0;

  async function loadThemeImage(): Promise<void> {
    const zen = window.zen;
    const { themeImage } = settings.value;
    if (!zen || !themeImage.id) {
      themeImageUrl.value = "";
      return;
    }
    const seq = ++imageReadSeq;
    const result = await zen.themeImage.read(themeImage.id);
    if (seq !== imageReadSeq) {
      return;
    }
    if (result.ok && result.dataUrl) {
      themeImageUrl.value = result.dataUrl;
      themeImageError.value = "";
      return;
    }
    // 文件不在了：清掉文件引用，保留模糊/遮罩参数，下次选图直接沿用
    themeImageUrl.value = "";
    themeImageError.value = result.error ?? "missing";
    settings.value = { ...settings.value, themeImage: { ...themeImage, id: "", enabled: false } };
  }

  async function setThemeImage(partial: Partial<ThemeImageSettings>): Promise<void> {
    const zen = window.zen;
    const current = settings.value.themeImage;
    const next = normalizeThemeImage({ ...current, ...partial });
    settings.value = { ...settings.value, themeImage: next };
    if (!zen) return;
    try {
      settings.value = normalizeSettings(await zen.settings.set({ themeImage: next }));
    } catch {
      settings.value = { ...settings.value, themeImage: current };
    }
  }

  /** 系统选图：主进程负责校验与复制，失败不覆盖当前设置 */
  async function pickThemeImage(): Promise<void> {
    const zen = window.zen;
    if (!zen) return;
    const result = await zen.themeImage.pick();
    if (!result.ok || !result.id) {
      if (!result.canceled) {
        themeImageError.value = result.error ?? "pick-failed";
      }
      return;
    }
    themeImageError.value = "";
    await loadThemeImageById(result.id);
    const before = settings.value.themeImage;
    await setThemeImage({ id: result.id, enabled: true });
    // 保存没成功（后端拒绝/写盘失败）：把刚写入的新文件删掉，别留下孤儿
    if (settings.value.themeImage.id !== result.id) {
      await window.zen?.themeImage.clear(result.id).catch(() => undefined);
      themeImageError.value = "pick-failed";
      settings.value = { ...settings.value, themeImage: before };
    }
  }

  async function loadThemeImageById(id: string): Promise<void> {
    const zen = window.zen;
    if (!zen) return;
    const seq = ++imageReadSeq;
    const result = await zen.themeImage.read(id);
    if (seq !== imageReadSeq) {
      return;
    }
    themeImageUrl.value = result.ok && result.dataUrl ? result.dataUrl : "";
    themeImageError.value = result.ok ? "" : result.error ?? "missing";
  }

  /** 清除背景：先清引用，文件由主进程在设置落盘后按「不再被引用」删除 */
  async function clearThemeImage(): Promise<void> {
    themeImageUrl.value = "";
    themeImageError.value = "";
    await setThemeImage({ id: "", enabled: false });
  }

  /** 保存（新建或覆盖）一个自定义主题 */
  async function saveCustomTheme(theme: CustomTheme): Promise<void> {
    const zen = window.zen;
    const exists = settings.value.customThemes.some((item) => item.id === theme.id);
    const customThemes = exists
      ? settings.value.customThemes.map((item) => (item.id === theme.id ? theme : item))
      : [...settings.value.customThemes, theme].slice(0, 50);
    if (!zen) {
      settings.value = { ...settings.value, customThemes };
      return;
    }
    settings.value = normalizeSettings(await zen.settings.set({ customThemes }));
  }

  /** 删除自定义主题：删的是当前使用的那个时先退回预设，避免主题指向不存在的 id */
  async function deleteCustomTheme(id: string): Promise<void> {
    const zen = window.zen;
    const customThemes = settings.value.customThemes.filter((item) => item.id !== id);
    const active = settings.value.theme === `custom:${id}`;
    const fallbackTheme: ThemeSelection = DEFAULT_THEME;
    if (!zen) {
      settings.value = {
        ...settings.value,
        customThemes,
        ...(active ? { theme: fallbackTheme } : {}),
      };
      return;
    }
    settings.value = normalizeSettings(
      await zen.settings.set(active ? { customThemes, theme: fallbackTheme } : { customThemes }),
    );
  }

  /** 导入主题包（JSON 或 ZIP）：主进程已完成解析与背景图落盘，这里只分配新 id */
  async function importThemePack(): Promise<{ ok: boolean; id?: string; canceled?: boolean; error?: string }> {
    const zen = window.zen;
    if (!zen) {
      return { ok: false, error: "unsupported" };
    }
    const result = await zen.themePack.import();
    if (!result.ok || !result.pack) {
      return { ok: false, canceled: result.canceled, error: result.error ?? "import-failed" };
    }
    const theme: CustomTheme = { id: createCustomThemeId(), ...result.pack };
    await saveCustomTheme(theme);
    return { ok: true, id: theme.id };
  }

  async function exportThemePack(id: string): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    const zen = window.zen;
    const theme = settings.value.customThemes.find((item) => item.id === id);
    if (!zen || !theme) {
      return { ok: false, error: "missing" };
    }
    return zen.themePack.export(theme);
  }

  async function setAccentColor(accentColor: AccentColor) {
    const zen = window.zen;
    if (zen && !pendingAccentColorWrites) savedAccentColor = settings.value.accentColor;
    settings.value = { ...settings.value, accentColor };
    if (!zen) return;
    pendingAccentColorWrites++;
    const write = accentColorWrite.then(async () => {
      try {
        const saved = normalizeSettings(await zen.settings.set({ accentColor }));
        savedAccentColor = saved.accentColor;
        settings.value = { ...saved, accentColor: settings.value.accentColor };
      } catch (error) {
        if (pendingAccentColorWrites === 1) {
          settings.value = { ...settings.value, accentColor: savedAccentColor };
        }
        throw error;
      } finally {
        pendingAccentColorWrites--;
      }
    });
    accentColorWrite = write.then(() => undefined, () => undefined);
    return write;
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

  /** 阶段模型全局默认：phase 对应 plan/act；model 为 null = 不指定（跟随会话模型） */
  async function setPhaseModelDefault(phase: "plan" | "act", model: PhaseModelRef | null) {
    const next =
      model && model.providerId && model.modelId
        ? { providerId: model.providerId, modelId: model.modelId }
        : null;
    const zen = window.zen;
    if (!zen) {
      settings.value = {
        ...settings.value,
        ...(phase === "plan" ? { planModel: next } : { actModel: next }),
      };
      return;
    }
    const saved =
      phase === "plan"
        ? await zen.settings.set({ planModel: next })
        : await zen.settings.set({ actModel: next });
    settings.value = normalizeSettings(saved);
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
    saveCustomTheme,
    deleteCustomTheme,
    importThemePack,
    exportThemePack,
    setAccentColor,
    themeImageUrl,
    themeImageError,
    setThemeImage,
    pickThemeImage,
    clearThemeImage,
    loadThemeImage,
    setLocale,
    updateShortcut,
    setShortcutGlobal,
    setDisplayAccount,
    setPhaseModelDefault,
  };
});
