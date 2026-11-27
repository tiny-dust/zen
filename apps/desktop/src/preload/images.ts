import { ipcRenderer } from "electron";

import type { GeneratedImageRecord, ImageGenerateInput, ImageGenerateResult } from "@zen/shared";

export const imagesApi = {
  images: {
    generate(input: ImageGenerateInput): Promise<ImageGenerateResult> {
      return ipcRenderer.invoke("images:generate", input);
    },
    list(): Promise<GeneratedImageRecord[]> {
      return ipcRenderer.invoke("images:list");
    },
    /** 预览用 data URL（主进程校验 id 与格式） */
    read(id: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
      return ipcRenderer.invoke("images:read", id);
    },
    remove(id: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("images:delete", id);
    },
    cancel(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("images:cancel");
    },
  },
};
