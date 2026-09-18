import { code } from "@stream-markdown/code";
import { createJavaScriptRegexEngine } from "shiki";
import { ref } from "vue";

import type { BuiltinTheme } from "shiki";
import type { ExtensionOverrides } from "vue-stream-markdown";

// 常用语言集，避免加载全部语法包
const LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "bash",
  "shell",
  "json",
  "vue",
  "html",
  "css",
  "scss",
  "less",
  "markdown",
  "yaml",
  "rust",
  "go",
  "java",
  "sql",
  "c",
  "cpp",
  "diff",
  "toml",
];

/** 代码主题目录：每项为一对深浅 Shiki 主题，设置页按 id 选择 */
export interface CodeThemeOption {
  id: string;
  label: string;
  light: BuiltinTheme;
  dark: BuiltinTheme;
}

export const CODE_THEMES: CodeThemeOption[] = [
  { id: "github", label: "GitHub", light: "github-light", dark: "github-dark" },
  { id: "vs", label: "VS Code", light: "light-plus", dark: "dark-plus" },
  { id: "vitesse", label: "Vitesse", light: "vitesse-light", dark: "vitesse-dark" },
  { id: "catppuccin", label: "Catppuccin", light: "catppuccin-latte", dark: "catppuccin-mocha" },
  { id: "gruvbox", label: "Gruvbox", light: "gruvbox-light-medium", dark: "gruvbox-dark-medium" },
  { id: "rose-pine", label: "Rosé Pine", light: "rose-pine-dawn", dark: "rose-pine-moon" },
  { id: "everforest", label: "Everforest", light: "everforest-light", dark: "everforest-dark" },
  { id: "min", label: "Min", light: "min-light", dark: "min-dark" },
];

/** 当前选中的主题 id（设置页切换后由 settings store 同步） */
export const codeThemeId = ref("github");

export function setCodeThemeId(id: string) {
  if (CODE_THEMES.some((theme) => theme.id === id) && id !== codeThemeId.value) {
    codeThemeId.value = id;
  }
}

export function codeThemePair(id: string = codeThemeId.value): [BuiltinTheme, BuiltinTheme] {
  const theme = CODE_THEMES.find((item) => item.id === id) ?? CODE_THEMES[0]!;
  return [theme.light, theme.dark];
}

/** 代码块紧凑化：限高内滚 + 行号，头部与间距由 styles.css 收紧 */
export const compactCodeOptions = {
  lineNumbers: true,
  maxHeight: 420,
} as const;

/** Shiki 代码高亮扩展：深浅主题成对配置（渲染器按当前暗色取用），JS 正则引擎免去 wasm 依赖 */
export const streamMarkdownExtensions: ExtensionOverrides = {
  code: code({
    theme: () => codeThemePair(),
    engine: () => createJavaScriptRegexEngine({ forgiving: true }),
    langs: () => LANGS as never,
  }),
};
