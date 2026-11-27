import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// vitest 的 cwd 是 apps/ui：直接读源文件，CSS 规则与组件 scoped 样式的实际产物才对得上
const css = readFileSync("src/styles.css", "utf8");

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return vueFiles(path);
    }
    return entry.name.endsWith(".vue") ? [path] : [];
  });
}

/**
 * diff 行与工具结果代码行的高亮是 v-html 注入的 shiki span，取色只能靠全局 CSS。
 * 深色侧曾写在组件 scoped 样式里（`:global(.dark) … :deep()`），Vue 编译后整条规则丢失，
 * 结果 token 取到 --shiki-light 的深墨色，在深色底上与背景同色——变更文件完全看不清。
 */
describe("shiki 高亮取色", () => {
  it("diff / 工具结果代码行在 styles.css 里有深浅两套 token 取色", () => {
    expect(css).toMatch(/\.diff-hl span,\s*\n\.tool-code-hl span\s*\{\s*color:\s*var\(--shiki-light/);
    expect(css).toMatch(/\.dark \.diff-hl span,\s*\n\.dark \.tool-code-hl span\s*\{\s*color:\s*var\(--shiki-dark/);
  });

  it("组件里不再用 :global(.dark) + :deep() 给 shiki token 取色（编译后会整条丢失）", () => {
    const offenders = vueFiles("src/components").filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes(":global(.dark)") && /var\(--shiki-(light|dark)/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
