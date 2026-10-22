// resolveElementSourceFiles：按 sourceHints 在工作区做源码文件检索的纯 Node 逻辑
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveElementSourceFiles } from "./element-source";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zen-element-source-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveElementSourceFiles", () => {
  it("命中 ≥2 的文件按命中数排序返回（上限 3）", async () => {
    await writeFile(join(root, "LoginCard.vue"), "id=\"login-btn\" class=\"login-card\"\n");
    await writeFile(join(root, "Header.vue"), "data-testid=\"login-btn\"\nlogin-card\n");
    await writeFile(join(root, "Other.ts"), "login-card\n");
    await writeFile(join(root, "Miss.vue"), "nothing here\n");
    const files = await resolveElementSourceFiles(["login-btn", "login-card"], root);
    // LoginCard 与 Header 双命中；Other 单命中不计入
    expect(files).toContain("LoginCard.vue");
    expect(files).toContain("Header.vue");
    expect(files).toHaveLength(2);
  });

  it("三命中时只返回前 3 个", async () => {
    for (const name of ["A.vue", "B.vue", "C.vue", "D.vue"]) {
      await writeFile(join(root, name), "login-card primary-action\n");
    }
    const files = await resolveElementSourceFiles(["login-card", "primary-action"], root);
    expect(files).toHaveLength(3);
  });

  it("无 ≥2 命中时按最强线索（hints[0]）兜底返回单命中文件（上限 2）", async () => {
    await writeFile(join(root, "One.vue"), "unique-id-123\n");
    await writeFile(join(root, "Two.vue"), "unique-id-123\n");
    await writeFile(join(root, "Three.vue"), "unique-id-123\n");
    const files = await resolveElementSourceFiles(["unique-id-123"], root);
    expect(files).toHaveLength(2);
  });

  it("跳过 node_modules / dist 等目录与隐藏目录", async () => {
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await writeFile(join(root, "node_modules", "dep.vue"), "login-card login-btn\n");
    await writeFile(join(root, "dist", "bundle.js"), "login-card login-btn\n");
    await writeFile(join(root, ".hidden", "x.vue"), "login-card login-btn\n");
    await writeFile(join(root, "src.vue"), "login-card login-btn\n");
    const files = await resolveElementSourceFiles(["login-card", "login-btn"], root);
    expect(files).toEqual(["src.vue"]);
  });

  it("无任何命中返回 []，空 hints / 空目录也返回 []", async () => {
    await writeFile(join(root, "A.vue"), "hello\n");
    expect(await resolveElementSourceFiles(["missing"], root)).toEqual([]);
    expect(await resolveElementSourceFiles([], root)).toEqual([]);
    const empty = await mkdtemp(join(tmpdir(), "zen-element-source-empty-"));
    try {
      expect(await resolveElementSourceFiles(["login"], empty)).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("匹配不区分大小写且只读源码扩展名", async () => {
    await writeFile(join(root, "Comp.Vue"), "LoginCard\n");
    await writeFile(join(root, "notes.md"), "LoginCard LoginCard\n");
    const files = await resolveElementSourceFiles(["LoginCard", "logincard-ignore"], root);
    // notes.md 不在扩展名白名单内；Comp.Vue 按最强线索（大小写不敏感）兜底命中
    expect(files).toEqual(["Comp.Vue"]);
  });
});
