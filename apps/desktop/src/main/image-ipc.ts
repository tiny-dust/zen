import { ipcMain } from "electron";

import type { ImageGenerateInput } from "@zen/shared";
import { cancelImageGeneration, deleteImage, generateImage, listImages, readImageDataUrl } from "./image-library";

/** 生图与素材库 IPC：全部走主进程做校验与落盘，渲染层只传参数 */
export function registerImageIpc(): void {
  ipcMain.handle("images:generate", async (_event, input: ImageGenerateInput) => generateImage(input));
  ipcMain.handle("images:list", () => listImages());
  ipcMain.handle("images:read", (_event, id: string) => readImageDataUrl(id));
  ipcMain.handle("images:delete", (_event, id: string) => deleteImage(id));
  ipcMain.handle("images:cancel", () => cancelImageGeneration());
}
