import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  FetchModelsResult,
  ProviderInput,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

import type { ModelSelectionState } from "@/types/zen-api";

export const useModelsStore = defineStore("models", () => {
  const providers = ref<ProviderSummary[]>([]);
  const selection = ref<ModelSelectionState>({ providerId: null, modelId: null });
  const loading = ref(false);
  const fetching = ref(false);
  const error = ref<string | null>(null);
  const activeProviderId = ref<string | null>(null);

  const activeProvider = computed(
    () => providers.value.find((p) => p.id === activeProviderId.value) || null,
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

  function bootstrap(): () => void {
    void refresh();
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

  async function addProvider(input: ProviderInput) {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    error.value = null;
    try {
      const provider = await zen.models.addProvider(input);
      await refresh();
      activeProviderId.value = provider.id;
      return provider;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "添加供应商失败";
      return null;
    }
  }

  async function updateProvider(id: string, patch: Partial<ProviderInput>) {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    error.value = null;
    try {
      const provider = await zen.models.updateProvider(id, patch);
      await refresh();
      return provider;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "更新供应商失败";
      return null;
    }
  }

  async function removeProvider(id: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    error.value = null;
    try {
      providers.value = await zen.models.removeProvider(id);
      selection.value = await zen.models.selection();
      if (activeProviderId.value === id) {
        activeProviderId.value = providers.value[0]?.id ?? null;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "删除供应商失败";
    }
  }

  async function addModel(providerId: string, modelId: string, name?: string) {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    error.value = null;
    try {
      const provider = await zen.models.addModel({ providerId, id: modelId, name });
      selection.value = await zen.models.selection();
      await refresh();
      return provider;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "添加模型失败";
      return null;
    }
  }

  async function removeModel(providerId: string, modelId: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    error.value = null;
    try {
      await zen.models.removeModel(providerId, modelId);
      selection.value = await zen.models.selection();
      await refresh();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "删除模型失败";
    }
  }

  async function select(providerId: string, modelId: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    selection.value = await zen.models.select(providerId, modelId);
  }

  async function fetchModels(providerId: string): Promise<FetchModelsResult | null> {
    const zen = window.zen;
    if (!zen) {
      return null;
    }
    fetching.value = true;
    error.value = null;
    try {
      const result = await zen.models.fetchFromProvider(providerId);
      // 批量写入（去重）
      for (const model of result.models) {
        await zen.models.addModel({
          providerId,
          id: model.id,
          name: model.name,
          capabilities: model.capabilities,
        });
      }
      await refresh();
      return result;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "拉取模型列表失败";
      return null;
    } finally {
      fetching.value = false;
    }
  }

  return {
    providers,
    selection,
    loading,
    fetching,
    error,
    activeProviderId,
    activeProvider,
    selectedLabel,
    bootstrap,
    refresh,
    setActiveProvider,
    addProvider,
    updateProvider,
    removeProvider,
    addModel,
    removeModel,
    select,
    fetchModels,
  };
});
