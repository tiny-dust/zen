// 系统能力脚本静态校验：Windows 分支内嵌 PS1（voice/cua/ocr/tts）+
// Linux 命令构建器的注入安全（补 commands.test.ts 未覆盖的路径分支）。
// 本机（macOS）无 pwsh 时跳过真语法校验，仅做结构不变量与落盘回读冒烟。
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CUA_PS1 } from "./cua";
import { OCR_PS1 } from "./ocr";
import { TTS_PS1 } from "./tts";
import { VOICE_PS1 } from "./voice";
import { buildArecordCommand, buildWhisperCommand, whisperTextPath } from "./commands";

// cua.ts 顶层 import { screen } from "electron"：测试环境替换为空实现（只取常量）
vi.mock("electron", () => ({ screen: {} }));

/** 全部内嵌 PS1：[运行时落盘文件名, 源码]（文件名与 ps1ScriptPath 一致） */
const PS1_SCRIPTS = [
  { file: "zen-voice-rec.ps1", source: VOICE_PS1 },
  { file: "zen-cua.ps1", source: CUA_PS1 },
  { file: "zen-ocr.ps1", source: OCR_PS1 },
  { file: "zen-tts.ps1", source: TTS_PS1 },
] as const;

/** 落盘冒烟与 pwsh 校验共用的检查目录（保留产物供人工核对） */
const PS1_CHECK_DIR = join(homedir(), ".zen", "cache", "tmp-ps1-check");

/**
 * PowerShell 轻量静态扫描：跳过字符串/here-string/注释后统计括号深度。
 * 覆盖的字符串规则：双引号内反引号转义、单引号内 '' 转义、
 * here-string（@" / @' 起，行首 "@ / '@ 止）、# 行注释与 <# #> 块注释。
 */
function scanPowerShell(source: string): {
  braceDepth: number;
  parenDepth: number;
  minBraceDepth: number;
  minParenDepth: number;
  unterminatedString: boolean;
  unterminatedHereString: boolean;
  hereStrings: number;
} {
  type State =
    | "code"
    | "single"
    | "double"
    | "hereDouble"
    | "hereSingle"
    | "lineComment"
    | "blockComment";
  let state: State = "code";
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let minBraceDepth = 0;
  let minParenDepth = 0;
  let hereStrings = 0;
  const n = source.length;
  while (i < n) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    switch (state) {
      case "code":
        if (ch === "<" && next === "#") {
          state = "blockComment";
          i += 2;
        } else if (ch === "#") {
          state = "lineComment";
          i += 1;
        } else if (ch === "@" && (next === '"' || next === "'")) {
          hereStrings += 1;
          state = next === '"' ? "hereDouble" : "hereSingle";
          i += 2;
        } else if (ch === '"') {
          state = "double";
          i += 1;
        } else if (ch === "'") {
          state = "single";
          i += 1;
        } else if (ch === "{") {
          braceDepth += 1;
          i += 1;
        } else if (ch === "}") {
          braceDepth -= 1;
          minBraceDepth = Math.min(minBraceDepth, braceDepth);
          i += 1;
        } else if (ch === "(") {
          parenDepth += 1;
          i += 1;
        } else if (ch === ")") {
          parenDepth -= 1;
          minParenDepth = Math.min(minParenDepth, parenDepth);
          i += 1;
        } else {
          i += 1;
        }
        break;
      case "lineComment":
        if (ch === "\n") {
          state = "code";
        }
        i += 1;
        break;
      case "blockComment":
        if (ch === "#" && next === ">") {
          state = "code";
          i += 2;
        } else {
          i += 1;
        }
        break;
      case "double":
        if (ch === "`") {
          i += 2; // 反引号转义（含行尾续行）
        } else {
          if (ch === '"') {
            state = "code";
          }
          i += 1;
        }
        break;
      case "single":
        if (ch === "'") {
          if (next === "'") {
            i += 2; // '' 转义为字面单引号
          } else {
            state = "code";
            i += 1;
          }
        } else {
          i += 1;
        }
        break;
      case "hereDouble":
      case "hereSingle": {
        // 闭合标记必须独占一行（行首 "@ / '@）
        const closer = state === "hereDouble" ? '"@' : "'@";
        if (ch === "\n" && source.startsWith(closer, i + 1)) {
          state = "code";
          i += 1 + closer.length;
        } else {
          i += 1;
        }
        break;
      }
    }
  }
  return {
    braceDepth,
    parenDepth,
    minBraceDepth,
    minParenDepth,
    unterminatedString: state === "single" || state === "double",
    unterminatedHereString: state === "hereDouble" || state === "hereSingle",
    hereStrings,
  };
}

