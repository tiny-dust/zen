import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** 虚拟 home（空串 = 真实 homedir）；探测兜底路径都在 home 下，配合虚拟 fs 可控 */
  home: "",
  /** 虚拟文件表：file=可执行文件 / noexec=不可执行 / dir=目录 / missing=显式不存在 / string[]=目录项 */
  virtual: new Map<string, "file" | "noexec" | "dir" | "missing" | string[]>(),
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => state.home || actual.homedir() };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const enoent = (): never => {
    const error = new Error("ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  };
  return {
    ...actual,
    statSync: ((path: unknown, ...rest: unknown[]) => {
      const entry = state.virtual.get(String(path));
      if (entry === undefined) {
        return (actual.statSync as (...args: unknown[]) => unknown)(path, ...rest);
      }
      if (entry === "missing") return enoent();
      if (Array.isArray(entry)) return { isFile: () => false, isDirectory: () => true };
      return {
        isFile: () => entry === "file" || entry === "noexec",
        isDirectory: () => entry === "dir",
      };
    }) as typeof actual.statSync,
    accessSync: ((path: unknown, ...rest: unknown[]) => {
      const entry = state.virtual.get(String(path));
      if (entry === undefined) {
        return (actual.accessSync as (...args: unknown[]) => unknown)(path, ...rest);
      }
      if (entry === "file") return undefined;
      const error = new Error(entry === "missing" ? "ENOENT" : "EACCES") as NodeJS.ErrnoException;
      error.code = entry === "missing" ? "ENOENT" : "EACCES";
      throw error;
    }) as typeof actual.accessSync,
    readdirSync: ((path: unknown, ...rest: unknown[]) => {
      const entry = state.virtual.get(String(path));
      if (entry === undefined) {
        return (actual.readdirSync as (...args: unknown[]) => unknown)(path, ...rest);
      }
      if (Array.isArray(entry)) return [...entry];
      return enoent();
    }) as typeof actual.readdirSync,
  };
});

vi.mock("node:child_process", () => ({ execFileSync: state.execFileSyncMock }));

import {
  invalidateLarkCliPathCache,
  npmExecutionEnv,
  resolveLarkCliPath,
  resolveNpmPath,
} from "./cli";

const REAL_PLATFORM = process.platform;

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

/** 屏蔽真实机器上的系统 npm 兜底路径，让探测结果只由虚拟 fs 决定 */
function hideSystemNpm(): void {
  for (const path of ["/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm"]) {
    state.virtual.set(path, "missing");
  }
}

const ORIGINAL_PATH = process.env.PATH;

const roots: string[] = [];

