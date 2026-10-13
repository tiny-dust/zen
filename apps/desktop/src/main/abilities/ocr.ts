import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AbilityProbe, OcrResult } from "@zen/shared";

import { resolveOcrBackend, type ToolAvailability } from "./commands";
import { checkTools, ps1ScriptPath } from "./tool-probe";
import { ensureSwiftTool } from "./swift-tools";

const execFileAsync = promisify(execFile);

/**
 * OCR：ocrImage(imagePath) → { text }。三平台：
 * - macOS：Swift 小工具（Vision VNRecognizeTextRequest），与语音共用 swift-tools 设施；
 * - Windows：powershell.exe -File 静态 ps1（Windows.Media.Ocr WinRT）；
 * - Linux：tesseract 命令（stdout 输出）。
 */

const OCR_SWIFT_SOURCE = `import AppKit
import Vision

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write("usage: zen-ocr <image>\\n".data(using: .utf8)!)
    exit(64)
}
let imageURL = URL(fileURLWithPath: args[1])

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\\n").data(using: .utf8)!)
    exit(1)
}

guard let image = NSImage(contentsOf: imageURL),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("cannot load image")
}

func recognize(languages: [String]?) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if let languages = languages {
        request.recognitionLanguages = languages
    }
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
}

// 优先中英混合；旧系统不支持 zh-Hans 时回退默认（en-US）
var text: String
do {
    text = try recognize(languages: ["zh-Hans", "en-US"])
} catch {
    text = try recognize(languages: nil)
}
print(text)
exit(0)
`;

// Windows OCR 脚本（导出供 scripts-static.test.ts 静态校验；运行时落盘为 zen-ocr.ps1）
export const OCR_PS1 = `param([string]$Image)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation\`1" })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

$path = [System.IO.Path]::GetFullPath($Image)
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
if ($bitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8) {
  $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap,
    [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8)
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  [Console]::Error.WriteLine("no ocr engine for user languages")
  exit 1
}
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Write-Output $result.Text
`;

export class OcrService {
  async probe(): Promise<AbilityProbe> {
    const tools = await checkTools(["swiftc", "powershell", "tesseract"]);
    const availability: ToolAvailability = { ...tools, swift: tools["swiftc"] === true };
    return resolveOcrBackend(process.platform, availability);
  }

  async recognize(imagePath: string): Promise<OcrResult> {
    const input = imagePath?.trim();
    if (!input) {
      return { ok: false, error: "未提供图片路径" };
    }
    const probe = await this.probe();
    if (!probe.supported) {
      return { ok: false, error: probe.reason ?? "当前系统不支持文字识别" };
    }
    try {
      if (process.platform === "darwin") {
        const bin = await ensureSwiftTool("zen-ocr", OCR_SWIFT_SOURCE);
        if (!bin) {
          return { ok: false, error: "Swift OCR 工具编译失败" };
        }
        const { stdout } = await execFileAsync(bin, [input], { timeout: 60_000 });
        return { ok: true, text: stdout.trim() };
      }
      if (process.platform === "win32") {
        const script = ps1ScriptPath("zen-ocr");
        await mkdir(join(script, ".."), { recursive: true });
        await writeFile(script, OCR_PS1, "utf8");
        const { stdout } = await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            "-Image",
            input,
          ],
          { timeout: 60_000 },
        );
        return { ok: true, text: stdout.trim() };
      }
      // Linux：tesseract 输出到 stdout（语言用默认，装了 chi_sim 可自行扩展）
      const { stdout } = await execFileAsync("tesseract", [input, "stdout"], {
        timeout: 60_000,
      });
      return { ok: true, text: stdout.trim() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "文字识别失败",
      };
    }
  }
}

let singleton: OcrService | null = null;

export function getOcrService(): OcrService {
  if (!singleton) {
    singleton = new OcrService();
  }
  return singleton;
}

export function shutdownOcrService(): void {
  singleton = null;
}
