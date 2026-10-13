import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  AbilityProbe,
  VoiceStartResult,
  VoiceTranscribeResult,
} from "@zen/shared";

import {
  buildArecordCommand,
  buildWhisperCommand,
  resolveVoiceBackend,
  whisperTextPath,
  type ToolAvailability,
} from "./commands";
import { checkTools, ps1ScriptPath } from "./tool-probe";
import { defaultSwiftCacheRoot, ensureSwiftTool } from "./swift-tools";

const execFileAsync = promisify(execFile);

/**
 * 语音输入（ASR）：start 开录、stop 停录并转写。三平台：
 * - macOS：Swift 小工具（AVAudioRecorder 录音 + SFSpeechRecognizer 本地识别），
 *   SIGINT 停录后同进程转写，结果打印到 stdout；swiftc 不可用时降级为不可用。
 * - Windows：Windows PowerShell + System.Speech SpeechRecognitionEngine 循环识别，
 *   增量结果写入文本文件；stop 杀进程后读文件。
 * - Linux：arecord 录 wav + whisper CLI 转写；两者缺一即不可用。
 * 所有外部命令均为 execFile/spawn 数组参数，无 shell 拼接。
 */

const VOICE_SWIFT_SOURCE = `import AVFoundation
import Speech

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write("usage: zen-voice <output.wav>\\n".data(using: .utf8)!)
    exit(64)
}
let outputURL = URL(fileURLWithPath: args[1])

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\\n").data(using: .utf8)!)
    exit(1)
}

// 语音识别授权（同步等待）
let authDone = DispatchSemaphore(value: 0)
SFSpeechRecognizer.requestAuthorization { _ in authDone.signal() }
authDone.wait()

guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
    fail("speech recognizer unavailable")
}

// SIGINT → 停止录音并转写；signal source 放全局队列（主线程即将阻塞等待）
signal(SIGINT, SIG_IGN)
let stopped = DispatchSemaphore(value: 0)
let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: DispatchQueue.global())
sigintSource.setEventHandler { stopped.signal() }
sigintSource.resume()

let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVSampleRateKey: 16000.0,
    AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false,
]
let recorder: AVAudioRecorder
do {
    recorder = try AVAudioRecorder(url: outputURL, settings: settings)
} catch {
    fail("recorder init failed: \\(error)")
}
guard recorder.record() else {
    fail("record failed (microphone permission denied?)")
}

_ = stopped.wait(timeout: .now() + 300)
recorder.stop()
sigintSource.cancel()

// 停录后本地识别，结果打到 stdout（main 进程读取）
let request = SFSpeechURLRecognitionRequest(url: outputURL)
request.shouldReportPartialResults = false
if #available(macOS 13.0, *) {
    request.addsPunctuation = true
}
let recognized = DispatchSemaphore(value: 0)
var bestText = ""
recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        bestText = result.bestTranscription.formattedString
        if result.isFinal {
            recognized.signal()
        }
    } else {
        if let error = error {
            FileHandle.standardError.write("recognition error: \\(error)\\n".data(using: .utf8)!)
        }
        recognized.signal()
    }
}
_ = recognized.wait(timeout: .now() + 60)
print(bestText)
exit(0)
`;

// Windows 语音识别脚本（导出供 scripts-static.test.ts 静态校验；运行时落盘为 zen-voice-rec.ps1）
export const VOICE_PS1 = `param([string]$Out)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
try {
  $rec.SetInputToDefaultAudioDevice()
  while ($true) {
    $res = $rec.Recognize([TimeSpan]::FromSeconds(1))
    if ($null -ne $res -and $res.Text) {
      [System.IO.File]::AppendAllText($Out, $res.Text + " ")
    }
  }
} catch {
  exit 1
}
`;

/** 活跃录音会话（一次只允许一路） */
interface VoiceSession {
  kind: "swift" | "powershell" | "whisper";
  child: ChildProcess;
  /** swift/whisper：wav 路径；powershell：识别结果 txt 路径 */
  capturePath: string;
  /** whisper 转写输出目录（Linux） */
  whisperDir?: string;
  stdout: string;
  stderr: string;
}

function voiceCacheDir(): string {
  return join(defaultSwiftCacheRoot(), "voice");
}

async function ensurePs1Script(): Promise<string> {
  const script = ps1ScriptPath("zen-voice-rec");
  await mkdir(join(script, ".."), { recursive: true });
  await writeFile(script, VOICE_PS1, "utf8");
  return script;
}

export class VoiceService {
  private session: VoiceSession | null = null;

  async probe(): Promise<AbilityProbe> {
    const tools = await checkTools(["swiftc", "powershell", "arecord", "whisper"]);
    // swiftc 即「Swift 工具可编译」标志（真编产物在 start 时 ensure）
    const availability: ToolAvailability = { ...tools, swift: tools["swiftc"] === true };
    return resolveVoiceBackend(process.platform, availability);
  }

