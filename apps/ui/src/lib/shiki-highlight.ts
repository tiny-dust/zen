// 工具结果（读文件/编辑文件展开）与 diff 视图共用的 Shiki 高亮：
// 深浅主题成对产出（--shiki-light / --shiki-dark 双 CSS 变量），主题跟随设置页代码主题。
// 与 markdown 代码块（@stream-markdown/code）同一份语言/主题配置，观感一致。

import { createHighlighter, createJavaScriptRegexEngine } from "shiki";
import { ref, watch, type Ref } from "vue";

import { CODE_THEMES, codeThemeId, codeThemePair } from "@/components/ai-elements/response/extensions";

import type { Highlighter } from "shiki";
import type { BundledLanguage } from "shiki";

/** 常用语言集（与 markdown 代码块一致），未知扩展名回落纯文本 */
const LANGS: BundledLanguage[] = [
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

/** 文件扩展名 → shiki 语言 id（LANGS 子集）；未命中返回 undefined（纯文本） */
const EXT_LANG: Record<string, BundledLanguage> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  pyw: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  json: "json",
  jsonc: "json",
  vue: "vue",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  rs: "rust",
  go: "go",
  java: "java",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  toml: "toml",
  diff: "diff",
  patch: "diff",
};

/** 由文件路径推断高亮语言；未命中返回 undefined（调用方保持纯文本渲染） */
export function langFromPath(path: string | undefined): BundledLanguage | undefined {
  if (!path) {
    return undefined;
  }
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) {
    // 常见无扩展名配置文件
    const named: Record<string, BundledLanguage> = {
      dockerfile: "bash",
      makefile: "bash",
    };
    return named[name.toLowerCase()];
  }
  return EXT_LANG[name.slice(dot + 1).toLowerCase()];
}

/** 单例 highlighter：一次性装载全部代码主题与常用语言，首次调用异步初始化 */
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const themes = [...new Set(CODE_THEMES.flatMap((item) => [item.light, item.dark]))];
    highlighterPromise = createHighlighter({
      themes,
      langs: LANGS,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}

/**
 * 整段代码 → 每行 HTML（span 内联 --shiki-light/--shiki-dark 双变量，颜色由全局 CSS 取用）。
 * lang 为空或高亮失败时返回 null，调用方保持纯文本行渲染。
 */
export async function highlightLines(code: string, lang: BundledLanguage): Promise<string[] | null> {
  if (!code) {
    return null;
  }
  try {
    const highlighter = await getHighlighter();
    const [light, dark] = codeThemePair();
    const html = highlighter.codeToHtml(code, {
      lang,
      themes: { light, dark },
      defaultColor: false,
    });
    // shiki 输出形如 <pre><code>…<span class="line">L1</span>\n<span class="line">L2</span></code></pre>
    const body = /<code[^>]*>([\s\S]*)<\/code>/.exec(html)?.[1] ?? "";
    const lines = body.split("\n").filter((line) => line.length > 0);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

/** 响应式包装：源文本或语言变化时异步重算；期间为 null（纯文本兜底） */
export function useHighlightedLines(source: Ref<string>, lang: Ref<string | undefined>): Ref<string[] | null> {
  const lines = ref<string[] | null>(null);
  let version = 0;
  async function run() {
    const current = ++version;
    const langId = lang.value;
    if (!langId || !source.value) {
      lines.value = null;
      return;
    }
    const result = await highlightLines(source.value, langId as BundledLanguage);
    if (current === version) {
      lines.value = result;
    }
  }
  watch([source, lang, codeThemeId], () => void run(), { immediate: true });
  return lines;
}
