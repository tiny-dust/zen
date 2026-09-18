import { code } from "@stream-markdown/code";
import { createJavaScriptRegexEngine } from "shiki";

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

/** Shiki 代码高亮扩展：深浅主题成对配置（渲染器按当前暗色取用），JS 正则引擎免去 wasm 依赖 */
export const streamMarkdownExtensions: ExtensionOverrides = {
  code: code({
    theme: () => ["github-light", "github-dark"],
    engine: () => createJavaScriptRegexEngine({ forgiving: true }),
    langs: () => LANGS as never,
  }),
};
