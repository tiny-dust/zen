/**
 * 系统能力四件套的纯函数层：平台后端裁决与外部命令构造。
 * 全部输出 execFile 的数组参数形态，禁止 shell 字符串拼接（命令注入防护）。
 * 三平台分支的降级规则也在这里（vitest 覆盖，见 commands.test.ts）。
 */

import type { AbilityProbe, TtsSpeakOptions } from "@zen/shared";

/** probe 时收集的工具可用性：工具名 → 是否在 PATH 上 */
export type ToolAvailability = Record<string, boolean>;

// ---------------------------------------------------------------------------
// 后端裁决（三平台 × 四能力）
// ---------------------------------------------------------------------------

export function resolveVoiceBackend(
  platform: string,
  tools: ToolAvailability,
): AbilityProbe {
  // macOS：Swift 工具（AVAudioRecorder + SFSpeechRecognizer），需要 swiftc 可编译
  if (platform === "darwin") {
    return tools["swift"]
      ? { supported: true, backend: "swift" }
      : { supported: false, reason: "未安装 Xcode 命令行工具（swiftc），无法编译语音识别组件" };
  }
  // Windows：Windows PowerShell + System.Speech（系统自带）
  if (platform === "win32") {
    return tools["powershell"]
      ? { supported: true, backend: "powershell" }
      : { supported: false, reason: "未找到 Windows PowerShell" };
  }
  // Linux：arecord 录音 + whisper 转写，两者齐备才可用
  if (tools["arecord"] && tools["whisper"]) {
    return { supported: true, backend: "whisper" };
  }
  return { supported: false, reason: "需要安装 arecord 与 whisper 命令（录音 + 语音转写）" };
}

export function resolveTtsBackend(platform: string, tools: ToolAvailability): AbilityProbe {
  if (platform === "darwin") {
    return tools["say"]
      ? { supported: true, backend: "say" }
      : { supported: false, reason: "未找到系统 say 命令" };
  }
  if (platform === "win32") {
    return tools["powershell"]
      ? { supported: true, backend: "powershell" }
      : { supported: false, reason: "未找到 Windows PowerShell" };
  }
  // Linux 依次尝试 spd-say / espeak / festival
  for (const backend of ["spd-say", "espeak", "festival"]) {
    if (tools[backend]) {
      return { supported: true, backend };
    }
  }
  return { supported: false, reason: "未找到 spd-say / espeak / festival 任一语音合成命令" };
}

export function resolveOcrBackend(platform: string, tools: ToolAvailability): AbilityProbe {
  if (platform === "darwin") {
    return tools["swift"]
      ? { supported: true, backend: "swift" }
      : { supported: false, reason: "未安装 Xcode 命令行工具（swiftc），无法编译文字识别组件" };
  }
  if (platform === "win32") {
    return tools["powershell"]
      ? { supported: true, backend: "powershell" }
      : { supported: false, reason: "未找到 Windows PowerShell" };
  }
  return tools["tesseract"]
    ? { supported: true, backend: "tesseract" }
    : { supported: false, reason: "未安装 tesseract（OCR 命令行工具）" };
}

export function resolveCuaBackend(platform: string, tools: ToolAvailability): AbilityProbe {
  if (platform === "darwin") {
    return tools["swift"]
      ? { supported: true, backend: "swift" }
      : { supported: false, reason: "未安装 Xcode 命令行工具（swiftc），无法编译鼠标控制组件" };
  }
  if (platform === "win32") {
    return tools["powershell"]
      ? { supported: true, backend: "powershell" }
      : { supported: false, reason: "未找到 Windows PowerShell" };
  }
  return tools["xdotool"]
    ? { supported: true, backend: "xdotool" }
    : { supported: false, reason: "未安装 xdotool（X11 桌面自动化工具）" };
}

// ---------------------------------------------------------------------------
// TTS 命令构造（rate 统一 -10 ~ 10）
// ---------------------------------------------------------------------------

export interface CommandSpec {
  command: string;
  args: string[];
  /** festival 等从 stdin 读文本的命令 */
  stdin?: string;
}

/** rate -10~10 → macOS say 的词/分钟（默认 175） */
export function sayWordsPerMinute(rate: number): number {
  return 175 + clampRate(rate) * 10;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }
  return Math.max(-10, Math.min(10, Math.round(rate)));
}

