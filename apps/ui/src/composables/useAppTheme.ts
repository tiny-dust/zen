import { computed, ref, watchEffect } from "vue";

import {
  DEFAULT_THEME,
  DEFAULT_THEME as DEFAULT_PRESET,
  ZEN_THEME_TOKENS,
  deriveZenTokens,
  isDarkPreset,
  normalizeAccentColor,
  normalizeTheme,
  normalizeThemeSelection,
  parseCustomThemeValue,
  resolveCustomBase,
} from "@zen/shared";

import type { AccentColor, CustomTheme, ThemeBase, ThemeMode, ThemePreset, ThemeSelection } from "@zen/shared";

/** 本地镜像键：首帧免 IPC 往返直接上主题（设置加载后由 settings store 校正） */
const THEME_MIRROR_KEY = "zen.theme.id";
/** 旧版只镜像深浅：读到它说明升级前保存过，按深浅回退成 light / dark */
const LEGACY_DARK_KEY = "zen.theme.dark";
const ACCENT_MIRROR_KEY = "zen.theme.accent";

/** 首帧读取上次生效的强调色；无效或旧配置回退为暖橙。 */
export function cachedAccentColor(): AccentColor {
  try {
    return normalizeAccentColor(localStorage.getItem(ACCENT_MIRROR_KEY));
  } catch {
    return normalizeAccentColor(null);
  }
}

const accentColor = ref<AccentColor>(cachedAccentColor());
const mode = ref<ThemeSelection>(DEFAULT_THEME);
/** 自定义主题定义（来自设置）：只有被选中时才参与渲染 */
const customThemes = ref<CustomTheme[]>([]);
const systemDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);

// system 档跟随操作系统；dark/light 固定档下该值仍会变，但计算时被忽略
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
mediaQuery.addEventListener("change", (event) => {
  systemDark.value = event.matches;
});

/** 当前选中的自定义主题定义；未选中自定义主题时为 null */
const activeCustom = computed<CustomTheme | null>(() => {
  const id = parseCustomThemeValue(mode.value);
  return id ? (customThemes.value.find((theme) => theme.id === id) ?? null) : null;
});

/** 自定义主题实际用哪套明暗（带变体就跟随系统） */
const activeBase = computed<ThemeBase | null>(() =>
  activeCustom.value ? resolveCustomBase(activeCustom.value, systemDark.value) : null,
);

/** 当前生效主题是否深色：自定义主题看自己的基底；预设自己决定；system 跟随操作系统 */
/** 主题选择指向不存在的自定义主题时，整体回退默认预设（不能停在半套颜色上） */
const missingCustom = computed(
  () => mode.value.startsWith("custom:") && !activeCustom.value,
);

const isDark = computed(() =>
  activeBase.value
    ? activeBase.value === "dark"
    : isDarkPreset(
        missingCustom.value ? DEFAULT_PRESET : (normalizeTheme(mode.value) as ThemeMode),
        systemDark.value,
      ),
);

/** 实际渲染的预设 id：system 与自定义主题都解析成 light / dark，供 CSS 的 data-theme 使用 */
const activePreset = computed(() => {
  if (activeBase.value) {
    return activeBase.value;
  }
  if (missingCustom.value) {
    return isDarkPreset(DEFAULT_PRESET, systemDark.value) ? "dark" : "light";
  }
  return mode.value === "system" ? (systemDark.value ? "dark" : "light") : (mode.value as ThemePreset);
});

/** 已写进 :root 的自定义变量：切回预设时要撤掉，避免残留覆盖 */
const appliedTokens = new Set<string>();

watchEffect(() => {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark.value);
  root.dataset.theme = activePreset.value;

  // 只写白名单变量、只写颜色值：导入文件不会变成可执行样式
  const tokens = activeCustom.value && activeBase.value
    ? deriveZenTokens(activeCustom.value, activeBase.value)
    : {};
  for (const name of ZEN_THEME_TOKENS) {
    if (appliedTokens.has(name) && !(name in tokens)) {
      root.style.removeProperty(name);
      appliedTokens.delete(name);
    }
  }
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
    appliedTokens.add(name);
  }

  try {
    localStorage.setItem(THEME_MIRROR_KEY, activePreset.value);
  } catch {
    // localStorage 不可用（隐私模式等）：只影响下次首帧，忽略
  }
});

watchEffect(() => {
  document.documentElement.dataset.accentColor = accentColor.value;
  try {
    localStorage.setItem(ACCENT_MIRROR_KEY, accentColor.value);
  } catch {
    // 与深浅主题镜像一样：只影响下次首帧
  }
});

/** 读取首帧镜像（main.ts 挂载前调用，避免亮色用户看到深色闪烁） */
export function cachedTheme(): { preset: string; dark: boolean } {
  let stored: string | null = null;
  let legacyDark: string | null = null;
  try {
    stored = localStorage.getItem(THEME_MIRROR_KEY);
    legacyDark = localStorage.getItem(LEGACY_DARK_KEY);
  } catch {
    // 读不到就按默认
  }
  if (stored) {
    const theme = normalizeThemeSelection(stored);
    // 首帧读不到自定义主题定义，统一落回它上一次解析出的 light / dark 基底
    const preset = theme === "system" || theme.startsWith("custom:")
      ? (legacyDark === "0" ? "light" : "dark")
      : theme;
    if (theme.startsWith("custom:")) {
      return { preset, dark: legacyDark !== "0" };
    }
    return { preset, dark: isDarkPreset(normalizeTheme(theme), legacyDark !== "0") };
  }
  if (legacyDark != null) {
    return { preset: legacyDark === "0" ? "light" : "dark", dark: legacyDark !== "0" };
  }
  // 全新安装：默认浅色
  return { preset: DEFAULT_PRESET === "light" ? "light" : "dark", dark: isDarkPreset(DEFAULT_PRESET) };
}

/** 兼容旧调用方：只要深浅 */
export function cachedThemeIsDark(): boolean {
  return cachedTheme().dark;
}

/** 应用主题：预设 / system / 自定义主题；设置变更后由 settings store 同步 */
export function useAppTheme() {
  function setThemeMode(next: ThemeSelection) {
    mode.value = next;
  }

  /** 自定义主题定义每次设置变更都整份送进来：渲染只看当前选中的那个 */
  function setCustomThemes(next: CustomTheme[]) {
    customThemes.value = next;
  }

  function setAccentColor(next: AccentColor) {
    accentColor.value = next;
  }

  return {
    mode,
    isDark,
    activePreset,
    activeCustom,
    accentColor,
    setThemeMode,
    setCustomThemes,
    setAccentColor,
  };
}
