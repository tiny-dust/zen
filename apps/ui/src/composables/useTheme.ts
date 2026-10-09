import { ref } from "vue";

import { DEFAULT_UI_THEME, isUiTheme } from "@zen/shared";

import type { UiThemeId } from "@zen/shared";

/** localStorage 键：主进程设置加载前先读它，保证首帧无闪烁 */
const STORAGE_KEY = "zen:ui-theme";

/** 平滑过渡的兜底时长：与 styles.css 里 .theme-switching 的过渡一致 */
const SWITCH_FALLBACK_MS = 420;

/** 主题选择器元数据（设置页渲染用，id 必须与 styles.css 的 data-theme 对齐） */
export const UI_THEMES: Array<{ id: UiThemeId; label: string; description: string }> = [
  { id: "liquid-glass", label: "液态玻璃", description: "半透明磨砂、流动光影与折射高光" },
  { id: "dark-tech", label: "极客黑", description: "VS Code 式高对比深色，硬朗聚焦" },
  { id: "neumorphism", label: "新拟态", description: "同色系软阴影，物理按键沉降触感" },
];

/** 模块级单例：全应用共享同一份主题状态 */
const theme = ref<UiThemeId>(DEFAULT_UI_THEME);

/** 把主题落到 DOM：data-theme 承载风格，.dark 承载明暗（拟态为浅色，其余深色） */
function applyToDocument(id: UiThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", id !== "neumorphism");
}

/** 首帧同步解析：localStorage 优先，读不到/非法回落默认液态玻璃 */
export function resolveInitialTheme(): UiThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isUiTheme(stored)) {
      return stored;
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默回落默认主题
  }
  return DEFAULT_UI_THEME;
}

/** 应用启动时（createApp 前）调用：先落 DOM 再挂载，避免主题闪变 */
export function initTheme(): UiThemeId {
  const initial = resolveInitialTheme();
  theme.value = initial;
  applyToDocument(initial);
  return initial;
}

/**
 * 切换主题：DOM 即时更新 + 平滑过渡（View Transition 优先，降级为全局过渡类）
 * 持久化双写 localStorage（下次启动首帧用）+ 主进程 settings（跨窗口同步用）
 */
async function setTheme(id: UiThemeId): Promise<void> {
  if (theme.value === id) {
    return;
  }
  theme.value = id;

  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!reduced && typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => applyToDocument(id));
  } else if (reduced) {
    applyToDocument(id);
  } else {
    // 兜底：挂全局过渡类，让所有表面颜色/阴影平滑渐变，结束后摘掉避免干扰交互
    root.classList.add("theme-switching");
    applyToDocument(id);
    window.setTimeout(() => root.classList.remove("theme-switching"), SWITCH_FALLBACK_MS);
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 同上：写不进去不阻断切换
  }

  // 主进程持久化（settings:changed 广播回来时 syncFromSettings 会看到同值，不会回环）
  try {
    await window.zen?.settings.set({ uiTheme: id });
  } catch {
    // 无 zen API（纯浏览器 dev）时仅 localStorage 生效
  }
}

/** 主进程设置变化广播 → 同步本地状态（多窗口/设置回填），不再反向持久化 */
function syncFromSettings(id: UiThemeId): void {
  if (!isUiTheme(id) || theme.value === id) {
    return;
  }
  theme.value = id;
  applyToDocument(id);
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 忽略：localStorage 不可用不影响内存态
  }
}

export function useTheme() {
  return {
    theme,
    themes: UI_THEMES,
    setTheme,
    syncFromSettings,
  };
}
