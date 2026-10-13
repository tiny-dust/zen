import { ipcRenderer } from "electron";

import type {
  AbilityProbe,
  OcrResult,
  TtsSpeakOptions,
  VoiceStartResult,
  VoiceTranscribeResult,
} from "@zen/shared";

/** 系统能力四件套：语音输入 / TTS 播报 / OCR / CUA probe（不支持时 UI 隐藏入口） */
export const systemAbilitiesApi = {
  voice: {
    probe(): Promise<AbilityProbe> {
      return ipcRenderer.invoke("voice:probe");
    },
    start(): Promise<VoiceStartResult> {
      return ipcRenderer.invoke("voice:start");
    },
    stop(): Promise<VoiceTranscribeResult> {
      return ipcRenderer.invoke("voice:stop");
    },
  },
  tts: {
    probe(): Promise<AbilityProbe> {
      return ipcRenderer.invoke("tts:probe");
    },
    speak(text: string, options?: TtsSpeakOptions): Promise<{ ok: boolean; error?: string }> {
      // 参数必须纯对象：此处只透传可克隆的简单值
      return ipcRenderer.invoke("tts:speak", text, options ? { ...options } : undefined);
    },
    stop(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("tts:stop");
    },
  },
  ocr: {
    probe(): Promise<AbilityProbe> {
      return ipcRenderer.invoke("ocr:probe");
    },
    recognize(imagePath: string): Promise<OcrResult> {
      return ipcRenderer.invoke("ocr:recognize", imagePath);
    },
  },
  cua: {
    probe(): Promise<AbilityProbe> {
      return ipcRenderer.invoke("cua:probe");
    },
  },
};
