import { describe, expect, it } from "vitest";

import { parseThemePack, writeZip } from "./theme-pack";

const PACK = {
  format: 2,
  name: { zh: "暖夜", en: "Warm night" },
  base: "dark",
  seeds: { accent: "#e98a4f", background: "#1d1512", surface: "#271c17", text: "#f6ece4" },
};

describe("主题包解析", () => {
  it("无图 JSON 主题包", async () => {
    const result = await parseThemePack(Buffer.from(JSON.stringify(PACK), "utf8"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.base).toBe("dark");
      expect(result.pack.seeds.accent).toBe("#e98a4f");
      expect(result.pack.background).toBeUndefined();
    }
  });

  it("ZIP 主题包（只含 theme.json）走同一套校验", async () => {
    const zip = writeZip([{ name: "theme.json", data: Buffer.from(JSON.stringify(PACK), "utf8") }]);
    const result = await parseThemePack(zip);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.name.zh).toBe("暖夜");
    }
  });

  it("拒绝目录穿越条目、多余文件与非法 JSON", async () => {
    const escaped = writeZip([{ name: "../theme.json", data: Buffer.from("{}") }]);
    await expect(parseThemePack(escaped)).resolves.toMatchObject({ ok: false });

    const extra = writeZip([
      { name: "theme.json", data: Buffer.from(JSON.stringify(PACK)) },
      { name: "evil.sh", data: Buffer.from("rm -rf /") },
    ]);
    await expect(parseThemePack(extra)).resolves.toMatchObject({ ok: false, error: "pack-structure" });

    await expect(parseThemePack(Buffer.from("not json", "utf8"))).resolves.toMatchObject({
      ok: false,
      error: "pack-not-json",
    });
  });

  it("缺 base 或名称的主题包判为非法", async () => {
    await expect(parseThemePack(Buffer.from(JSON.stringify({ name: "x" })))).resolves.toMatchObject({
      ok: false,
      error: "pack-invalid",
    });
  });
});

describe("ZIP 完整性与 nomi 兼容", () => {
  it("CRC 不一致的包被拒绝（不再只看结构）", async () => {
    const zip = writeZip([{ name: "theme.json", data: Buffer.from(JSON.stringify(PACK)) }]);
    // 抄一份并破坏 theme.json 的一字节（payload 在本地头 30 字节之后）
    const broken = Buffer.from(zip);
    broken[30 + 10] = broken[30 + 10]! ^ 0xff;
    await expect(parseThemePack(broken)).resolves.toMatchObject({ ok: false });
  });

  it("nomi 的 JSON 主题包（--cd-* token）能导入成 Zen token", async () => {
    const nomi = {
      format: 2,
      name: { zh: "nomi 主题", en: "nomi theme" },
      base: "light",
      seeds: { accent: "#c45425", background: "#f7f7f7", surface: "#ffffff", text: "#141414" },
      tokens: { "--cd-color-surface": "#fdfdfd", "--cd-color-border": "#dddddd" },
    };
    const result = await parseThemePack(Buffer.from(JSON.stringify(nomi), "utf8"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.tokens).toEqual({ "--color-panel": "#fdfdfd", "--color-line": "#dddddd" });
    }
  });
});