  async start(): Promise<VoiceStartResult> {
    if (this.session) {
      return { ok: false, error: "已有进行中的录音" };
    }
    const probe = await this.probe();
    if (!probe.supported) {
      return { ok: false, error: probe.reason ?? "当前系统不支持语音输入" };
    }
    const id = randomUUID();
    const dir = voiceCacheDir();
    await mkdir(dir, { recursive: true });
    try {
      if (process.platform === "darwin") {
        const bin = await ensureSwiftTool("zen-voice", VOICE_SWIFT_SOURCE);
        if (!bin) {
          return { ok: false, error: "Swift 语音工具编译失败" };
        }
        const capturePath = join(dir, `${id}.wav`);
        const child = spawn(bin, [capturePath], { stdio: ["ignore", "pipe", "pipe"] });
        this.session = this.track(child, "swift", capturePath);
        return { ok: true };
      }
      if (process.platform === "win32") {
        const script = await ensurePs1Script();
        const capturePath = join(dir, `${id}.txt`);
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            "-Out",
            capturePath,
          ],
          { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
        );
        this.session = this.track(child, "powershell", capturePath);
        return { ok: true };
      }
      // Linux：arecord 录音，stop 后 whisper 转写
      const capturePath = join(dir, `${id}.wav`);
      const arecord = buildArecordCommand(capturePath);
      const child = spawn(arecord.command, arecord.args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      const whisperDir = join(dir, `${id}-out`);
      this.session = this.track(child, "whisper", capturePath, whisperDir);
      return { ok: true };
    } catch (error) {
      this.session = null;
      return { ok: false, error: error instanceof Error ? error.message : "启动录音失败" };
    }
  }

  async stop(): Promise<VoiceTranscribeResult> {
    const session = this.session;
    if (!session) {
      return { ok: false, error: "没有进行中的录音" };
    }
    this.session = null;
    try {
      if (session.kind === "swift") {
        return await this.stopSwift(session);
      }
      if (session.kind === "powershell") {
        return await this.stopPowerShell(session);
      }
      return await this.stopWhisper(session);
    } finally {
      // 清理临时文件（识别结果已读出；失败不阻塞）
      const cleanup = session.whisperDir ?? session.capturePath;
      await rm(cleanup, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** 应用退出兜底：杀掉遗留录音进程 */
  shutdown(): void {
    this.session?.child.kill();
    this.session = null;
  }

  private track(
    child: ChildProcess,
    kind: VoiceSession["kind"],
    capturePath: string,
    whisperDir?: string,
  ): VoiceSession {
    const session: VoiceSession = {
      kind,
      child,
      capturePath,
      whisperDir,
      stdout: "",
      stderr: "",
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      session.stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      session.stderr += chunk.toString("utf8");
    });
    // 录音进程意外退出（如麦克风权限被拒）：仅记录，等 stop 读取时报告
    child.on("error", (error) => {
      session.stderr += String(error);
    });
    return session;
  }

  /** macOS：SIGINT 停录 → 同进程完成转写 → stdout 即识别文本 */
  private async stopSwift(session: VoiceSession): Promise<VoiceTranscribeResult> {
    session.child.kill("SIGINT");
    const exit = await waitExit(session.child, 90_000);
    const text = session.stdout.trim();
    if (!exit.ok) {
      return { ok: false, error: session.stderr.trim() || "语音识别失败" };
    }
    return { ok: true, text };
  }

  /** Windows：杀 PowerShell 进程 → 读增量识别结果文件 */
  private async stopPowerShell(session: VoiceSession): Promise<VoiceTranscribeResult> {
    session.child.kill();
    await waitExit(session.child, 5_000);
    try {
      const text = (await readFile(session.capturePath, "utf8")).trim();
      return { ok: true, text };
    } catch {
      return { ok: false, error: session.stderr.trim() || "未识别到语音内容" };
    }
  }

  /** Linux：SIGINT 停 arecord（落盘 wav）→ whisper 转写 → 读 txt */
  private async stopWhisper(session: VoiceSession): Promise<VoiceTranscribeResult> {
    session.child.kill("SIGINT");
    await waitExit(session.child, 5_000);
    if (!session.whisperDir) {
      return { ok: false, error: "录音会话状态异常" };
    }
    await mkdir(session.whisperDir, { recursive: true });
    const whisper = buildWhisperCommand(session.capturePath, session.whisperDir);
    await execFileAsync(whisper.command, whisper.args, { timeout: 300_000 });
    const text = (
      await readFile(whisperTextPath(session.capturePath, session.whisperDir), "utf8")
    ).trim();
    return { ok: true, text };
  }
}

/** 等子进程退出；超时强杀并按失败处理 */
function waitExit(child: ChildProcess, timeoutMs: number): Promise<{ ok: boolean; code: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, code: -1 });
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? -1 });
    });
  });
}

let singleton: VoiceService | null = null;

export function getVoiceService(): VoiceService {
  if (!singleton) {
    singleton = new VoiceService();
  }
  return singleton;
}

export function shutdownVoiceService(): void {
  singleton?.shutdown();
  singleton = null;
}
