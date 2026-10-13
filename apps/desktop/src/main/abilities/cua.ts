import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { screen } from "electron";

import type {
  AbilityProbe,
  CuaActionResult,
  CuaAgentBridge,
  CuaMouseButton,
  CuaScreenSize,
} from "@zen/shared";

import {
  buildAppleScriptKeyScript,
  buildAppleScriptTypeScript,
  buildSendKeysSequence,
  buildXdotoolKeyArg,
  buildXdotoolMouseArgs,
  buildXdotoolTypeArgs,
  escapeSendKeysText,
  resolveCuaBackend,
  type ToolAvailability,
} from "./commands";
import { checkTools, ps1ScriptPath } from "./tool-probe";
import { ensureSwiftTool } from "./swift-tools";

const execFileAsync = promisify(execFile);

/**
 * CUA 桌面自动化（第一版 = agent 工具，见 cua-ipc 注册与 agent-runner 桥接）。三平台：
 * - macOS：鼠标用 Swift 小工具（CoreGraphics CGEvent；osascript 无法直接移动光标），
 *   键盘用 osascript System Events（keystroke / key code），均需辅助功能权限；
 * - Windows：静态 ps1（user32 mouse_event + SendKeys SendWait），坐标/序列走参数；
 * - Linux：xdotool（不存在则不可用）。
 * 全部 execFile 数组参数。总开关：~/.zen/config.json 的 agent settings cuaEnabled（默认 off）。
 */

const CUA_SWIFT_SOURCE = `import ApplicationServices
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: zen-cua <move|click|dblclick|rightclick|middleclick> [x] [y]\\n".data(using: .utf8)!)
    exit(64)
}

// 辅助功能权限预检（合成鼠标事件需要；提示用户到系统设置开启）
let axOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
if !AXIsProcessTrustedWithOptions(axOptions) {
    FileHandle.standardError.write("需要在系统设置中为 Zen 开启辅助功能权限\\n".data(using: .utf8)!)
    exit(2)
}

let command = args[1]
func coord(_ index: Int) -> Double? {
    if args.count > index, let value = Double(args[index]) {
        return value
    }
    return nil
}
var point = CGPoint(x: coord(2) ?? -1, y: coord(3) ?? -1)
if point.x < 0 || point.y < 0 {
    point = CGEvent(source: nil)?.location ?? .zero
}

func post(_ type: CGEventType, button: CGMouseButton, click: Int64 = 1) -> Void {
    if let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) {
        if click > 1 {
            event.setIntegerValueField(.mouseEventClickState, value: click)
        }
        event.post(tap: CGEventTapLocation.cghidEventTap)
    }
}

switch command {
case "move":
    post(.mouseMoved, button: .left)
case "click":
    post(.leftMouseDown, button: .left)
    post(.leftMouseUp, button: .left)
case "dblclick":
    post(.leftMouseDown, button: .left, click: 2)
    post(.leftMouseUp, button: .left, click: 2)
case "rightclick":
    post(.rightMouseDown, button: .right)
    post(.rightMouseUp, button: .right)
case "middleclick":
    post(.otherMouseDown, button: .center)
    post(.otherMouseUp, button: .center)
default:
    FileHandle.standardError.write("unknown action\\n".data(using: .utf8)!)
    exit(64)
}
exit(0)
`;

const CUA_PS1 = `param([string]$Action, [int]$X = -1, [int]$Y = -1, [string]$Seq = "")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($Action -in @("move", "click", "dblclick", "rightclick", "middleclick")) {
  Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);' -Name Native -Namespace ZenCua
  if ($X -ge 0 -and $Y -ge 0) {
    [ZenCua.Native]::SetCursorPos($X, $Y) | Out-Null
  }
  if ($Action -ne "move") {
    $down = 2; $up = 4
    if ($Action -eq "rightclick") { $down = 8; $up = 16 }
    if ($Action -eq "middleclick") { $down = 32; $up = 64 }
    [ZenCua.Native]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    [ZenCua.Native]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    if ($Action -eq "dblclick") {
      [ZenCua.Native]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
      [ZenCua.Native]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
  exit 0
}
if ($Action -eq "type" -or $Action -eq "key") {
  [System.Windows.Forms.SendKeys]::SendWait($Seq)
  exit 0
}
exit 64
`;

const CUA_MOUSE_ACTIONS: Record<CuaMouseButton, string> = {
  left: "click",
  right: "rightclick",
  middle: "middleclick",
};

async function ensureCuaPs1(): Promise<string> {
  const script = ps1ScriptPath("zen-cua");
  await mkdir(join(script, ".."), { recursive: true });
  await writeFile(script, CUA_PS1, "utf8");
  return script;
}

