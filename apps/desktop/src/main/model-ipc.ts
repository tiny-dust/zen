import { ipcMain } from "electron";

import { fetchModelsFromProvider, inspectRemoteModel } from "./model-api";
import {
  addModel,
  addProvider,
  getSelection,
  getDb,
  listProviders,
  removeModel,
  removeProvider,
  setSelection,
  updateProvider,
} from "./model-db";

import type { AddModelInput, ProviderInput } from "@zen/shared";

export function registerModelIpc(): void {
  // 确保 DB 在应用启动时初始化
  getDb();

  ipcMain.handle("models:list", async () => listProviders());

  ipcMain.handle("models:selection", async () => getSelection());

  ipcMain.handle("models:select", async (_event, providerId: string | null, modelId: string | null) => {
    return setSelection(providerId, modelId);
  });

  ipcMain.handle("models:add-provider", async (_event, input: ProviderInput) => {
    return addProvider(input);
  });

  ipcMain.handle("models:update-provider", async (_event, id: string, patch: Partial<ProviderInput>) => {
    return updateProvider(id, patch);
  });

  ipcMain.handle("models:remove-provider", async (_event, id: string) => {
    await removeProvider(id);
    return listProviders();
  });

  ipcMain.handle("models:add-model", async (_event, input: AddModelInput) => {
    return addModel(input);
  });

  ipcMain.handle("models:remove-model", async (_event, providerId: string, modelId: string) => {
    return removeModel(providerId, modelId);
  });

  ipcMain.handle("models:fetch-from-provider", async (_event, providerId: string) => {
    const providers = await listProviders();
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      throw new Error("供应商不存在");
    }
    return fetchModelsFromProvider(provider);
  });

  ipcMain.handle("models:inspect", async (_event, providerId: string, modelId: string) => {
    return inspectRemoteModel(providerId, modelId);
  });
}
