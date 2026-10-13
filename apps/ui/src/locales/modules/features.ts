import type { LocaleModule } from "../index";

/** 可选功能 + 会话导出文案：功能目录弹窗（features.*）与会话信息卡导出入口（features.export*） */
export default {
  "zh-CN": {
    entry: "功能目录",
    title: "功能目录",
    desc: "Zen 的可选能力清单，安装后即可在此点亮",
    refresh: "刷新",
    statusAvailable: "可用",
    statusNotInstalled: "未安装",
    statusUnsupportedPlatform: "平台不支持",
    notInstalledHint: "该能力尚未在本机安装，安装后会自动亮起",
    unsupportedPlatformHint: "当前操作系统不支持该能力",
    loadFailed: "目录加载失败：{error}",
    category: {
      input: "输入",
      multimodal: "多模态",
      automation: "自动化",
    },
    catalog: {
      voice: {
        name: "语音输入",
        desc: "对话输入框语音转文字，支持长按说话与实时转写",
      },
      ocr: {
        name: "屏幕文字识别",
        desc: "截图与屏幕区域文字识别（OCR），识别结果直接进入对话",
      },
      cua: {
        name: "电脑操作（CUA）",
        desc: "Agent 直接观察并操作屏幕上的应用（点击/输入/滚动）",
      },
    },
    exportHtml: "导出会话 HTML",
    exportHtmlTitle: "把当前会话导出为自包含 HTML 文件，可离线查看与分享",
    exporting: "导出中…",
    exportCanceled: "已取消导出",
    exportDone: "已导出：{path}",
    exportFailed: "导出失败：{error}",
  },
  "en-US": {
    entry: "Features",
    title: "Feature Catalog",
    desc: "Optional Zen capabilities; install one to light it up here",
    refresh: "Refresh",
    statusAvailable: "Available",
    statusNotInstalled: "Not installed",
    statusUnsupportedPlatform: "Unsupported platform",
    notInstalledHint: "This capability is not installed on this machine yet; it lights up automatically after installation",
    unsupportedPlatformHint: "This capability is not supported on your operating system",
    loadFailed: "Failed to load catalog: {error}",
    category: {
      input: "Input",
      multimodal: "Multimodal",
      automation: "Automation",
    },
    catalog: {
      voice: {
        name: "Voice input",
        desc: "Speech-to-text in the composer, with push-to-talk and live transcription",
      },
      ocr: {
        name: "Screen OCR",
        desc: "Recognize text from screenshots and screen regions; results go straight into the chat",
      },
      cua: {
        name: "Computer use (CUA)",
        desc: "The Agent observes and operates on-screen apps directly (click/type/scroll)",
      },
    },
    exportHtml: "Export session HTML",
    exportHtmlTitle: "Export the current session as a self-contained HTML file for offline viewing and sharing",
    exporting: "Exporting…",
    exportCanceled: "Export canceled",
    exportDone: "Exported to {path}",
    exportFailed: "Export failed: {error}",
  },
} satisfies LocaleModule;
