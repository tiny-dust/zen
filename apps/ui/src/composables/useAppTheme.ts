import { computed, ref, watchEffect } from "vue";

import { DEFAULT_THEME } from "@zen/shared";

import type { ThemeMode } from "@zen/shared";

/** 本地镜像键：首帧免 IPC 往返直接上主题（设置加载后由 settings store 校正） */
const THEME_MIRROR_KEY = "zen.theme.dark";

const mode = ref<ThemeMode>(DEFAULT_THEME);
const systemDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);

// system 档跟随操作系统；dark/light 固定档下该值仍会变，但计算时被忽略
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
mediaQuery.addEventListener("change", (event) => {
  systemDark.value = event.matches;
});

/** 当前生效主题是否深色（渲染层自算，浏览器 dev 形态同样可用） */
const isDark = computed(() =>
  mode.value === "system" ? systemDark.value : mode.value === "dark",
);

watchEffect(() => {
  document.documentElement.classList.toggle("dark", isDark.value);
  try {
    localStorage.setItem(THEME_MIRROR_KEY, isDark.value ? "1" : "0");
  } catch {
    // localStorage 不可用（隐私模式等）：只影响下次首帧，忽略
  }
});

/** 读取首帧镜像（main.ts 挂载前调用，避免亮色用户看到深色闪烁） */
export function cachedThemeIsDark(): boolean {
  try {
    return localStorage.getItem(THEME_MIRROR_KEY) !== "0";
  } catch {
    return true;
  }
}

/** 应用主题：三档（dark/light/system）；设置变更后由 settings store 调 setThemeMode 同步 */
export function useAppTheme() {
  function setThemeMode(next: ThemeMode) {
    mode.value = next;
  }

  return { mode, isDark, setThemeMode };
}
