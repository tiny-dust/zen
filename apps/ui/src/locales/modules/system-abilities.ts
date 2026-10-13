import type { LocaleModule } from "../index";

/** 系统层能力四件套：语音输入（ASR）/ TTS 播报 / OCR / CUA */
export default {
  "zh-CN": {
    voice: {
      start: "语音输入",
      startTitle: "点击开始语音输入",
      stop: "结束并转写",
      stopTitle: "点击结束录音并转写为文字",
      transcribing: "转写中…",
      listening: "正在聆听…",
      transcribeFailed: "语音识别失败",
      emptyResult: "没有识别到内容",
      micDenied: "语音需要麦克风与语音识别授权。到系统设置 → 隐私与安全性中允许 Zen。",
      openSettings: "打开系统设置",
    },
    tts: {
      speak: "朗读",
      speakTitle: "朗读这条消息",
      stop: "停止朗读",
      stopTitle: "停止当前朗读",
      failed: "语音播报不可用",
    },
    ocr: {
      recognize: "识别文字",
      recognizeTitle: "识别图片中的文字并填入输入框",
      recognizing: "识别中…",
      emptyResult: "没有识别到文字",
      failed: "文字识别失败",
    },
    cua: {
      disabled: "桌面自动化未开启（在 设置 → 权限 → 桌面自动化 开启）",
    },
  },
  "en-US": {
    voice: {
      start: "Voice input",
      startTitle: "Click to start voice input",
      stop: "Stop & transcribe",
      stopTitle: "Click to stop recording and transcribe to text",
      transcribing: "Transcribing…",
      listening: "Listening…",
      transcribeFailed: "Voice recognition failed",
      emptyResult: "Nothing recognized",
      micDenied:
        "Voice input needs microphone and speech recognition permission. Allow Zen in System Settings → Privacy & Security.",
      openSettings: "Open System Settings",
    },
    tts: {
      speak: "Read aloud",
      speakTitle: "Read this message aloud",
      stop: "Stop reading",
      stopTitle: "Stop current speech",
      failed: "Text-to-speech unavailable",
    },
    ocr: {
      recognize: "Recognize text",
      recognizeTitle: "Recognize text in the image and insert into the input",
      recognizing: "Recognizing…",
      emptyResult: "No text recognized",
      failed: "Text recognition failed",
    },
    cua: {
      disabled: "Desktop automation is off (enable it in Settings → Permissions → Desktop Automation)",
    },
  },
} satisfies LocaleModule;
