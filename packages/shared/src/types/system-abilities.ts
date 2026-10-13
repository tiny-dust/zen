/**
 * 系统层能力四件套（语音输入 ASR / TTS 播报 / OCR / CUA 桌面自动化）的
 * 跨端类型：probe 结果、IPC 响应与 agent-core 的 CUA 桥接口。
 * 平台实现见 apps/desktop/src/main/abilities/（三平台分支 + 安全降级）。
 */

/** 能力探测结果：supported=false 时 reason 为不可用原因（主进程中文，直接可展示） */
export interface AbilityProbe {
  supported: boolean;
  /** 实现后端标识：say / powershell / swift / spd-say / espeak / festival / tesseract / xdotool 等 */
  backend?: string;
  /** 不支持时的用户可读原因 */
  reason?: string;
}

/** 语音输入：start 开录、stop 停录并转写 */
export interface VoiceStartResult {
  ok: boolean;
  error?: string;
}

export interface VoiceTranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** TTS 播报选项：rate 统一 -10（慢）~ 10（快），各平台后端自行换算 */
export interface TtsSpeakOptions {
  voice?: string;
  rate?: number;
}

/** OCR：传入本地图片路径，返回识别文本 */
export interface OcrResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** CUA 基础动作结果 */
export interface CuaActionResult {
  ok: boolean;
  error?: string;
}

/** CUA 屏幕尺寸（主显示器，DIP 口径：Electron screen API） */
export interface CuaScreenSize {
  ok: boolean;
  width?: number;
  height?: number;
  error?: string;
}

export type CuaMouseButton = "left" | "right" | "middle";

/**
 * CUA 桌面自动化桥（agent-core 注入；desktop 侧 abilities/cua.ts 实现）。
 * 与 BrowserAgentBridge 同构：agent-tools 按 bridge 是否存在决定注册 cua.* 工具。
 */
export interface CuaAgentBridge {
  /** 后端可用性（macOS Swift CGEvent / Windows PowerShell / Linux xdotool） */
  status(): Promise<AbilityProbe>;
  /** 主显示器尺寸 */
  screenSize(): Promise<CuaScreenSize>;
  /** 移动鼠标到 (x, y) */
  mouseMove(x: number, y: number): Promise<CuaActionResult>;
  /** 点击鼠标；x/y 缺省在当前位置点击 */
  mouseClick(button?: CuaMouseButton, x?: number, y?: number): Promise<CuaActionResult>;
  /** 键入一段文本（当前焦点处） */
  keyboardType(text: string): Promise<CuaActionResult>;
  /** 按键/组合键，如 "enter" / "tab" / "esc" / "ctrl+c" / "cmd+shift+3" */
  keyboardKey(key: string): Promise<CuaActionResult>;
}
