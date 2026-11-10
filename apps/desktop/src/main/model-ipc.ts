import { ipcMain } from "electron";

import {
  CODEX_API_BASE_URL,
  chatgptLogin,
  chatgptLogout,
  codexLoginComplete,
  codexLoginStart,
  getChatGptAuthStatus,
  resolveChatGptCredentials,
} from "./chatgpt-auth";
import { fetchModelsByCredentials, fetchModelsFromProvider, inspectRemoteModel } from "./model-api";
import { getDb } from "./model-db-connection";
import { chatGptUsageAccountKey, getProviderUsage } from "./model-usage";
import { ensureChatGptProvider, syncChatGptModels } from "./model-db";
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
    const result = await fetchModelsFromProvider(provider);
    if (provider.authMode === "chatgpt-oauth") await syncChatGptModels(provider.id, result);
    return result;
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

  // ---------- ChatGPT 账号登录 ----------

  /** 登录：无 providerId 时创建 Codex 供应商；模型由当前账号目录提供。 */
  ipcMain.handle("models:chatgpt-login", async (_event, providerId?: string) => {
    const target = (await ensureChatGptProvider(providerId)).id;
    const status = await chatgptLogin(target);
    const providers = await listProviders();
    return { status, provider: providers.find((item) => item.id === target) ?? null };
  });

  // Codex CLI 客户端授权：个人账号即可，回调地址由用户粘贴回来
  ipcMain.handle("models:codex-login-start", async (_event, providerId?: string) => {
    const target = (await ensureChatGptProvider(providerId)).id;
    return codexLoginStart(target);
  });

  ipcMain.handle(
    "models:codex-login-complete",
    async (_event, providerId: string, callbackInput: string) => {
      const status = await codexLoginComplete(providerId, callbackInput);
      // Codex 账号走 ChatGPT 后端，把供应商基础地址同步过去（界面展示与实际请求一致）
      await updateProvider(providerId, { baseUrl: CODEX_API_BASE_URL });
      const providers = await listProviders();
      return { status, provider: providers.find((item) => item.id === providerId) ?? null };
    },
  );

  ipcMain.handle("models:chatgpt-status", async (_event, providerId: string) => {
    return getChatGptAuthStatus(providerId);
  });

  /**
   * 界面的「刷新」：临近/已过期时续期一次，随后回读状态。
   * 续期失败不抛到渲染层，而是随最新状态一起返回原因：
   * refresh token 已失效时状态会变成未登录，界面据此引导重新授权。
   */
  ipcMain.handle("models:chatgpt-refresh", async (_event, providerId: string) => {
    const before = await getChatGptAuthStatus(providerId);
    if (!before.loggedIn) return { status: before };
    try {
      await resolveChatGptCredentials(providerId);
    } catch (error) {
      const status = await getChatGptAuthStatus(providerId);
      return {
        status,
        error: error instanceof Error ? error.message : "ChatGPT 登录状态刷新失败",
      };
    }
    return { status: await getChatGptAuthStatus(providerId) };
  });

  ipcMain.handle("models:usage", async (_event, providerId: string) => {
    const provider = (await listProviders()).find((item) => item.id === providerId);
    if (!provider) {
      throw new Error("供应商不存在");
    }
    if (provider.authMode === "chatgpt-oauth") {
      const status = await getChatGptAuthStatus(providerId);
      const accountKey = chatGptUsageAccountKey(status.accountId, status.email);
      // 无可识别账号时返回空快照，不把其他账号或旧版未归属数据混入当前账号。
      return getProviderUsage(providerId, Date.now(), accountKey ?? "__unknown_account__");
    }
    return getProviderUsage(providerId);
  });

  ipcMain.handle("models:chatgpt-logout", async (_event, providerId: string) => {
    await chatgptLogout(providerId);
    return getChatGptAuthStatus(providerId);
  });
}