export function buildTtsCommand(
  backend: string,
  text: string,
  options?: TtsSpeakOptions,
): CommandSpec {
  const rate = clampRate(options?.rate ?? 0);
  const voice = options?.voice?.trim() || undefined;
  if (backend === "say") {
    const args: string[] = [];
    if (voice) {
      args.push("-v", voice);
    }
    args.push("-r", String(sayWordsPerMinute(rate)), text);
    return { command: "say", args };
  }
  if (backend === "spd-say") {
    // spd-say -w 等待播完（进程存活期间可被 stop 中断）；-r 语速为百分比
    const args = ["-w", "-r", String(rate * 10)];
    if (voice) {
      args.push("-l", voice);
    }
    args.push(text);
    return { command: "spd-say", args };
  }
  if (backend === "espeak") {
    const args = ["-s", String(160 + rate * 12)];
    if (voice) {
      args.push("-v", voice);
    }
    args.push(text);
    return { command: "espeak", args };
  }
  if (backend === "festival") {
    // festival 从 stdin 读文本
    return { command: "festival", args: ["--tts"], stdin: `${text}\n` };
  }
  // Windows / 未知后端：由服务层的 PowerShell 路径处理，这里给保守兜底
  return { command: backend, args: [text] };
}

/** Windows TTS：powershell.exe -File <tts.ps1> -Text <text> -Rate <n>（SAPI Rate 恰为 -10~10） */
export function buildTtsPowerShellArgs(
  scriptPath: string,
  text: string,
  options?: TtsSpeakOptions,
): string[] {
  const rate = clampRate(options?.rate ?? 0);
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Text",
    text,
    "-Rate",
    String(rate),
  ];
  if (options?.voice?.trim()) {
    args.push("-Voice", options.voice.trim());
  }
  return args;
}

// ---------------------------------------------------------------------------
// 语音输入（Linux 录音/转写）命令构造
// ---------------------------------------------------------------------------

export function buildArecordCommand(outputPath: string): CommandSpec {
  // -f cd：16bit 44.1kHz stereo 的 CD 质量格式；-q 静默；stop 时 SIGINT 落盘
  return { command: "arecord", args: ["-q", "-f", "cd", "-t", "wav", outputPath] };
}

export function buildWhisperCommand(audioPath: string, outputDir: string): CommandSpec {
  return {
    command: "whisper",
    args: [
      "--model",
      "tiny",
      "--task",
      "transcribe",
      "--output_format",
      "txt",
      "--output_dir",
      outputDir,
      audioPath,
    ],
  };
}

/** whisper 输出 txt 路径：输出目录下同名 .txt */
export function whisperTextPath(audioPath: string, outputDir: string): string {
  const base = audioPath.split(/[\\/]/).pop() ?? "audio.wav";
  const stem = base.replace(/\.[^.]+$/, "");
  return `${outputDir}/${stem}.txt`;
}

// ---------------------------------------------------------------------------
// 键盘按键归一化（三平台键名/组合键解析）
// ---------------------------------------------------------------------------

export interface KeyCombo {
  modifiers: Array<"ctrl" | "alt" | "shift" | "meta">;
  key: string;
}

const MODIFIER_ALIASES: Record<string, KeyCombo["modifiers"][number]> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  altgr: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  win: "meta",
  super: "meta",
};

/** 解析 "ctrl+c" / "cmd+shift+3" / "enter" 为修饰键 + 主键 */
export function parseKeyCombo(input: string): KeyCombo | null {
  const tokens = input
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  const modifiers: KeyCombo["modifiers"] = [];
  let key = "";
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token];
    if (modifier) {
      modifiers.push(modifier);
    } else {
      key = token;
    }
  }
  if (!key) {
    // 只有修饰键（如 "ctrl"）：视为按下 ctrl 本身，各平台按主键处理
    key = modifiers.pop() as string;
  }
  return { modifiers, key };
}

// ---------------------------------------------------------------------------
// macOS AppleScript（osascript，System Events 键盘）
// ---------------------------------------------------------------------------

/** AppleScript 字符串字面量转义：反斜杠与双引号（防注入到 -e 脚本） */
export function escapeAppleScriptString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const APPLE_KEY_CODES: Record<string, number> = {
  enter: 36,
  return: 36,
  tab: 48,
  esc: 53,
  escape: 53,
  space: 49,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  delete: 51,
  backspace: 51,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

const APPLE_MODIFIERS: Record<KeyCombo["modifiers"][number], string> = {
  ctrl: "control down",
  alt: "option down",
  shift: "shift down",
  meta: "command down",
};

/** 构造 osascript 键盘脚本：keystroke（字符）或 key code（功能键） */
export function buildAppleScriptKeyScript(input: string): { script: string } | { error: string } {
  const combo = parseKeyCombo(input);
  if (!combo) {
    return { error: "无法解析按键" };
  }
  const using = combo.modifiers.map((modifier) => APPLE_MODIFIERS[modifier]);
  const usingClause = using.length
    ? ` using ${using.length > 1 ? `{${using.join(", ")}}` : using[0]}`
    : "";
  const keyCode = APPLE_KEY_CODES[combo.key];
  if (keyCode != null) {
    return { script: `tell application "System Events" to key code ${keyCode}${usingClause}` };
  }
  if (combo.key.length === 1) {
    return {
      script: `tell application "System Events" to keystroke "${escapeAppleScriptString(combo.key)}"${usingClause}`,
    };
  }
  return { error: `不支持的按键：${combo.key}` };
}

/** 构造 osascript 键入整段文本的脚本 */
export function buildAppleScriptTypeScript(text: string): string {
  // 换行逐条发送：keystroke 单次含 \n 行为不稳定
  const lines = text.split("\n");
  const parts = lines.map((line, index) => {
    const typeLine = `tell application "System Events" to keystroke "${escapeAppleScriptString(line)}"`;
    return index < lines.length - 1
      ? `${typeLine}\ntell application "System Events" to key code 36`
      : typeLine;
  });
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Windows SendKeys（System.Windows.Forms，脚本内 SendWait）
// ---------------------------------------------------------------------------

/** SendKeys 特殊字符需要包 {} 才能按字面输入 */
const SENDKEYS_SPECIALS = new Set(["+", "^", "%", "~", "(", ")", "{", "}", "[", "]"]);

/** 文本 → SendKeys 序列：特殊字符转义，换行转回车 */
export function escapeSendKeysText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\n") {
      out += "{ENTER}";
    } else if (ch === "\r") {
      continue;
    } else if (ch === "\t") {
      out += "{TAB}";
    } else if (SENDKEYS_SPECIALS.has(ch)) {
      out += `{${ch}}`;
    } else {
      out += ch;
    }
  }
  return out;
}

