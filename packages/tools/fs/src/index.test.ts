import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  editWorkspaceFile,
  listWorkspaceDir,
  readWorkspaceFile,
  resolveWorkspacePath,
  searchWorkspaceFilesNode,
  writeWorkspaceFile,
} from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zen-fs-"));
  roots.push(root);
  return root;
}

/** 断言用路径归一化：与实现的 toSlash(normalize()) 展示语义对齐（跨平台安全） */
function toSlashPath(path: string): string {
  return path.replace(/\\/g, "/");
}

describe("workspace file snapshots", () => {
  it("returns null before for a new file and preserves empty existing files", async () => {
    const root = await makeRoot();
    assert.deepEqual(await writeWorkspaceFile(root, "new.txt", ""), {
      path: "new.txt", content: "", before: null, after: "",
    });
    assert.deepEqual(await writeWorkspaceFile(root, "new.txt", "created"), {
      path: "new.txt", content: "created", before: "", after: "created",
    });
    assert.equal(await readFile(join(root, "new.txt"), "utf8"), "created");
  });

  it("creates missing parent directories (高频失败回归：新目录下建文件)", async () => {
    const root = await makeRoot();
    const result = await writeWorkspaceFile(root, "a/b/c.txt", "deep");
    assert.equal(result.path, "a/b/c.txt");
    assert.equal(await readFile(join(root, "a/b/c.txt"), "utf8"), "deep");
  });

  it("captures execution-time content when overwriting", async () => {
    const root = await makeRoot();
    await writeWorkspaceFile(root, "file.txt", "old");
    await writeFile(join(root, "file.txt"), "external change");
    assert.deepEqual(await writeWorkspaceFile(root, "file.txt", "new"), {
      path: "file.txt", content: "new", before: "external change", after: "new",
    });
  });

  it("skips before-snapshot for binary files (避免乱码进入上下文)", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "bin.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
    const result = await writeWorkspaceFile(root, "bin.dat", "text now");
    assert.equal(result.before, null);
    assert.equal(result.after, "text now");
  });

  it("returns complete snapshots for multiple and single replacements", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "file.txt"), "a x x b");
    assert.deepEqual(await editWorkspaceFile(root, "file.txt", "x", "y", true), {
      path: "file.txt", replacements: 2, before: "a x x b", after: "a y y b",
    });
    assert.deepEqual(await editWorkspaceFile(root, "file.txt", "a", "z"), {
      path: "file.txt", replacements: 1, before: "a y y b", after: "z y y b",
    });
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "z y y b");
  });

  it("matches oldString with LF against CRLF files (Windows 检出文件回归)", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "crlf.txt"), "alpha\r\nbeta\r\ngamma");
    const result = await editWorkspaceFile(root, "crlf.txt", "beta\ngamma", "BETA\nGAMMA");
    assert.equal(result.replacements, 1);
    assert.equal(await readFile(join(root, "crlf.txt"), "utf8"), "alpha\r\nBETA\r\nGAMMA");
  });

  it("does not write when there is no match", async () => {
    const root = await makeRoot();
    const path = join(root, "file.txt");
    await writeFile(path, "unchanged");
    const before = await stat(path, { bigint: true });
    assert.deepEqual(await editWorkspaceFile(root, "file.txt", "missing", "new"), {
      path: "file.txt", replacements: 0, before: "unchanged", after: "unchanged",
    });
    assert.equal((await stat(path, { bigint: true })).mtimeNs, before.mtimeNs);
    assert.equal(await readFile(path, "utf8"), "unchanged");
  });

  it("hints similar lines when oldString misses (模型自纠错线索)", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "hint.txt"), "line one\nline two\nline three");
    const result = await editWorkspaceFile(root, "hint.txt", "line two\n  extra", "x");
    assert.equal(result.replacements, 0);
    assert.match(result.hint ?? "", /2 look similar/);
  });

  it("rejects pre-read errors other than missing", async () => {
    const root = await makeRoot();
    // 目标本身是目录：pre-read 跳过，写入阶段以 failed to write 报错
    await assert.rejects(writeWorkspaceFile(root, ".", "content"), /failed to write/);
  });

  it("rejects write failures and missing or ambiguous edits", async () => {
    const root = await makeRoot();
    // 路径中间是文件：mkdir ENOTDIR → failed to write
    await writeWorkspaceFile(root, "blocker.txt", "x");
    await assert.rejects(
      writeWorkspaceFile(root, "blocker.txt/child.txt", "content"),
      /failed to write/,
    );
    // 目标不存在：指引用 writeFile 创建
    await assert.rejects(
      editWorkspaceFile(root, "missing.txt", "old", "new"),
      /file not found: missing\.txt; create it with writeFile first/,
    );
    await writeFile(join(root, "file.txt"), "x x");
    await assert.rejects(editWorkspaceFile(root, "file.txt", "x", "y"), /multiple locations/);
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "x x");
  });

  it("allows paths outside the workspace via absolute form and ~ expansion", async () => {
    const root = await makeRoot();
    // 工作区外绝对路径：读/写/编辑/列目录全部放行
    const outside = await mkdtemp(join(tmpdir(), "zen-fs-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "notes.txt"), "outside content");
    const read = await readWorkspaceFile(root, join(outside, "notes.txt"));
    assert.equal(read.content, "outside content");
    assert.equal(read.path, toSlashPath(join(outside, "notes.txt")));
    const written = await writeWorkspaceFile(root, join(outside, "more.txt"), "created outside");
    assert.equal(await readFile(join(outside, "more.txt"), "utf8"), "created outside");
    assert.equal(written.path, toSlashPath(join(outside, "more.txt")));
    const edited = await editWorkspaceFile(root, join(outside, "notes.txt"), "outside", "OUTSIDE");
    assert.equal(edited.replacements, 1);
    const listing = await listWorkspaceDir(root, outside);
    assert.deepEqual(
      listing.entries.map((entry) => entry.name).sort(),
      ["more.txt", "notes.txt"],
    );
    // 相对路径跳出工作区（../）同样放行，展示为归一化绝对路径
    const escape = await writeWorkspaceFile(root, "../escape-shared.txt", "escaped");
    assert.equal(await readFile(join(tmpdir(), "escape-shared.txt"), "utf8"), "escaped");
    assert.equal(escape.path, toSlashPath(join(tmpdir(), "escape-shared.txt")));
    await rm(join(tmpdir(), "escape-shared.txt"), { force: true });
    // ~ 家目录展开为绝对路径
    assert.equal(
      resolveWorkspacePath(root, "~/skills/coder"),
      toSlashPath(join(homedir(), "skills/coder")),
    );
    assert.equal(resolveWorkspacePath(root, "~"), toSlashPath(homedir()));
  });

  it("rejects POSIX Windows drive-letter paths with platform guidance", async () => {
    const root = await makeRoot();
    await assert.rejects(
      readWorkspaceFile(root, "C:/Windows/system.ini"),
      /not valid on this platform.*use runTerminal/s,
    );
  });

  it("accepts workspace-absolute and quoted paths", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/main.ts"), "hello");
    // 工作区内绝对路径归一化（GPT 系高频入参形态）
    const abs = await readWorkspaceFile(root, join(root, "src/main.ts"));
    assert.equal(abs.content, "hello");
    assert.equal(abs.path, "src/main.ts");
    // 引号包裹 / 前后空白 / Windows 反斜杠分隔符
    const quoted = await readWorkspaceFile(root, ' "src/main.ts" ');
    assert.equal(quoted.content, "hello");
    const backslashed = await readWorkspaceFile(root, "src\\main.ts");
    assert.equal(backslashed.content, "hello");
    // 工作区外不存在的文件：按 ENOENT 友好报错（不再拒绝工作区外路径）
    await assert.rejects(
      readWorkspaceFile(root, join(root, "../elsewhere.txt")),
      /file not found/,
    );
    // 空路径报错带示例
    await assert.rejects(readWorkspaceFile(root, ""), /path is required/);
  });

  it("rejects binary files and reads oversized files partially", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "img.png"), Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]));
    await assert.rejects(readWorkspaceFile(root, "img.png"), /binary file.*runTerminal/s);

    // 2.1MB 文本：只读前 2MB 并附说明（不整文件载入）
    await writeFile(join(root, "big.txt"), Buffer.alloc(2 * 1024 * 1024 + 4096, 0x61));
    const result = await readWorkspaceFile(root, "big.txt");
    assert.ok(result.content.length < 2 * 1024 * 1024 + 4096);
    assert.match(result.content, /file too large/);
  });

  it("missing files report a friendly message with listDir guidance", async () => {
    const root = await makeRoot();
    await assert.rejects(readWorkspaceFile(root, "nope.txt"), /file not found: nope\.txt/);
  });

  it("suggests listDir when reading a directory", async () => {
    const root = await makeRoot();
    await writeWorkspaceFile(root, "a.txt", "x");
    await assert.rejects(readWorkspaceFile(root, "."), /is a directory; use listDir/);
  });

  it("lists workspace root when path is empty (listDir tool regression)", async () => {
    const root = await makeRoot();
    await writeWorkspaceFile(root, "a.txt", "x");
    for (const empty of ["", undefined as unknown as string]) {
      const result = await listWorkspaceDir(root, empty);
      assert.deepEqual(
        result.entries.map((entry) => entry.name),
        ["a.txt"],
      );
    }
  });

  it("maps listDir errors to actionable messages", async () => {
    const root = await makeRoot();
    await writeWorkspaceFile(root, "a.txt", "x");
    await assert.rejects(listWorkspaceDir(root, "nope"), /directory not found: nope/);
    await assert.rejects(listWorkspaceDir(root, "a.txt"), /not a directory: a\.txt/);
  });
});

