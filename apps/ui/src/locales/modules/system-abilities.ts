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
      transcribeFailed: "语音识别失败",
      emptyResult: "没有识别到内容",
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
      disabled: "桌面自动化未开启（可在 ~/.zen/config.json 设置 cuaEnabled）",
    },
  },
  "en-US": {
    voice: {
      start: "Voice input",
      startTitle: "Click to start voice input",
      stop: "Stop & transcribe",
      stopTitle: "Click to stop recording and transcribe to text",
      transcribing: "Transcribing…",
      transcribeFailed: "Voice recognition failed",
      emptyResult: "Nothing recognized",
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
      disabled: "Desktop automation is off (set cuaEnabled in ~/.zen/config.json)",
    },
  },
} satisfies LocaleModule;
