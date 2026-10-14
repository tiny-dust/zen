import { describe, expect, it } from "vitest";

import { dedupeFileNames } from "@/composables/useComposerFiles";

function fileOf(name: string, type = "image/png"): File {
  return new File(["blob"], name, { type, lastModified: 1_728_000_000_000 });
}

describe("dedupeFileNames # 批内文件名去重", () => {
  it("同批 3 个 image.png：首个保持原名，后续取 image-2.png / image-3.png", () => {
    const renamed = dedupeFileNames([fileOf("image.png"), fileOf("image.png"), fileOf("image.png")]);
    expect(renamed.map((file) => file.name)).toEqual(["image.png", "image-2.png", "image-3.png"]);
  });

  it("不同名文件保持原对象与名称不变", () => {
    const a = fileOf("a.png");
    const b = fileOf("b.png");
    const renamed = dedupeFileNames([a, b]);
    expect(renamed.map((file) => file.name)).toEqual(["a.png", "b.png"]);
    expect(renamed[0]).toBe(a);
    expect(renamed[1]).toBe(b);
  });

  it("无扩展名文件自增：screenshot → screenshot-2", () => {
    const renamed = dedupeFileNames([fileOf("screenshot", "text/plain"), fileOf("screenshot", "text/plain")]);
    expect(renamed.map((file) => file.name)).toEqual(["screenshot", "screenshot-2"]);
  });

  it("隐藏文件（.gitignore）整体作 base：.gitignore-2", () => {
    const renamed = dedupeFileNames([fileOf(".gitignore", "text/plain"), fileOf(".gitignore", "text/plain")]);
    expect(renamed.map((file) => file.name)).toEqual([".gitignore", ".gitignore-2"]);
  });

  it("序号与批内既有名冲突时顺延：image.png + image-2.png + image.png → image.png / image-2.png / image-3.png", () => {
    const renamed = dedupeFileNames([fileOf("image.png"), fileOf("image-2.png"), fileOf("image.png")]);
    expect(renamed.map((file) => file.name)).toEqual(["image.png", "image-2.png", "image-3.png"]);
  });

  it("重命名保留 type 与 lastModified，内容可读", async () => {
    const renamed = dedupeFileNames([fileOf("image.png"), fileOf("image.png")]);
    expect(renamed[1].name).toBe("image-2.png");
    expect(renamed[1].type).toBe("image/png");
    expect(renamed[1].lastModified).toBe(1_728_000_000_000);
    await expect(renamed[1].text()).resolves.toBe("blob");
  });

  it("空文件名跳过，不参与改名", () => {
    const empty = new File(["blob"], "");
    const renamed = dedupeFileNames([empty, fileOf("image.png"), fileOf("image.png")]);
    expect(renamed.map((file) => file.name)).toEqual(["", "image.png", "image-2.png"]);
  });
});