export class CuaService implements CuaAgentBridge {
  async status(): Promise<AbilityProbe> {
    const tools = await checkTools(["swiftc", "powershell", "xdotool"]);
    const availability: ToolAvailability = { ...tools, swift: tools["swiftc"] === true };
    return resolveCuaBackend(process.platform, availability);
  }

  async screenSize(): Promise<CuaScreenSize> {
    try {
      const size = screen.getPrimaryDisplay().size;
      return { ok: true, width: size.width, height: size.height };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "无法读取屏幕尺寸" };
    }
  }

  async mouseMove(x: number, y: number): Promise<CuaActionResult> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: "坐标不合法" };
    }
    if (process.platform === "darwin") {
      const bin = await ensureSwiftTool("zen-cua", CUA_SWIFT_SOURCE);
      if (!bin) {
        return { ok: false, error: "Swift 鼠标工具编译失败" };
      }
      return run(bin, ["move", String(Math.round(x)), String(Math.round(y))]);
    }
    if (process.platform === "win32") {
      const script = await ensureCuaPs1();
      return run("powershell.exe", ps1MouseArgs(script, "move", x, y));
    }
    return run("xdotool", buildXdotoolMouseArgs("move", x, y));
  }

  async mouseClick(button?: CuaMouseButton, x?: number, y?: number): Promise<CuaActionResult> {
    const action = CUA_MOUSE_ACTIONS[button ?? "left"];
    if (process.platform === "darwin") {
      const bin = await ensureSwiftTool("zen-cua", CUA_SWIFT_SOURCE);
      if (!bin) {
        return { ok: false, error: "Swift 鼠标工具编译失败" };
      }
      const args =
        x != null && y != null
          ? [action, String(Math.round(x)), String(Math.round(y))]
          : [action];
      return run(bin, args);
    }
    if (process.platform === "win32") {
      const script = await ensureCuaPs1();
      // x/y 缺省用 -1 哨兵：ps1 内跳过 SetCursorPos，在当前位置点击
      return run(
        "powershell.exe",
        ps1MouseArgs(script, action, x ?? -1, y ?? -1),
      );
    }
    if (x != null && y != null) {
      return run("xdotool", buildXdotoolMouseArgs("click", x, y, button ?? "left"));
    }
    const buttonNumber = button === "right" ? 3 : button === "middle" ? 2 : 1;
    return run("xdotool", ["click", String(buttonNumber)]);
  }

  async keyboardType(text: string): Promise<CuaActionResult> {
    const input = text ?? "";
    if (!input) {
      return { ok: false, error: "没有可输入的文本" };
    }
    if (process.platform === "darwin") {
      return run("osascript", ["-e", buildAppleScriptTypeScript(input)]);
    }
    if (process.platform === "win32") {
      const script = await ensureCuaPs1();
      return run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Action",
        "type",
        "-Seq",
        escapeSendKeysText(input),
      ]);
    }
    return run("xdotool", buildXdotoolTypeArgs(input));
  }

  async keyboardKey(key: string): Promise<CuaActionResult> {
    if (process.platform === "darwin") {
      const built = buildAppleScriptKeyScript(key);
      if ("error" in built) {
        return { ok: false, error: built.error };
      }
      return run("osascript", ["-e", built.script]);
    }
    if (process.platform === "win32") {
      const built = buildSendKeysSequence(key);
      if ("error" in built) {
        return { ok: false, error: built.error };
      }
      const script = await ensureCuaPs1();
      return run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Action",
        "key",
        "-Seq",
        built.sequence,
      ]);
    }
    const built = buildXdotoolKeyArg(key);
    if ("error" in built) {
      return { ok: false, error: built.error };
    }
    return run("xdotool", ["key", built.arg]);
  }

  /** agent-core 桥接入口（runAgentRequest 注入；cuaEnabled 总开关控制） */
  bridge(): CuaAgentBridge {
    return this;
  }
}

function ps1MouseArgs(script: string, action: string, x: number, y: number): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-Action",
    action,
    "-X",
    String(Math.round(x)),
    "-Y",
    String(Math.round(y)),
  ];
}

async function run(command: string, args: string[]): Promise<CuaActionResult> {
  try {
    await execFileAsync(command, args, { timeout: 30_000 });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "桌面操作执行失败",
    };
  }
}

let singleton: CuaService | null = null;

export function getCuaService(): CuaService {
  if (!singleton) {
    singleton = new CuaService();
  }
  return singleton;
}

export function shutdownCuaService(): void {
  singleton = null;
}
