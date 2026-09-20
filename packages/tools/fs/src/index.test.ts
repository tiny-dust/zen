import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { editWorkspaceFile, writeWorkspaceFile } from "./index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zen-fs-"));
  roots.push(root);
  return root;
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

  it("captures execution-time content when overwriting", async () => {
    const root = await makeRoot();
    await writeWorkspaceFile(root, "file.txt", "old");
    await writeFile(join(root, "file.txt"), "external change");
    assert.deepEqual(await writeWorkspaceFile(root, "file.txt", "new"), {
      path: "file.txt", content: "new", before: "external change", after: "new",
    });
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

  it("rejects non-ENOENT pre-read errors", async () => {
    const root = await makeRoot();
    await assert.rejects(writeWorkspaceFile(root, ".", "content"), /failed to read .* before writing/);
  });

  it("rejects write failures and missing or ambiguous edits", async () => {
    const root = await makeRoot();
    await assert.rejects(writeWorkspaceFile(root, "missing/file.txt", "content"), /failed to write/);
    await assert.rejects(editWorkspaceFile(root, "missing.txt", "old", "new"), /failed to edit/);
    await writeFile(join(root, "file.txt"), "x x");
    await assert.rejects(editWorkspaceFile(root, "file.txt", "x", "y"), /multiple locations/);
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "x x");
  });

  it("retains workspace path validation", async () => {
    const root = await makeRoot();
    await assert.rejects(writeWorkspaceFile(root, "../escape.txt", "content"), /escapes workspace/);
    await assert.rejects(editWorkspaceFile(root, "/absolute.txt", "old", "new"), /absolute path/);
  });
});
