import { ipcMain } from "electron";

import { registerFeatureProbe } from "../feature-catalog";
import { getCuaService } from "./cua";
import { getOcrService } from "./ocr";
import { shutdownTtsService, getTtsService } from "./tts";
import { shutdownVoiceService, getVoiceService } from "./voice";

/**
 * 系统能力四件套 IPC：语音（ASR）/ TTS / OCR / CUA 的 probe 与操作入口。
 * - probe 结果由渲染层决定按钮显隐（平台不支持时隐藏，不崩）；
 * - CUA 的 agent 工具不在此注册（agent-runner 经 cuaBridge 注入，见 agent-core），
 *   这里只提供 status probe 供未来 UI 开关使用；
 * - 同步把四件套 probe 接线到功能目录（feature:list 据此亮灯）。
 */
export function registerSystemAbilitiesIpc(): void {
  const voice = getVoiceService();
  const tts = getTtsService();
  const ocr = getOcrService();
  const cua = getCuaService();

  registerFeatureProbe("voice", async () => (await voice.probe()).supported);
  registerFeatureProbe("tts", async () => (await tts.probe()).supported);
  registerFeatureProbe("ocr", async () => (await ocr.probe()).supported);
  registerFeatureProbe("cua", async () => (await cua.status()).supported);

  ipcMain.handle("voice:probe", () => voice.probe());
  ipcMain.handle("voice:start", () => voice.start());
  ipcMain.handle("voice:stop", () => voice.stop());

  ipcMain.handle("tts:probe", () => tts.probe());
  ipcMain.handle("tts:speak", (_event, text: string, options?: { voice?: string; rate?: number }) =>
    tts.speak(text, options),
  );
  ipcMain.handle("tts:stop", () => tts.stop());

  ipcMain.handle("ocr:probe", () => ocr.probe());
  ipcMain.handle("ocr:recognize", (_event, imagePath: string) => ocr.recognize(imagePath));

  ipcMain.handle("cua:probe", () => cua.status());
}

/** 应用退出：停掉遗留的录音/播报子进程 */
export function shutdownSystemAbilities(): void {
  shutdownVoiceService();
  shutdownTtsService();
}
