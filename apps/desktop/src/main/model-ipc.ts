import { ipcMain } from "electron";

import { fetchModelsByCredentials, fetchModelsFromProvider, inspectRemoteModel } from "./model-api";
import { getDb } from "./model-db-connection";
import {
  getCatalogUpdatedAt,
  listCatalogModels,
  listCatalogVendors,
  matchCatalogModel,
  refreshCatalogFromRemote,
  seedCatalogIfEmpty,
} from "./model-catalog";
import {
  addModel,
  addProvider,
  getSelection,
  listProviders,
  loadProviderApiKey,
  loadProviderUserAgent,
  normalizeBaseUrl,
  removeModel,
  removeProvider,
  setModelsEnabled,
  setSelection,
  updateModel,
  updateProvider,
} from "./model-db";

import type {
  AddModelInput,
  PreviewModelsInput,
  ProviderInput,
  SetModelsEnabledInput,
  UpdateModelInput,
} from "@zen/shared";

export function registerModelIpc(): void {
  getDb();
  seedCatalogIfEmpty();

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

  ipcMain.handle("models:update-model", async (_event, input: UpdateModelInput) => {
    return updateModel(input);
  });

  ipcMain.handle("models:set-enabled", async (_event, input: SetModelsEnabledInput) => {
    return setModelsEnabled(input);
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

  ipcMain.handle("models:preview-models", async (_event, input: PreviewModelsInput) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      throw new Error("请填写 Base URL");
    }
    let apiKey = input.apiKey?.trim() ?? "";
    if (!apiKey && input.providerId) {
      apiKey = await loadProviderApiKey(input.providerId);
    }
    if (!apiKey) {
      throw new Error("请填写 API Key");
    }
    let userAgent = input.userAgent?.trim() || "";
    if (!userAgent && input.providerId) {
      userAgent = (await loadProviderUserAgent(input.providerId)) || "";
    }
    return fetchModelsByCredentials({
      protocol: input.protocol,
      baseUrl,
      apiKey,
      userAgent: userAgent || undefined,
    });
  });

  ipcMain.handle("models:inspect", async (_event, providerId: string, modelId: string) => {
    return inspectRemoteModel(providerId, modelId);
  });

  ipcMain.handle("models:catalog-vendors", async () => listCatalogVendors());

  ipcMain.handle("models:catalog-list", async (_event, vendor?: string) =>
    listCatalogModels(vendor),
  );

  ipcMain.handle("models:catalog-match", async (_event, modelId: string) =>
    matchCatalogModel(modelId),
  );

  ipcMain.handle("models:catalog-refresh", async () => refreshCatalogFromRemote());

  ipcMain.handle("models:catalog-updated-at", async () => getCatalogUpdatedAt());
}
