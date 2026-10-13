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

// 参数：<output.wav> <result.txt> <pid.txt>
// 经 open(LaunchServices) 启动的 .app bundle：stdout/stderr 不回传主进程，
// 识别结果与错误一律写 result 文件（错误以 "ERROR:" 前缀），pid 写 pid 文件供停录信号。
let args = CommandLine.arguments
guard args.count == 4 else {
    exit(64)
}
let outputURL = URL(fileURLWithPath: args[1])
let resultPath = args[2]
let pidPath = args[3]

func fail(_ message: String) -> Never {
    try? ("ERROR:" + message).write(toFile: resultPath, atomically: true, encoding: .utf8)
    exit(1)
}

try? String(ProcessInfo.processInfo.processIdentifier).write(toFile: pidPath, atomically: true, encoding: .utf8)

// SIGINT → 停止等待/录音；handler 必须在授权等待前注册（授权弹窗期间被停才能优雅退出）
signal(SIGINT, SIG_IGN)
let stopped = DispatchSemaphore(value: 0)
let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: DispatchQueue.global())
var interrupted = false
sigintSource.setEventHandler {
    interrupted = true
    stopped.signal()
}
sigintSource.resume()

// 语音识别授权（同步等待；bundle Info.plist 带 NSSpeechRecognitionUsageDescription）
let authDone = DispatchSemaphore(value: 0)
SFSpeechRecognizer.requestAuthorization { _ in authDone.signal() }
_ = authDone.wait(timeout: .now() + 300)
if interrupted {
    fail("授权等待被中断")
}

guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
    fail("speech recognizer unavailable")
}

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

// 停录后本地识别，结果写 result 文件
let request = SFSpeechURLRecognitionRequest(url: outputURL)
request.shouldReportPartialResults = false
if #available(macOS 13.0, *) {
    request.addsPunctuation = true
}
let recognized = DispatchSemaphore(value: 0)
var bestText = ""
var recError: String?
recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        bestText = result.bestTranscription.formattedString
        if result.isFinal {
            recognized.signal()
        }
    } else {
        if let error = error {
            recError = String(describing: error)
        }
        recognized.signal()
    }
}
_ = recognized.wait(timeout: .now() + 30)
if let recError = recError {
    fail("recognition error: \\(recError)")
}
try? bestText.write(toFile: resultPath, atomically: true, encoding: .utf8)
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

/**
 * zen-voice 的嵌入式 Info.plist：macOS TCC 要求访问麦克风/语音识别前声明 usage
 * description，裸二进制缺失声明会被 __TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__ 直接
 * SIGABRT（无任何输出，只在 DiagnosticReports 留崩溃记录）。
 * CFBundleExecutable/CFBundlePackageType 必须齐全，否则 LaunchServices 找不到
 * 可执行文件（open 报 "its executable is missing"，codesign 会把 Info.plist
 * 误认成可执行文件）。
 */
const VOICE_SWIFT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.zen.voice</string>
  <key>CFBundleName</key><string>zen-voice</string>
  <key>CFBundleDisplayName</key><string>Zen Voice</string>
  <key>CFBundleExecutable</key><string>zen-voice</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Zen 需要使用麦克风进行语音输入识别</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Zen 需要语音识别权限将语音转为文字</string>
</dict>
</plist>
`;

/** 活跃录音会话（一次只允许一路） */
interface VoiceSession {
  kind: "swift" | "powershell" | "whisper";
  child: ChildProcess;
  /** swift/whisper：wav 路径；powershell：识别结果 txt 路径 */
  capturePath: string;
  /** whisper 转写输出目录（Linux） */
  whisperDir?: string;
  /** macOS open 模式：识别结果文件 / zen-voice 进程 pid 文件 */
  resultPath?: string;
  pidPath?: string;
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
        const bin = await ensureSwiftTool("zen-voice", VOICE_SWIFT_SOURCE, VOICE_SWIFT_PLIST);
        if (!bin) {
          return { ok: false, error: "Swift 语音工具编译失败" };
        }
        // TCC 按「责任进程」查 Info.plist：直接 spawn bundle 可执行会归责到本进程
        // （dev 下 Electron 被 node 托管，责任链上的 app 无语音声明 → SIGABRT）。
        // 经 open(LaunchServices) 启动则责任链干净，bundle 自身的 plist 生效。
        const bundlePath = bin.slice(0, bin.indexOf("/Contents/MacOS/"));
        if (!bundlePath.endsWith(".app")) {
          return { ok: false, error: "语音工具 bundle 路径异常" };
        }
        const capturePath = join(dir, `${id}.wav`);
        const resultPath = join(dir, `${id}.txt`);
        const pidPath = join(dir, `${id}.pid`);
        const child = spawn(
          "open",
          ["-n", "-W", bundlePath, "--args", capturePath, resultPath, pidPath],
          { stdio: ["ignore", "ignore", "ignore"] },
        );
        this.session = this.track(child, "swift", capturePath);
        this.session.resultPath = resultPath;
        this.session.pidPath = pidPath;
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

  /**
   * macOS：open 启动的 zen-voice app —— 读 pid 文件 → SIGINT 停录转写 →
   * 等 open(-W) 进程退出 → 读 result 文件（ERROR: 前缀 = 失败）。
   */
  private async stopSwift(session: VoiceSession): Promise<VoiceTranscribeResult> {
    if (!session.resultPath || !session.pidPath) {
      return { ok: false, error: "录音会话状态异常" };
    }
    try {
      const pid = Number.parseInt((await readFile(session.pidPath, "utf8")).trim(), 10);
      if (Number.isInteger(pid)) {
        process.kill(pid, "SIGINT");
      }
    } catch {
      // pid 文件缺失/进程已退出：继续等 open 退出并读结果
    }
    await waitExit(session.child, 45_000);
    try {
      const text = (await readFile(session.resultPath, "utf8")).trim();
      if (text.startsWith("ERROR:")) {
        return { ok: false, error: text.slice("ERROR:".length).trim() || "语音识别失败" };
      }
      return { ok: true, text };
    } catch {
      return { ok: false, error: "语音识别失败" };
    }
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