describe("内嵌 PS1 静态校验（Windows 分支四件套）", () => {
  for (const { file, source } of PS1_SCRIPTS) {
    it(`${file}：param() 首行、括号配平、无未闭合字符串/here-string`, () => {
      // 不变量（逐脚本核对过）：param() 块必须在首行，否则 -File 传参失败
      expect(source.startsWith("param(")).toBe(true);
      // 统一严格错误处理，脚本内异常不会静默吞掉
      expect(source).toContain("$ErrorActionPreference");
      const scan = scanPowerShell(source);
      // 花括号/圆括号配平，且扫描过程中深度不为负（先闭后开即结构错误）
      expect(scan.braceDepth).toBe(0);
      expect(scan.minBraceDepth).toBe(0);
      expect(scan.parenDepth).toBe(0);
      expect(scan.minParenDepth).toBe(0);
      // 引号/here-string 均已闭合
      expect(scan.unterminatedString).toBe(false);
      expect(scan.unterminatedHereString).toBe(false);
    });
  }
});

describe("PS1 落盘回读冒烟（模拟 ensurePs1Script 的写盘行为）", () => {
  it("写出到 ~/.zen/cache/tmp-ps1-check/ 后回读与源一致", async () => {
    await rm(PS1_CHECK_DIR, { recursive: true, force: true });
    await mkdir(PS1_CHECK_DIR, { recursive: true });
    for (const { file, source } of PS1_SCRIPTS) {
      const target = join(PS1_CHECK_DIR, file);
      // 与运行时一致：utf8 全量写出（非追加）
      await writeFile(target, source, "utf8");
      expect(await readFile(target, "utf8")).toBe(source);
    }
  });
});

// 本机有 pwsh 时才做真语法校验（macOS 开发机通常没有，跳过不算失败）
const PWSH_AVAILABLE =
  spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;

describe.skipIf(!PWSH_AVAILABLE)("pwsh AST 真语法校验", () => {
  for (const { file, source } of PS1_SCRIPTS) {
    it(`${file} 通过 PowerShell Parser 解析`, async () => {
      const target = join(PS1_CHECK_DIR, file);
      await writeFile(target, source, "utf8");
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          [
            "$tokens = $null; $errors = $null",
            "$null = [System.Management.Automation.Language.Parser]::ParseFile($env:ZEN_PS1_CHECK_PATH, [ref]$tokens, [ref]$errors)",
            "if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }",
            "exit 0",
          ].join("; "),
        ],
        { env: { ...process.env, ZEN_PS1_CHECK_PATH: target }, timeout: 30_000 },
      );
      expect(result.status).toBe(0);
    });
  }
});

describe("Linux 命令构建器注入安全（补 commands.test.ts 未覆盖的路径分支）", () => {
  // 路径由 join(cacheRoot, uuid.wav) 生成，但静态校验仍按恶意输入对待：
  // 空格 + 分号 + 引号在 shell 拼接场景下都会拆参/注入
  const hostilePath = '/tmp/zen voice; rm -rf ~ && echo "pwned".wav';
  const hostileDir = "/tmp/zen out; touch pwned";

  it("arecord：恶意输出路径仍是单个参数", () => {
    const spec = buildArecordCommand(hostilePath);
    expect(spec.command).toBe("arecord");
    // 数组参数形态：路径原样占据一个元素，不会被空格/分号拆开
    expect(spec.args).toEqual(["-q", "-f", "cd", "-t", "wav", hostilePath]);
  });

  it("whisper：恶意音频路径与输出目录均保持单参数", () => {
    const spec = buildWhisperCommand(hostilePath, hostileDir);
    expect(spec.command).toBe("whisper");
    expect(spec.args).toEqual([
      "--model",
      "tiny",
      "--task",
      "transcribe",
      "--output_format",
      "txt",
      "--output_dir",
      hostileDir,
      hostilePath,
    ]);
    expect(spec.args.every((arg) => typeof arg === "string")).toBe(true);
  });

  it("whisperTextPath：恶意文件名只做 basename/stem 拼接，不逃逸输出目录", () => {
    expect(whisperTextPath("/tmp/x/evil;name.wav", "/tmp/out dir")).toBe(
      "/tmp/out dir/evil;name.txt",
    );
    // 无扩展名 / 反斜杠（Windows 缓存路径）也能取出 stem
    expect(whisperTextPath("C:\\v\\noext", "/tmp/o")).toBe("/tmp/o/noext.txt");
  });
});