describe("searchWorkspaceFiles (Node 回退实现)", () => {
  it("finds by name and content, reports truncation beyond 40 hits", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "needle-a.txt"), "plain");
    await writeFile(join(root, "noise.txt"), "contains NEEDLE inline");
    // 命中上限：41 个文件名都含 needle
    for (let i = 0; i < 41; i += 1) {
      await writeFile(join(root, `needle-${i}.txt`), "x");
    }

    const byName = await searchWorkspaceFilesNode(root, "needle", "name");
    assert.equal(byName.hits.length, 40);
    assert.equal(byName.truncated, true);

    // 子目录文件用唯一查询命中（readdir 顺序不稳定，不能依赖遍历先后）
    const byUniqueName = await searchWorkspaceFilesNode(root, "needle-a", "name");
    assert.deepEqual(
      byUniqueName.hits.map((hit) => hit.path),
      ["sub/needle-a.txt"],
    );
    assert.equal(byUniqueName.truncated, false);

    const byContent = await searchWorkspaceFilesNode(root, "needle", "content");
    assert.ok(byContent.hits.some((hit) => hit.path === "noise.txt" && hit.line === 1));

    // 忽略目录不进入结果
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "needle-dep.txt"), "needle");
    const filtered = await searchWorkspaceFilesNode(root, "needle", "name");
    assert.ok(!filtered.hits.some((hit) => hit.path.startsWith("node_modules/")));

    const none = await searchWorkspaceFilesNode(root, "no-such-token-xyz", "content");
    assert.equal(none.hits.length, 0);
    assert.equal(none.truncated, false);
  });
});
