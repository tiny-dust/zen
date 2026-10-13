import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  CatalogMatch,
  CatalogModel,
  CatalogVendor,
  FetchModelsResult,
  ModelCapabilities,
  ModelRoutingCandidate,
  ModelRoutingDecision,
  ModelRoutingRuleId,
  PreviewModelsInput,
  ProviderInput,
  ProviderSummary,
  ReasoningEffort,
  UpdateModelInput,
} from "@zen/shared";

import { toPlain } from "@/lib/utils";
import type { ModelSelectionState } from "@/types/zen-api";
import { i18n } from "@/locales";

/** 自动路由开关的 localStorage 键（与主题首帧镜像同风格，跨会话保留） */
const AUTO_ROUTE_STORAGE_KEY = "zen.model.autoRoute";

/** 上次路由结果（models store 展示层用；不含打分细节） */
export interface LastModelRouting {
  providerId: string;
  modelId: string;
  /** 展示名（找不到模型时回落 id） */
  modelName: string;
  rules: ModelRoutingRuleId[];
}

export const useModelsStore = defineStore("models", () => {
  const providers = ref<ProviderSummary[]>([]);
  const selection = ref<ModelSelectionState>({ providerId: null, modelId: null });
  const loading = ref(false);
  const fetching = ref(false);
  const error = ref<string | null>(null);
  const activeProviderId = ref<string | null>(null);
  const catalogVendors = ref<CatalogVendor[]>([]);
  const catalogModels = ref<CatalogModel[]>([]);
  const refreshingCatalog = ref(false);
  const catalogUpdatedAt = ref(0);

  // ---------- 模型自动路由：开关（localStorage 持久化） + 上次路由结果 ----------
  const autoRoute = ref(false);
  const lastRouting = ref<LastModelRouting | null>(null);
  try {
    autoRoute.value = window.localStorage.getItem(AUTO_ROUTE_STORAGE_KEY) === "1";
  } catch {
    // localStorage 不可用（隐私模式等）：仅内存态
  }

  /** 路由候选：全部已启用模型（含能力），传给 shared 的 routeModel 纯函数 */
  const routingCandidates = computed<ModelRoutingCandidate[]>(() =>
    enabledModels.value.map(({ provider, model }) => ({
      providerId: provider.id,
      modelId: model.id,
      name: model.name,
      capabilities: model.capabilities,
    })),
  );

  /** 开/关自动路由；关闭时清掉上次理由（避免展示过期信息） */
  function setAutoRoute(enabled: boolean) {
    autoRoute.value = enabled;
    if (!enabled) {
      lastRouting.value = null;
    }
    try {
      window.localStorage.setItem(AUTO_ROUTE_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // 写失败不影响本会话内存态
    }
  }

  /** 记录一次路由结果（chat store 发送前调用），供 ModelPicker 展示模型 + 理由 */
  function noteRouting(decision: ModelRoutingDecision) {
    const found = findEnabledModel(decision.providerId, decision.modelId);
    lastRouting.value = {
      providerId: decision.providerId,
      modelId: decision.modelId,
      modelName: found?.model.name ?? decision.modelId,
      rules: [...decision.rules],
    };
  }


  const activeProvider = computed(
    () => providers.value.find((p) => p.id === activeProviderId.value) || null,
  );

  const enabledModels = computed(() =>
    providers.value.flatMap((provider) =>
      provider.models
        .filter((model) => model.enabled)
        .map((model) => ({ provider, model })),
    ),
  );

  /** 按 provider/model 查找已启用模型（会话级覆盖与能力读取共用） */
  function findEnabledModel(providerId: string | null, modelId: string | null) {
    if (!providerId || !modelId) {
      return null;
    }
    return (
      enabledModels.value.find(
        (item) => item.provider.id === providerId && item.model.id === modelId,
      ) ?? null
    );
  }

  const selectedLabel = computed(() => {
    const provider = selection.value.provider;
    const model = selection.value.model;
    if (!provider) {
      return i18n.global.t("app.models.noModelConfigured");
    }
    if (!model) {
      return provider.name;
    }
    return `${provider.name} / ${model.name}`;
  });

  const selectedModel = computed(() => selection.value.model ?? null);
  const selectedSupportsReasoning = computed(() =>
    Boolean(selection.value.model?.capabilities?.reasoning),
  );
  const selectedReasoningEfforts = computed<ReasoningEffort[]>(() => {
    const efforts = selection.value.model?.capabilities?.reasoningEfforts;
    if (efforts?.length) {
      return [...efforts];
    }
    if (selection.value.model?.capabilities?.reasoning) {
      return ["low", "medium", "high"];
    }
    return [];
  });

  function bootstrap(): () => void {
    void refresh();
    void loadCatalogVendors();
    return () => undefined;
  }

  async function refresh() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      providers.value = await zen.models.list();
      selection.value = await zen.models.selection();
      if (!activeProviderId.value && selection.value.providerId) {
        activeProviderId.value = selection.value.providerId;
      }
      if (activeProviderId.value && !providers.value.some((p) => p.id === activeProviderId.value)) {
        activeProviderId.value = providers.value[0]?.id ?? null;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("app.models.loadFailed");
    } finally {
      loading.value = false;
    }
  }

  function setActiveProvider(id: string | null) {
    activeProviderId.value = id;
  }

  /** 统一：读 zen → 清错误 → 成功刷新 → 失败写 error */
  async function runModelAction<T>(
    fallback: T,
    failMessage: string,
    action: (zen: NonNullable<typeof window.zen>) => Promise<T>,
  ): Promise<T> {
    const zen = window.zen;
    if (!zen) {
      return fallback;
    }
    error.value = null;
    try {
      return await action(zen);
    } catch (err) {
      error.value = err instanceof Error ? err.message : failMessage;
      return fallback;
    }
  }

  async function addProvider(input: ProviderInput) {
    const provider = await runModelAction(null, i18n.global.t("app.models.addProviderFailed"), async (zen) => {
      // 响应式对象（含嵌套 capabilities 数组）不能过 IPC 结构化克隆
      const created = await zen.models.addProvider(toPlain(input));
      await refresh();
      activeProviderId.value = created.id;
      return created;
    });
    return provider;
  }

  async function updateProvider(id: string, patch: Partial<ProviderInput>) {
    return runModelAction(null, i18n.global.t("app.models.updateProviderFailed"), async (zen) => {
      const provider = await zen.models.updateProvider(id, toPlain(patch));
      await refresh();
      return provider;
    });
  }

  async function removeProvider(id: string) {
    await runModelAction(undefined, i18n.global.t("app.models.removeProviderFailed"), async (zen) => {
      providers.value = await zen.models.removeProvider(id);
      selection.value = await zen.models.selection();
      if (activeProviderId.value === id) {
        activeProviderId.value = providers.value[0]?.id ?? null;
      }
      return undefined;
    });
  }

  async function addModel(input: {
    providerId: string;
    id: string;
    name?: string;
    enabled?: boolean;
    custom?: boolean;
    capabilities?: ModelCapabilities;
  }) {
    return runModelAction(null, i18n.global.t("app.models.addModelFailed"), async (zen) => {
      const provider = await zen.models.addModel(toPlain(input));
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    });
  }

  async function updateModel(input: UpdateModelInput) {
    return runModelAction(null, i18n.global.t("app.models.updateModelFailed"), async (zen) => {
      const provider = await zen.models.updateModel(toPlain(input));
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    });
  }

  async function setModelsEnabled(providerId: string, modelIds: string[], enabled: boolean) {
    return runModelAction(null, i18n.global.t("app.models.enableBatchFailed"), async (zen) => {
      const provider = await zen.models.setEnabled(
        toPlain({ providerId, modelIds, enabled }),
      );
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    });
  }

  async function removeModel(providerId: string, modelId: string) {
    await runModelAction(undefined, i18n.global.t("app.models.removeModelFailed"), async (zen) => {
      await zen.models.removeModel(providerId, modelId);
      selection.value = await zen.models.selection();
      await refresh();
      return undefined;
    });
  }

  async function select(providerId: string, modelId: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    selection.value = await zen.models.select(providerId, modelId);
  }

  async function previewModels(input: PreviewModelsInput): Promise<FetchModelsResult | null> {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    fetching.value = true;
    error.value = null;
    try {
      return await zen.models.previewModels(toPlain(input));
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("app.models.fetchFailed");
      return null;
    } finally {
      fetching.value = false;
    }
  }

  async function refreshFromProvider(providerId: string): Promise<FetchModelsResult | null> {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    fetching.value = true;
    error.value = null;
    try {
      return await zen.models.fetchFromProvider(providerId);
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("app.models.refreshFailed");
      return null;
    } finally {
      fetching.value = false;
    }
  }

  async function loadCatalogVendors() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    try {
      catalogVendors.value = await zen.models.catalogVendors();
    } catch {
      catalogVendors.value = [];
    }
  }

  async function loadCatalogModels(vendor?: string) {
    const zen = window.zen;
    if (!zen) {
      return [];
    }
    try {
      catalogModels.value = await zen.models.catalogList(vendor);
      return catalogModels.value;
    } catch {
      catalogModels.value = [];
      return [];
    }
  }

  async function matchCatalog(modelId: string): Promise<CatalogMatch | null> {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    return zen.models.catalogMatch(modelId);
  }

  async function loadCatalogUpdatedAt() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    try {
      catalogUpdatedAt.value = await zen.models.catalogUpdatedAt();
    } catch {
      catalogUpdatedAt.value = 0;
    }
  }

  /** 一键实时更新内置目录（models.dev）；成功后重载列表与更新时间 */
  async function refreshCatalog(): Promise<number | null> {
    const zen = window.zen;
    if (!zen || refreshingCatalog.value) {
      return null;
    }
    refreshingCatalog.value = true;
    try {
      const result = await zen.models.catalogRefresh();
      catalogUpdatedAt.value = result.updatedAt;
      await loadCatalogModels();
      return result.count;
    } finally {
      refreshingCatalog.value = false;
    }
  }

  return {
    providers,
    selection,
    loading,
    fetching,
    error,
    activeProviderId,
    catalogVendors,
    catalogModels,
    activeProvider,
    enabledModels,
    findEnabledModel,
    autoRoute,
    lastRouting,
    routingCandidates,
    setAutoRoute,
    noteRouting,
    selectedLabel,
    selectedModel,
    selectedSupportsReasoning,
    selectedReasoningEfforts,
    bootstrap,
    refresh,
    setActiveProvider,
    addProvider,
    updateProvider,
    removeProvider,
    addModel,
    updateModel,
    setModelsEnabled,
    removeModel,
    select,
    previewModels,
    refreshFromProvider,
    loadCatalogVendors,
    loadCatalogModels,
    loadCatalogUpdatedAt,
    refreshCatalog,
    refreshingCatalog,
    catalogUpdatedAt,
    matchCatalog,
  };
});
