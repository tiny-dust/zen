import { describe, expect, it } from "vitest";

import {
  buildAppleScriptKeyScript,
  buildAppleScriptTypeScript,
  buildArecordCommand,
  buildSendKeysSequence,
  buildTtsCommand,
  buildTtsPowerShellArgs,
  buildWhisperCommand,
  buildXdotoolKeyArg,
  buildXdotoolMouseArgs,
  buildXdotoolTypeArgs,
  escapeAppleScriptString,
  escapeSendKeysText,
  parseKeyCombo,
  resolveCuaBackend,
  resolveOcrBackend,
  resolveTtsBackend,
  resolveVoiceBackend,
  sayWordsPerMinute,
  whisperTextPath,
} from "./commands";
import { swiftBinaryName, swiftToolPaths } from "./swift-tools";

describe("平台后端裁决（三平台 × 四能力降级）", () => {
  it("voice：macOS 需 swiftc；Windows 需 powershell；Linux 需 arecord+whisper 齐备", () => {
    expect(resolveVoiceBackend("darwin", { swift: true })).toEqual({
      supported: true,
      backend: "swift",
    });
    expect(resolveVoiceBackend("darwin", {}).supported).toBe(false);

    expect(resolveVoiceBackend("win32", { powershell: true }).supported).toBe(true);
    expect(resolveVoiceBackend("win32", {}).supported).toBe(false);

    expect(resolveVoiceBackend("linux", { arecord: true, whisper: true }).supported).toBe(true);
    // 只装了录音（arecord），没有转写（whisper）→ 不可用
    expect(resolveVoiceBackend("linux", { arecord: true }).supported).toBe(false);
    expect(resolveVoiceBackend("linux", {}).reason).toContain("arecord");
  });

  it("tts：macOS say；Linux 按 spd-say → espeak → festival 回退", () => {
    expect(resolveTtsBackend("darwin", { say: true }).backend).toBe("say");
    expect(resolveTtsBackend("darwin", {}).supported).toBe(false);

    expect(resolveTtsBackend("win32", { powershell: true }).backend).toBe("powershell");

    expect(resolveTtsBackend("linux", { espeak: true }).backend).toBe("espeak");
    expect(resolveTtsBackend("linux", { festival: true }).backend).toBe("festival");
    expect(resolveTtsBackend("linux", { "spd-say": true, espeak: true }).backend).toBe("spd-say");
    expect(resolveTtsBackend("linux", {}).supported).toBe(false);
  });

  it("ocr：macOS swift / Windows powershell / Linux tesseract，缺失即降级", () => {
    expect(resolveOcrBackend("darwin", { swift: true }).backend).toBe("swift");
    expect(resolveOcrBackend("win32", { powershell: true }).backend).toBe("powershell");
    expect(resolveOcrBackend("linux", { tesseract: true }).backend).toBe("tesseract");
    expect(resolveOcrBackend("linux", {}).supported).toBe(false);
  });

  it("cua：macOS swift / Windows powershell / Linux xdotool，缺失即降级", () => {
    expect(resolveCuaBackend("darwin", { swift: true }).backend).toBe("swift");
    expect(resolveCuaBackend("win32", { powershell: true }).backend).toBe("powershell");
    expect(resolveCuaBackend("linux", { xdotool: true }).backend).toBe("xdotool");
    expect(resolveCuaBackend("linux", {}).supported).toBe(false);
  });
});

describe("TTS 命令构造（execFile 数组参数，无 shell 拼接）", () => {
  it("say：语速 -10~10 映射到 75~275 词/分钟", () => {
    expect(sayWordsPerMinute(0)).toBe(175);
    expect(sayWordsPerMinute(10)).toBe(275);
    expect(sayWordsPerMinute(-10)).toBe(75);
    // 越界收敛
    expect(sayWordsPerMinute(99)).toBe(275);
    expect(sayWordsPerMinute(Number.NaN)).toBe(175);
  });

  it("say 参数是数组，含注入字符的文本只作为单参数", () => {
    const spec = buildTtsCommand("say", 'hello; rm -rf / "quoted"', { rate: 3, voice: "Ting-Ting" });
    expect(spec.command).toBe("say");
    expect(spec.args).toEqual(["-v", "Ting-Ting", "-r", "205", 'hello; rm -rf / "quoted"']);
    expect(spec.args.every((arg) => typeof arg === "string")).toBe(true);
  });

  it("espeak/spd-say/festival：各后端参数形态", () => {
    expect(buildTtsCommand("espeak", "你好", { rate: 5 })).toEqual({
      command: "espeak",
      args: ["-s", "220", "你好"],
    });
    expect(buildTtsCommand("spd-say", "hi")).toEqual({
      command: "spd-say",
      args: ["-w", "-r", "0", "hi"],
    });
    // festival 从 stdin 读文本，正文不进参数
    const festival = buildTtsCommand("festival", "line1\nline2");
    expect(festival.args).toEqual(["--tts"]);
    expect(festival.stdin).toBe("line1\nline2\n");
  });

  it("Windows TTS：-File 静态脚本 + 参数化文本（注入字符不落进脚本）", () => {
    const args = buildTtsPowerShellArgs("/cache/bin/zen-tts.ps1", 'a"b; $(rm)', { rate: 2 });
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "/cache/bin/zen-tts.ps1",
      "-Text",
      'a"b; $(rm)',
      "-Rate",
      "2",
    ]);
  });
});

