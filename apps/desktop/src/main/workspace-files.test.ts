import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listWorkspaceFiles } from "./workspace-files";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "zen-workspace-files-"));
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("listWorkspaceFiles", () => {
  it("条目上限不会让排在后边的同级目录整块消失", async () => {
    const root = makeRoot();
    try {
      // 第一个目录条目很多（模拟大仓库），第二个目录只有一项
      mkdirSync(join(root, "ats-conductor-server"));
      for (let i = 0; i < 20; i += 1) {
        writeFileSync(join(root, "ats-conductor-server", `file-${i}.ts`), "");
      }
      mkdirSync(join(root, "ats-conductor-ui"));
      writeFileSync(join(root, "ats-conductor-ui", "main.ts"), "");

      const files = await listWorkspaceFiles(root, { maxFiles: 5 });

      expect(files).toHaveLength(5);
      expect(files.map((file) => file.path)).toEqual(
        expect.arrayContaining(["ats-conductor-server", "ats-conductor-ui"]),
      );
    } finally {
      cleanup(root);
    }
  });

  it("逐层展开、跳过忽略目录，并受深度上限约束", async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "src", "deep", "deeper"), { recursive: true });
      writeFileSync(join(root, "src", "a.ts"), "");
      writeFileSync(join(root, "src", "deep", "b.ts"), "");
      writeFileSync(join(root, "src", "deep", "deeper", "c.ts"), "");
      mkdirSync(join(root, "node_modules"));
      writeFileSync(join(root, "node_modules", "x.js"), "");

      const all = (await listWorkspaceFiles(root)).map((file) => file.path).sort();
      expect(all).toEqual(
        [
          join("src"),
          join("src", "a.ts"),
          join("src", "deep"),
          join("src", "deep", "b.ts"),
          join("src", "deep", "deeper"),
          join("src", "deep", "deeper", "c.ts"),
        ].sort(),
      );

      // maxDepth=1：只展开根与第一层目录
      const shallow = (await listWorkspaceFiles(root, { maxDepth: 1 }))
        .map((file) => file.path)
        .sort();
      expect(shallow).toEqual([join("src"), join("src", "a.ts"), join("src", "deep")].sort());
    } finally {
      cleanup(root);
    }
  });

  it("列出的目录节点带 isDir，可据 path 还原层级", async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "pkg"));
      writeFileSync(join(root, "pkg", "index.ts"), "");

      const files = await listWorkspaceFiles(root);
      const pkg = files.find((file) => file.path === "pkg");
      const index = files.find((file) => file.path === join("pkg", "index.ts"));

      expect(pkg?.isDir).toBe(true);
      expect(index?.isDir).toBe(false);
      expect(index?.name).toBe("index.ts");
    } finally {
      cleanup(root);
    }
  });
});
