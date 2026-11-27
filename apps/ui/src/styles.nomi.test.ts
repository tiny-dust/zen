import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// vitest 的 cwd 是 apps/ui；直接读源文件，避免 CSS 被预处理器处理后读不到原始 token
const css = readFileSync("src/styles.css", "utf8");

/**
 * 设计底座回归：nomi 复刻层必须真实存在于 styles.css，且顺序正确。
 * 旧橙色选择器与 nomi 选择器同为属性选择器，谁在后面谁生效——
 * 上一轮就出现过「加了靛蓝变量但界面仍是橙色」的顺序问题，这里锁死。
 */
function indexOf(needle: string): number {
  const at = css.indexOf(needle);
  expect(at, `styles.css 缺少：${needle}`).toBeGreaterThan(-1);
  return at;
}

describe("nomi 复刻层", () => {
  it("包含 nomi 复刻层标记与深色画布 token", () => {
    expect(indexOf("nomi-ai 复刻层")).toBeGreaterThan(0);
    expect(css).toMatch(/--color-bg: #13161b;/);
    expect(css).toMatch(/--color-side: #191d23;/);
    expect(css).toMatch(/--color-accent: #7887f5;/);
    expect(css).toMatch(/--color-bg: #faf9f6;/);
    expect(css).toMatch(/--color-accent: #9d3f29;/);
  });

  it("圆角、控件高、间距与字号阶梯齐全", () => {
    for (const token of [
      "--radius-xs: 6px;",
      "--radius-sm: 8px;",
      "--radius-md: 10px;",
      "--radius-lg: 14px;",
      "--radius-shell: 20px;",
      "--control-h-2xs: 20px;",
      "--control-h-xs: 24px;",
      "--control-h-sm: 28px;",
      "--control-h-ms: 32px;",
      "--control-h-md: 36px;",
      "--control-h-lg: 40px;",
      "--font-size-md: 14px;",
    ]) {
      expect(css, `缺少 ${token}`).toContain(token);
    }
  });

  it("nomi 强调色选择器排在旧橙色规则之后（后写者生效）", () => {
    expect(indexOf(':root[data-accent-color="nomi"]')).toBeGreaterThan(
      indexOf(':root[data-accent-color="orange"]'),
    );
    expect(indexOf(':root.dark[data-accent-color="nomi"]')).toBeGreaterThan(
      indexOf(':root.dark[data-accent-color="orange"]'),
    );
  });

  it("浅色为陶土红、深色为靛蓝，二者不互相覆盖", () => {
    const light = css.slice(
      indexOf(':root[data-accent-color="nomi"]'),
      indexOf(':root.dark[data-accent-color="nomi"]'),
    );
    expect(light).toContain("--color-accent: #9d3f29;");
    const dark = css.slice(indexOf(':root.dark[data-accent-color="nomi"]'));
    expect(dark).toContain("--color-accent: #7887f5;");
  });

  it("橙色仍作为可选强调色保留", () => {
    expect(css).toMatch(/:root\[data-accent-color="orange"\] \{ --color-accent: #ff6a2b; \}/);
  });
});
