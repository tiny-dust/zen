import { describe, expect, it } from "vitest";

import {
  isPathUnder,
  joinRelPath,
  parentDirPath,
  pasteTargetDir,
  remapPathAfterRename,
  remapSetAfterRename,
} from "./file-tree-ops";

describe("parentDirPath", () => {
  it("顶层条目返回根", () => {
    expect(parentDirPath("a.txt")).toBe("");
    expect(parentDirPath("src")).toBe("");
  });

  it("嵌套条目返回父目录", () => {
    expect(parentDirPath("src/a.txt")).toBe("src");
    expect(parentDirPath("src/ui/b.vue")).toBe("src/ui");
  });
});

describe("joinRelPath", () => {
  it("根目录直接用名称，子目录用 / 连接", () => {
    expect(joinRelPath("", "b.txt")).toBe("b.txt");
    expect(joinRelPath("src", "b.txt")).toBe("src/b.txt");
  });
});

describe("isPathUnder", () => {
  it("空前缀视为工作区根，任意路径都在其下", () => {
    expect(isPathUnder("a.txt", "")).toBe(true);
    expect(isPathUnder("", "")).toBe(true);
  });

  it("自身与其子路径命中，前缀同名不同级不命中", () => {
    expect(isPathUnder("src", "src")).toBe(true);
    expect(isPathUnder("src/a.txt", "src")).toBe(true);
    expect(isPathUnder("src-ui/a.txt", "src")).toBe(false);
    expect(isPathUnder("a.txt", "src")).toBe(false);
  });
});

describe("remapPathAfterRename", () => {
  it("命中自身与子路径时替换前缀", () => {
    expect(remapPathAfterRename("src", "src", "lib")).toBe("lib");
    expect(remapPathAfterRename("src/ui/a.vue", "src", "lib")).toBe("lib/ui/a.vue");
  });

  it("范围外路径返回 null，空 fromRel 不处理", () => {
    expect(remapPathAfterRename("docs/a.md", "src", "lib")).toBeNull();
    expect(remapPathAfterRename("src", "", "lib")).toBeNull();
  });
});

describe("remapSetAfterRename", () => {
  it("重命名目录后同步 expanded 前缀，未命中条目与根占位保留", () => {
    const next = remapSetAfterRename(new Set(["", "src", "src/ui", "docs"]), "src", "lib");
    expect([...next].sort()).toEqual(["", "docs", "lib", "lib/ui"]);
  });

  it("重命名文件不影响目录集合", () => {
    const next = remapSetAfterRename(new Set(["", "src"]), "src/a.txt", "src/b.txt");
    expect([...next].sort()).toEqual(["", "src"]);
  });
});

describe("pasteTargetDir", () => {
  it("目录粘贴到自身，文件粘贴到父目录", () => {
    expect(pasteTargetDir("src", true)).toBe("src");
    expect(pasteTargetDir("src/ui", true)).toBe("src/ui");
    expect(pasteTargetDir("src/a.txt", false)).toBe("src");
    expect(pasteTargetDir("a.txt", false)).toBe("");
  });
});