describe("Linux 语音链路（arecord + whisper）", () => {
  it("arecord 参数是数组", () => {
    expect(buildArecordCommand("/tmp/a.wav")).toEqual({
      command: "arecord",
      args: ["-q", "-f", "cd", "-t", "wav", "/tmp/a.wav"],
    });
  });

  it("whisper 输出 txt 路径：目录 + 同名 .txt（兼容反斜杠）", () => {
    expect(whisperTextPath("/tmp/voice/a.wav", "/tmp/out")).toBe("/tmp/out/a.txt");
    expect(whisperTextPath("C:\\v\\b.wav", "C:\\o")).toBe("C:\\o/b.txt");
    expect(buildWhisperCommand("/tmp/a.wav", "/tmp/out").args).toContain("/tmp/out");
  });
});

describe("按键解析与三平台键序构造", () => {
  it("parseKeyCombo：修饰键别名归一", () => {
    expect(parseKeyCombo("ctrl+c")).toEqual({ modifiers: ["ctrl"], key: "c" });
    expect(parseKeyCombo("CMD+SHIFT+3")).toEqual({ modifiers: ["meta", "shift"], key: "3" });
    expect(parseKeyCombo("enter")).toEqual({ modifiers: [], key: "enter" });
    expect(parseKeyCombo("")).toBeNull(); // 空输入不合法
    expect(parseKeyCombo("   ")).toBeNull();
  });

  it("AppleScript：功能键 key code、字符 keystroke、注入转义", () => {
    expect(buildAppleScriptKeyScript("enter")).toEqual({
      script: 'tell application "System Events" to key code 36',
    });
    expect(buildAppleScriptKeyScript("cmd+c")).toEqual({
      script: 'tell application "System Events" to keystroke "c" using command down',
    });
    // 引号与反斜杠转义，防注入
    expect(escapeAppleScriptString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(buildAppleScriptTypeScript('say "hi"')).toContain('\\"hi\\"');
  });

  it("SendKeys：特殊字符包 {}、换行转 ENTER、meta 不支持报错", () => {
    // ~ 在 SendKeys 里是 Enter，字面波浪线要包 {}
    expect(escapeSendKeysText("a+b(c)~d\ne")).toBe("a{+}b{(}c{)}{~}d{ENTER}e");
    expect(escapeSendKeysText("a\rb")).toBe("ab");
    expect(buildSendKeysSequence("ctrl+c")).toEqual({ sequence: "^c" });
    expect(buildSendKeysSequence("shift+enter")).toEqual({ sequence: "+{ENTER}" });
    const winKey = buildSendKeysSequence("win+r");
    expect("error" in winKey ? winKey.error : "").toContain("SendKeys");
  });

  it("xdotool：键名映射与组合键参数", () => {
    expect(buildXdotoolKeyArg("enter")).toEqual({ arg: "Return" });
    expect(buildXdotoolKeyArg("ctrl+alt+t")).toEqual({ arg: "ctrl+alt+t" });
    expect(buildXdotoolKeyArg("cmd+shift+3")).toEqual({ arg: "super+shift+3" });
    const unknownKey = buildXdotoolKeyArg("notakey");
    expect("error" in unknownKey && unknownKey.error).toBeTruthy();
  });

  it("xdotool 鼠标：移动/点击参数（按钮映射 1/2/3）", () => {
    expect(buildXdotoolMouseArgs("move", 100, 200)).toEqual(["mousemove", "100", "200"]);
    expect(buildXdotoolMouseArgs("click", 10.4, 20.6, "right")).toEqual([
      "mousemove",
      "10",
      "21",
      "click",
      "3",
    ]);
    expect(buildXdotoolTypeArgs("some --dangerous text")).toEqual(["type", "--", "some --dangerous text"]);
  });
});

describe("Swift 工具命名（源码 hash 失效机制）", () => {
  it("二进制名带源码 hash：源码变化即换名", () => {
    const a = swiftBinaryName("zen-voice", "source-a");
    const b = swiftBinaryName("zen-voice", "source-b");
    expect(a).toMatch(/^zen-voice-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("产物路径落在 cacheRoot 的 bin/ 与 src/", () => {
    const paths = swiftToolPaths("/Users/x/.zen/cache", "zen-ocr", "src");
    expect(paths.bin.startsWith("/Users/x/.zen/cache/bin/zen-ocr-")).toBe(true);
    expect(paths.src.startsWith("/Users/x/.zen/cache/src/zen-ocr-")).toBe(true);
    expect(paths.src.endsWith(".swift")).toBe(true);
  });
});
