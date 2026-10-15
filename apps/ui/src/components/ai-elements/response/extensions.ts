import { code } from "@stream-markdown/code";
import { createJavaScriptRegexEngine } from "shiki";
import { ref } from "vue";

import type { BuiltinTheme, BundledLanguage, BundledTheme, CodeToTokensOptions } from "shiki";
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

/** Shiki 代码高亮扩展：深浅主题成对配置（渲染器按当前暗色取用），JS 正则引擎免去 wasm 依赖。
 *  defaultColor: false 让 token 同时产出 --shiki-light / --shiki-dark 两套 CSS 变量，
 *  深浅切换由 styles.css 按 .dark 取用——否则浅色侧变量缺失会整体退灰。 */

/**
 * 流式代码块高亮节流：markdown 渲染器对代码块的每次内容更新（流式 token 逐个
 * 到达）都会全量重跑一次 shiki（JS 正则引擎，成本随块大小线性增长），流式一段
 * 长代码块期间 CPU 会被逐 token 的全量重高亮直接烧满（O(n²) 总量）。
 * 对「增长型」更新做尾随合并：
 * - 流已静止（距上次调用超过 quietMs）：立即执行（首帧 / 静态块 / 停顿后收尾不受影响）
 * - 同一代码块连续增长：合并为一次，静止 quietMs 或距上次实际高亮超过
 *   maxWaitMs（长流式期间周期性上色）才重跑；被合并的旧 promise 立即落定，
 *   调用方的版本守卫会丢弃结果，不悬挂 await
 * - 不同代码块（非前缀增长）到达：挂起的高亮立即补跑，静态多块渲染不漏色
 */
/** 与 @stream-markdown/core 的 CodeHighlightInput 对齐（结构化声明，避免依赖其未导出的类型） */
interface CodeLikeHighlightInput {
  code: string;
  isDark: boolean;
  language: string;
}

export function withStreamingHighlight<T extends { highlight: (input: CodeLikeHighlightInput) => Promise<unknown> }>(
  base: T,
  quietMs = 250,
  maxWaitMs = 1000,
): T {
  let lastCallAt = 0;
  let lastRunAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: {
    input: CodeLikeHighlightInput;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  } | null = null;

  function runPending(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const held = pending;
    pending = null;
    if (!held) {
      return;
    }
    lastRunAt = Date.now();
    base.highlight(held.input).then(held.resolve, held.reject);
  }

  return {
    ...base,
    highlight(input: CodeLikeHighlightInput) {
      const now = Date.now();
      const prevCallAt = lastCallAt;
      lastCallAt = now;
      if (pending) {
        const grows =
          input.code.length > pending.input.code.length && input.code.startsWith(pending.input.code);
        if (grows) {
          // 同块增长：旧调用立即落定（其版本守卫已过期，结果会被丢弃），新输入承接
          const stale = pending.resolve;
          pending = null;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          stale(undefined);
        } else {
          // 另一个代码块 / 非增长更新：挂起的高亮立即补跑
          runPending();
        }
      }
      // 流已静止（距上一次调用超过 quietMs）：立即高亮（首帧 / 静态块 / 停顿后收尾）
      if (now - prevCallAt >= quietMs) {
        lastRunAt = now;
        return base.highlight(input);
      }
      // 流式进行中：尾随 quietMs 触发；距上次实际高亮超过 maxWaitMs 强制重跑
      return new Promise((resolve, reject) => {
        pending = { input, resolve, reject };
        timer = setTimeout(runPending, Math.min(quietMs, Math.max(0, lastRunAt + maxWaitMs - now)));
      });
    },
  } as T;
}

export const streamMarkdownExtensions: ExtensionOverrides = {
  code: withStreamingHighlight(
    code({
      theme: () => codeThemePair(),
      engine: () => createJavaScriptRegexEngine({ forgiving: true }),
      langs: () => LANGS as never,
      codeToTokenOptions: () => ({ defaultColor: false }) as CodeToTokensOptions<BundledLanguage, BundledTheme>,
    }),
  ),
};
