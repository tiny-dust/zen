<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { classes } from "rattail";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import VendorLogo from "@/components/brand/VendorLogo.vue";
import ProviderDetail from "@/components/settings/ProviderDetail.vue";
import ProviderEditor from "@/components/settings/ProviderEditor.vue";
import { Button } from "@/components/ui/button";
import { useModelsStore } from "@/stores/models";

import type {
  ModelCapabilities,
  ProviderModel,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

type Mode = "view" | "add";

const modelsStore = useModelsStore();
const { providers, activeProvider, activeProviderId, selection, error, fetching } =
  storeToRefs(modelsStore);

const mode = ref<Mode>("view");
const providerToRemove = ref(false);
const removing = ref(false);

const providerRemoveDesc = computed(() => {
  const provider = activeProvider.value;
  if (!provider) {
    return "";
  }
  const tail = provider.models.length ? `及其 ${provider.models.length} 个模型` : "";
  return `将从本地数据库移除「${provider.name}」${tail}，操作不可撤销。`;
});

function startAdd() {
  mode.value = "add";
}

function selectProvider(provider: ProviderSummary) {
  modelsStore.setActiveProvider(provider.id);
  mode.value = "view";
}

function railClass(id: string) {
  return classes(
    "flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[var(--color-txt)] transition-colors hover:bg-[var(--color-menu-hover)]",
    [id === activeProviderId.value && mode.value === "view", "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"],
    [!providers.value.find((p) => p.id === id)?.enabled, "opacity-55"],
  );
}

async function onSaveProvider(patch: {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey?: string;
  userAgent?: string;
  enabled: boolean;
}) {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  await modelsStore.updateProvider(providerId, patch);
}

async function onRefreshModels() {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  const result = await modelsStore.refreshFromProvider(providerId);
  if (!result || !activeProvider.value) {
    return;
  }
  const known = new Set(activeProvider.value.models.map((item) => item.id));
  for (const item of result.models) {
    if (!known.has(item.id)) {
      await modelsStore.addModel({
        providerId,
        id: item.id,
        name: item.name || undefined,
        enabled: true,
        custom: false,
        capabilities: item.capabilities,
      });
    }
  }
  await modelsStore.refresh();
}

async function onSelectModel(modelId: string) {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  await modelsStore.select(providerId, modelId);
}

async function onToggleModelEnabled(model: ProviderModel, next: boolean) {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  await modelsStore.updateModel({
    providerId,
    id: model.id,
    enabled: next,
    name: model.name,
    capabilities: model.capabilities,
  });
}

async function onAddModel(payload: {
  id: string;
  name: string;
  custom: boolean;
  capabilities: ModelCapabilities;
}) {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  await modelsStore.addModel({
    providerId,
    id: payload.id,
    name: payload.name,
    enabled: true,
    custom: payload.custom,
    capabilities: payload.capabilities,
  });
}

async function onUpdateModel(payload: {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
}) {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  await modelsStore.updateModel({
    providerId,
    id: payload.id,
    name: payload.name,
    capabilities: payload.capabilities,
  });
}

async function confirmRemoveProvider() {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  removing.value = true;
  await modelsStore.removeProvider(providerId);
  removing.value = false;
  providerToRemove.value = false;
  mode.value = "view";
}
</script>

<template>
  <section class="grid items-start gap-3.5 grid-cols-[208px_minmax(0,1fr)] max-[720px]:grid-cols-[minmax(0,1fr)]">
    <aside class="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)]" aria-label="供应商列表">
      <div class="flex h-[var(--panel-head-h)] items-center justify-between gap-1.5 border-b border-[var(--color-line)] px-[5px] pl-2.5">
        <span class="text-[12px] text-[var(--color-mut)]">供应商</span>
        <Button variant="ghost" size="icon-sm" aria-label="添加供应商" title="添加供应商" @click="startAdd">
          <Plus />
        </Button>
      </div>
      <div class="flex flex-col gap-0.5 p-[5px]">
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          :class="railClass(provider.id)"
          :title="provider.name"
          @click="selectProvider(provider)"
        >
          <VendorLogo :vendor="provider.name" :size="16" />
          <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ provider.name }}</span>
          <span class="shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]">
            {{ provider.models.filter((m) => m.enabled).length }}/{{ provider.models.length }}
          </span>
        </button>
        <p v-if="!providers.length" class="m-0 px-2 py-1.5 text-[12px] text-[var(--color-dim)]">暂无供应商</p>
      </div>
    </aside>

    <div class="flex min-w-0 flex-col gap-2.5">
      <p v-if="error" class="m-0 text-[12px] text-[var(--color-err)]" role="alert">{{ error }}</p>

      <ProviderEditor
        v-if="mode === 'add'"
        :provider="null"
        @saved="mode = 'view'"
        @cancel="mode = 'view'"
      />

      <div v-else-if="activeProvider" class="min-w-0 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)] p-3.5">
        <ProviderDetail
          :provider="activeProvider"
          :fetching="fetching"
          :selection-provider-id="selection.providerId"
          :selection-model-id="selection.modelId"
          @save="onSaveProvider"
          @refresh-models="onRefreshModels"
          @remove-provider="providerToRemove = true"
          @select-model="onSelectModel"
          @toggle-model-enabled="onToggleModelEnabled"
          @add-model="onAddModel"
          @update-model="onUpdateModel"
        />
      </div>

      <div v-else class="min-w-0 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)] p-3.5">
        <p class="m-0 px-2 py-2.5 text-[12px] text-[var(--color-mut)]">
          还没有供应商。点击左侧「+」新建一个，填写连接信息后即可拉取模型列表。
        </p>
      </div>
    </div>

    <ConfirmDialog
      :open="providerToRemove"
      title="删除供应商？"
      :description="providerRemoveDesc"
      confirm-label="删除供应商"
      :pending="removing"
      @update:open="providerToRemove = $event"
      @confirm="confirmRemoveProvider"
    />
  </section>
</template>
