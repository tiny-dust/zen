import { ipcRenderer } from "electron";

import type {
  AddModelInput,
  CatalogMatch,
  CatalogModel,
  CatalogRefreshResult,
  CatalogVendor,
  ChatGptAuthStatus,
  FetchModelsResult,
  ModelCapabilities,
  ModelSelection,
  PreviewModelsInput,
  ProviderInput,
  ProviderModel,
  ProviderSummary,
  ProviderUsageSnapshot,
  SetModelsEnabledInput,
  UpdateModelInput,
} from "@zen/shared";

export const modelsApi = {
  models: {
    list(): Promise<ProviderSummary[]> {
      return ipcRenderer.invoke("models:list");
    },
    selection(): Promise<ModelSelection & { provider?: ProviderSummary; model?: ProviderModel }> {
      return ipcRenderer.invoke("models:selection");
    },
    select(
      providerId: string | null,
      modelId: string | null,
    ): Promise<ModelSelection & { provider?: ProviderSummary; model?: ProviderModel }> {
      return ipcRenderer.invoke("models:select", providerId, modelId);
    },
    addProvider(input: ProviderInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:add-provider", input);
    },
    updateProvider(id: string, patch: Partial<ProviderInput>): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:update-provider", id, patch);
    },
    removeProvider(id: string): Promise<ProviderSummary[]> {
      return ipcRenderer.invoke("models:remove-provider", id);
    },
    addModel(input: AddModelInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:add-model", input);
    },
    updateModel(input: UpdateModelInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:update-model", input);
    },
    setEnabled(input: SetModelsEnabledInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:set-enabled", input);
    },
    removeModel(providerId: string, modelId: string): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:remove-model", providerId, modelId);
    },
    fetchFromProvider(providerId: string): Promise<FetchModelsResult> {
      return ipcRenderer.invoke("models:fetch-from-provider", providerId);
    },
    previewModels(input: PreviewModelsInput): Promise<FetchModelsResult> {
      return ipcRenderer.invoke("models:preview-models", input);
    },
    inspect(providerId: string, modelId: string): Promise<ModelCapabilities> {
      return ipcRenderer.invoke("models:inspect", providerId, modelId);
    },
    catalogVendors(): Promise<CatalogVendor[]> {
      return ipcRenderer.invoke("models:catalog-vendors");
    },
    catalogList(vendor?: string): Promise<CatalogModel[]> {
      return ipcRenderer.invoke("models:catalog-list", vendor);
    },
    catalogMatch(modelId: string): Promise<CatalogMatch> {
      return ipcRenderer.invoke("models:catalog-match", modelId);
    },
    catalogRefresh(): Promise<CatalogRefreshResult> {
      return ipcRenderer.invoke("models:catalog-refresh");
    },
    catalogUpdatedAt(): Promise<number> {
      return ipcRenderer.invoke("models:catalog-updated-at");
    },
    /** ChatGPT 账号 OAuth 登录（无 providerId 时自动创建 ChatGPT 供应商） */
    chatgptLogin(providerId?: string): Promise<{
      status: ChatGptAuthStatus;
      provider: ProviderSummary | null;
    }> {
      return ipcRenderer.invoke("models:chatgpt-login", providerId);
    },
    chatgptStatus(providerId: string): Promise<ChatGptAuthStatus> {
      return ipcRenderer.invoke("models:chatgpt-status", providerId);
    },
    chatgptLogout(providerId: string): Promise<ChatGptAuthStatus> {
      return ipcRenderer.invoke("models:chatgpt-logout", providerId);
    },
    getUsage(providerId: string): Promise<ProviderUsageSnapshot> {
      return ipcRenderer.invoke("models:usage", providerId);
    },
  },
};