afterEach(() => {
  while (roots.length) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
  state.virtual.clear();
  state.home = "";
  state.execFileSyncMock.mockReset();
  stubPlatform(REAL_PLATFORM);
  if (ORIGINAL_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIGINAL_PATH;
  delete process.env.Path;
  delete process.env.APPDATA;
  delete process.env.ProgramFiles;
  delete process.env.LOCALAPPDATA;
  invalidateLarkCliPathCache();
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

describe("resolveLarkCliPath：PATH 扫描", () => {
  it("PATH 命中可执行 lark-cli；目录名同名/不可执行文件跳过", () => {
    process.env.PATH = "/vp1:/vp2:/vp3";
    state.virtual.set("/vp1/lark-cli", "dir");
    state.virtual.set("/vp2/lark-cli", "noexec");
    state.virtual.set("/vp3/lark-cli", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/vp3/lark-cli");
  });

  it("PATH 中的空段跳过；全未命中返回 null 并缓存 null", () => {
    process.env.PATH = ":/vp1:";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/lark-cli", "missing");
    state.virtual.set("/h/.vite-plus/js_runtime/node", "missing");
    state.execFileSyncMock.mockReturnValue("");
    state.virtual.set("/vp1/lark-cli", "missing");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBeNull();
    // 缓存 null 后即使文件出现了也不重扫
    state.virtual.set("/vp1/lark-cli", "file");
    expect(resolveLarkCliPath()).toBeNull();
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/vp1/lark-cli");
  });

  it("Windows：探测 lark-cli.cmd / lark-cli.exe 垫片", () => {
    stubPlatform("win32");
    process.env.PATH = "/vp1:/vp2";
    state.virtual.set("/vp1/lark-cli", "file"); // 非垫片名不认
    state.virtual.set("/vp2/lark-cli.cmd", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/vp2/lark-cli.cmd");
  });
});

describe("resolveLarkCliPath：macOS/Linux 兜底链", () => {
  it("PATH 未命中 → ~/.local/bin/lark-cli（用户手装）", () => {
    process.env.PATH = "";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/lark-cli", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/h/.local/bin/lark-cli");
  });

  it("vite-plus 运行时按版本号倒序取最新可用", () => {
    process.env.PATH = "";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/lark-cli", "missing");
    const base = "/h/.vite-plus/js_runtime/node";
    state.virtual.set(base, ["24.18.0", "24.21.0", "not-a-version", "24.20.0"]);
    const cliOf = (version: string) =>
      `${base}/${version}/lib/node_modules/@larksuite/cli/bin/lark-cli`;
    state.virtual.set(cliOf("24.18.0"), "file");
    state.virtual.set(cliOf("24.21.0"), "missing");
    state.virtual.set(cliOf("24.20.0"), "file");
    invalidateLarkCliPathCache();
    // 24.21.0 不存在 → 落到 24.20.0（排序倒序验证）
    expect(resolveLarkCliPath()).toBe(cliOf("24.20.0"));
  });

  it("npm prefix -g 布局：优先包内真实入口，其次 prefix/bin 软链", () => {
    process.env.PATH = "";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/lark-cli", "missing");
    state.virtual.set("/h/.vite-plus/js_runtime/node", "missing");
    // npmGlobalPrefix 依赖 resolveNpmPath 先找到 npm
    state.virtual.set("/h/.volta/bin/npm", "file");
    state.execFileSyncMock.mockReturnValue("/prefix\n");
    state.virtual.set("/prefix/lib/node_modules/@larksuite/cli/bin/lark-cli", "missing");
    state.virtual.set("/prefix/bin/lark-cli", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/prefix/bin/lark-cli");

    // 包内入口存在时优先
    state.virtual.set("/prefix/lib/node_modules/@larksuite/cli/bin/lark-cli", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe(
      "/prefix/lib/node_modules/@larksuite/cli/bin/lark-cli",
    );
  });

  it("npm prefix -g 执行失败/输出空 → 跳过 npm 布局，最终 null", () => {
    process.env.PATH = "";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/lark-cli", "missing");
    state.virtual.set("/h/.vite-plus/js_runtime/node", "missing");
    state.virtual.set("/h/.volta/bin/npm", "file");
    state.execFileSyncMock.mockImplementation(() => {
      throw new Error("npm 不可用");
    });
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBeNull();

    state.execFileSyncMock.mockReturnValue("   \n");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBeNull();
  });
});

describe("resolveLarkCliPath：Windows 兜底", () => {
  it("%APPDATA%\\npm\\lark-cli.cmd 优先于 npm prefix 布局", () => {
    stubPlatform("win32");
    process.env.PATH = "";
    process.env.APPDATA = "/appdata";
    state.virtual.set("/appdata/npm/lark-cli.cmd", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/appdata/npm/lark-cli.cmd");
  });

  it("APPDATA 未命中 → npm prefix 根目录下的 .cmd/.exe 垫片", () => {
    stubPlatform("win32");
    process.env.PATH = "";
    process.env.APPDATA = "/appdata";
    state.virtual.set("/appdata/npm/lark-cli.cmd", "missing");
    // npmGlobalPrefix 依赖 resolveNpmPath 先找到 npm
    state.virtual.set("/appdata/npm/npm.cmd", "file");
    state.execFileSyncMock.mockReturnValue("/prefix");
    state.virtual.set("/prefix/lark-cli.cmd", "missing");
    state.virtual.set("/prefix/lark-cli.exe", "file");
    invalidateLarkCliPathCache();
    expect(resolveLarkCliPath()).toBe("/prefix/lark-cli.exe");
  });
});

describe("resolveNpmPath：候选布局", () => {
  it("PATH 未命中 → 依次尝试 homebrew / usr/local / usr/bin", () => {
    process.env.PATH = "";
    state.home = "/h";
    state.virtual.set("/opt/homebrew/bin/npm", "missing");
    state.virtual.set("/usr/local/bin/npm", "file");
    expect(resolveNpmPath()).toBe("/usr/local/bin/npm");
  });

  it("home 目录布局：~/.local/bin、~/.volta/bin、vite-plus/nvm 版本目录", () => {
    process.env.PATH = "";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/npm", "missing");
    state.virtual.set("/h/.volta/bin/npm", "file");
    expect(resolveNpmPath()).toBe("/h/.volta/bin/npm");

    state.virtual.set("/h/.volta/bin/npm", "missing");
    state.virtual.set("/h/.vite-plus/js_runtime/node", ["24.18.0", "24.21.0"]);
    state.virtual.set("/h/.vite-plus/js_runtime/node/24.18.0/bin/npm", "missing");
    state.virtual.set("/h/.vite-plus/js_runtime/node/24.21.0/bin/npm", "file");
    expect(resolveNpmPath()).toBe("/h/.vite-plus/js_runtime/node/24.21.0/bin/npm");

    // 目录不存在（readdirSync 抛错）→ 跳到 nvm
    state.virtual.set("/h/.vite-plus/js_runtime/node", "missing");
    state.virtual.set("/h/.nvm/versions/node", ["v20.11.0"]);
    state.virtual.set("/h/.nvm/versions/node/v20.11.0/bin/npm", "file");
    expect(resolveNpmPath()).toBe("/h/.nvm/versions/node/v20.11.0/bin/npm");
  });

  it("Windows：APPDATA / ProgramFiles / LOCALAPPDATA 布局", () => {
    stubPlatform("win32");
    process.env.PATH = "";
    process.env.APPDATA = "/appdata";
    process.env.ProgramFiles = "/pf";
    process.env.LOCALAPPDATA = "/la";
    state.virtual.set("/appdata/npm/npm.cmd", "missing");
    state.virtual.set("/pf/nodejs/npm.cmd", "file");
    expect(resolveNpmPath()).toBe("/pf/nodejs/npm.cmd");

    state.virtual.set("/pf/nodejs/npm.cmd", "missing");
    state.virtual.set("/la/Programs/nodejs/npm.cmd", "file");
    expect(resolveNpmPath()).toBe("/la/Programs/nodejs/npm.cmd");
  });

  it("全部候选未命中 → null", () => {
    process.env.PATH = "";
    state.home = "/h";
    hideSystemNpm();
    state.virtual.set("/h/.local/bin/npm", "missing");
    state.virtual.set("/h/.volta/bin/npm", "missing");
    state.virtual.set("/h/.vite-plus/js_runtime/node", "missing");
    state.virtual.set("/h/.nvm/versions/node", "missing");
    expect(resolveNpmPath()).toBeNull();
  });
});

describe("npmExecutionEnv 细节", () => {
  it("npm 目录已在 PATH 时不重复前置；Windows 用 Path 键", () => {
    const previousPath = process.env.PATH;
    process.env.PATH = "/Users/u/.local/bin:/usr/bin";
    try {
      const env = npmExecutionEnv("/Users/u/.local/bin/npm");
      expect(env.PATH?.split(":").filter((p) => p === "/Users/u/.local/bin")).toHaveLength(1);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }

    stubPlatform("win32");
    process.env.Path = "C:\\bin";
    try {
      const env = npmExecutionEnv("C:\\tools\\npm.cmd");
      expect(env.Path?.startsWith("C:\\tools")).toBe(true);
    } finally {
      delete process.env.Path;
    }
  });
});