const SENDKEYS_KEYS: Record<string, string> = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  esc: "{ESC}",
  escape: "{ESC}",
  space: " ",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  delete: "{DEL}",
  backspace: "{BS}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
};

const SENDKEYS_MODIFIERS: Record<KeyCombo["modifiers"][number], string> = {
  ctrl: "^",
  alt: "%",
  shift: "+",
  meta: "", // SendKeys 无 Windows 键；meta 组合在 Windows 上不可用
};

/** 按键/组合键 → SendKeys 序列（在 TS 侧构造，ps1 只负责 SendWait） */
export function buildSendKeysSequence(input: string): { sequence: string } | { error: string } {
  const combo = parseKeyCombo(input);
  if (!combo) {
    return { error: "无法解析按键" };
  }
  let prefix = "";
  for (const modifier of combo.modifiers) {
    const mapped = SENDKEYS_MODIFIERS[modifier];
    if (mapped == null) {
      return { error: `不支持的修饰键：${modifier}` };
    }
    if (mapped === "") {
      return { error: "Windows SendKeys 不支持 win/meta 组合键" };
    }
    prefix += mapped;
  }
  if (combo.modifiers.includes("meta")) {
    return { error: "Windows SendKeys 不支持 win/meta 组合键" };
  }
  const named = SENDKEYS_KEYS[combo.key];
  if (named != null) {
    return { sequence: `${prefix}${named}` };
  }
  if (combo.key.length === 1) {
    return { sequence: `${prefix}${escapeSendKeysText(combo.key)}` };
  }
  return { error: `不支持的按键：${combo.key}` };
}

// ---------------------------------------------------------------------------
// Linux xdotool
// ---------------------------------------------------------------------------

const XDOTOOL_KEYS: Record<string, string> = {
  enter: "Return",
  return: "Return",
  tab: "Tab",
  esc: "Escape",
  escape: "Escape",
  space: "space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  delete: "Delete",
  backspace: "BackSpace",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  pagedown: "Page_Down",
};

const XDOTOOL_MODIFIERS: Record<KeyCombo["modifiers"][number], string> = {
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
  meta: "super",
};

/** 按键/组合键 → xdotool key 参数（如 "ctrl+c" → "ctrl+c"，"enter" → "Return"） */
export function buildXdotoolKeyArg(input: string): { arg: string } | { error: string } {
  const combo = parseKeyCombo(input);
  if (!combo) {
    return { error: "无法解析按键" };
  }
  const named = XDOTOOL_KEYS[combo.key];
  const main = named ?? (combo.key.length === 1 ? combo.key : null);
  if (main == null) {
    return { error: `不支持的按键：${combo.key}` };
  }
  const modifiers = combo.modifiers.map((modifier) => XDOTOOL_MODIFIERS[modifier]);
  return { arg: [...modifiers, main].join("+") };
}

/** xdotool 鼠标/键入命令（多个子命令可直接串在同一调用里） */
export function buildXdotoolMouseArgs(
  action: "move" | "click",
  x: number,
  y: number,
  button?: "left" | "right" | "middle",
): string[] {
  if (action === "move") {
    return ["mousemove", String(Math.round(x)), String(Math.round(y))];
  }
  const buttonNumber = button === "right" ? 3 : button === "middle" ? 2 : 1;
  return ["mousemove", String(Math.round(x)), String(Math.round(y)), "click", String(buttonNumber)];
}

export function buildXdotoolTypeArgs(text: string): string[] {
  return ["type", "--", text];
}
