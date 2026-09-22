import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  CatalogMatch,
  CatalogModel,
  CatalogVendor,
  FetchModelsResult,
  ModelCapabilities,
  PreviewModelsInput,
  ProviderInput,
  ProviderSummary,
  ReasoningEffort,
  UpdateModelInput,
} from "@zen/shared";

import { toPlain } from "@/lib/utils";
import type { ModelSelectionState } from "@/types/zen-api";

export const useModelsStore = defineStore("models", () => {
  const providers = ref<ProviderSummary[]>([]);
  const selection = ref<ModelSelectionState>({ providerId: null, modelId: null });
  const loading = ref(false);
  const fetching = ref(false);
  const error = ref<string | null>(null);
  const activeProviderId = ref<string | null>(null);
  const catalogVendors = ref<CatalogVendor[]>([]);
  const catalogModels = ref<CatalogModel[]>([]);

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

  const selectedLabel = computed(() => {
    const provider = selection.value.provider;
    const model = selection.value.model;
    if (!provider) {
      return "未配置模型";
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
      error.value = err instanceof Error ? err.message : "加载模型配置失败";
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
    const provider = await runModelAction(null, "添加供应商失败", async (zen) => {
      // 响应式对象（含嵌套 capabilities 数组）不能过 IPC 结构化克隆
      const created = await zen.models.addProvider(toPlain(input));
      await refresh();
      activeProviderId.value = created.id;
      return created;
    });
    return provider;
  }

  async function updateProvider(id: string, patch: Partial<ProviderInput>) {
    return runModelAction(null, "更新供应商失败", async (zen) => {
      const provider = await zen.models.updateProvider(id, toPlain(patch));
      await refresh();
      return provider;
    });
  }

  async function removeProvider(id: string) {
    await runModelAction(undefined, "删除供应商失败", async (zen) => {
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
    return runModelAction(null, "添加模型失败", async (zen) => {
      const provider = await zen.models.addModel(toPlain(input));
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    });
  }

  async function updateModel(input: UpdateModelInput) {
    return runModelAction(null, "更新模型失败", async (zen) => {
      const provider = await zen.models.updateModel(toPlain(input));
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    });
  }

  async function setModelsEnabled(providerId: string, modelIds: string[], enabled: boolean) {
    return runModelAction(null, "批量启用失败", async (zen) => {
      const provider = await zen.models.setEnabled(
        toPlain({ providerId, modelIds, enabled }),
      );
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    });
  }

  async function removeModel(providerId: string, modelId: string) {
    await runModelAction(undefined, "删除模型失败", async (zen) => {
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
      error.value = err instanceof Error ? err.message : "拉取模型列表失败";
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
      error.value = err instanceof Error ? err.message : "刷新模型列表失败";
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
    matchCatalog,
  };
});
