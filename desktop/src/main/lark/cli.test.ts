import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { invalidateLarkCliPathCache, npmExecutionEnv, resolveNpmPath } from "./cli";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("lark-cli 安装前置探测", () => {
  it("将 npm 所在目录放到子进程 PATH，保证同目录 node 可解析", () => {
    const npmPath = "/Users/u/.local/bin/npm";
    const env = npmExecutionEnv(npmPath);
    expect(env.PATH?.split(":")[0]).toBe("/Users/u/.local/bin");
  });

  it("从 PATH 找到 npm，并在缓存清除后重新探测", () => {
    const root = mkdtempSync(join(tmpdir(), "zen-lark-cli-"));
    roots.push(root);
    const npmPath = join(root, "npm");
    writeFileSync(npmPath, "#!/bin/sh\\nexit 0\\n", "utf8");
    chmodSync(npmPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = root;
    try {
      invalidateLarkCliPathCache();
      expect(resolveNpmPath()).toBe(npmPath);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      invalidateLarkCliPathCache();
    }
  });
});
