import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AbilityProbe, TtsSpeakOptions } from "@zen/shared";

import {
  buildTtsCommand,
  buildTtsPowerShellArgs,
  resolveTtsBackend,
  type ToolAvailability,
} from "./commands";
import { checkTools, ps1ScriptPath } from "./tool-probe";

/**
 * TTS 播报：speak(text, opts) 异步开播（进程存活期间可 stop 打断）、stop() 停止。三平台：
 * - macOS：say（-v 语音 -r 语速）；
 * - Windows：powershell.exe -File 静态 ps1（System.Speech SAPI）+ -Text/-Rate/-Voice 参数；
 * - Linux：spd-say / espeak / festival 依次回退，全都没有则不可用。
 * 全部 execFile/spawn 数组参数；festival 从 stdin 喂文本。
 */

// Windows TTS 脚本（导出供 scripts-static.test.ts 静态校验；运行时落盘为 zen-tts.ps1）
export const TTS_PS1 = `param([string]$Text, [int]$Rate = 0, [string]$Voice = "")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) {
  try { $synth.SelectVoice($Voice) } catch { }
}
$synth.Rate = $Rate
$synth.Speak($Text)
`;

export class TtsService {
  private current: ChildProcess | null = null;

  async probe(): Promise<AbilityProbe> {
    const tools = await checkTools(["say", "powershell", "spd-say", "espeak", "festival"]);
    return resolveTtsBackend(process.platform, tools as ToolAvailability);
  }

  async speak(text: string, options?: TtsSpeakOptions): Promise<{ ok: boolean; error?: string }> {
    const trimmed = text?.trim();
    if (!trimmed) {
      return { ok: false, error: "没有可朗读的文本" };
    }
    this.stop();
    const probe = await this.probe();
    if (!probe.supported) {
      return { ok: false, error: probe.reason ?? "当前系统不支持语音播报" };
    }
    try {
      if (process.platform === "win32") {
        // Windows：静态 ps1 + 参数（SAPI Rate 恰为 -10~10）
        const script = ps1ScriptPath("zen-tts");
        await mkdir(join(script, ".."), { recursive: true });
        await writeFile(script, TTS_PS1, "utf8");
        const child = spawn("powershell.exe", buildTtsPowerShellArgs(script, trimmed, options), {
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: true,
        });
        this.track(child);
        return { ok: true };
      }
      const spec = buildTtsCommand(probe.backend ?? "espeak", trimmed, options);
      // festival 从 stdin 喂文本：仅这类命令开 pipe，避免持有无用的管道句柄
      const needsStdin = spec.stdin != null;
      const child = spawn(spec.command, spec.args, {
        stdio: needsStdin ? ["pipe", "ignore", "ignore"] : ["ignore", "ignore", "ignore"],
      });
      if (needsStdin && child.stdin) {
        child.stdin.write(spec.stdin ?? "");
        child.stdin.end();
      }
      this.track(child);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "语音播报启动失败" };
    }
  }

  stop(): { ok: boolean } {
    this.current?.kill();
    this.current = null;
    return { ok: true };
  }

  private track(child: ChildProcess): void {
    this.current = child;
    child.once("exit", () => {
      if (this.current === child) {
        this.current = null;
      }
    });
    child.once("error", () => {
      if (this.current === child) {
        this.current = null;
      }
    });
  }
}

let singleton: TtsService | null = null;

export function getTtsService(): TtsService {
  if (!singleton) {
    singleton = new TtsService();
  }
  return singleton;
}

export function shutdownTtsService(): void {
  singleton?.stop();
  singleton = null;
}
