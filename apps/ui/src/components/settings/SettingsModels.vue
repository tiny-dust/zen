<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { classes } from "rattail";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import VendorLogo from "@/components/brand/VendorLogo.vue";
import ProviderDetail from "@/components/settings/ProviderDetail.vue";
import ProviderEditor from "@/components/settings/ProviderEditor.vue";
import { Button } from "@/components/ui/button";
import { toPlain } from "@/lib/utils";
import { useModelsStore } from "@/stores/models";

import type {
  ModelCapabilities,
  ProviderModel,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

type Mode = "view" | "add";

const { t } = useI18n();
const modelsStore = useModelsStore();
const { providers, activeProvider, activeProviderId, selection, error, fetching } =
  storeToRefs(modelsStore);

const mode = ref<Mode>("view");
const providerToRemove = ref(false);
const removing = ref(false);
const modelToRemove = ref<ProviderModel | null>(null);
const removingModel = ref(false);

const providerRemoveDesc = computed(() => {
  const provider = activeProvider.value;
  if (!provider) {
    return "";
  }
  const tail = provider.models.length
    ? t("settings.models.removeProviderTail", { n: provider.models.length })
    : "";
  return t("settings.models.removeProviderDesc", { name: provider.name, tail });
});

function startAdd() {
  mode.value = "add";
}

/** ChatGPT 账号登录：已存在 chatgpt-oauth 供应商时直接对其发起；否则自动创建（带预置 Codex 模型）后登录 */
async function onChatGptLogin() {
  const zen = window.zen;
  if (!zen?.models) {
    return;
  }
  const existing = providers.value.find((p) => p.authMode === "chatgpt-oauth");
  try {
    const { provider } = await zen.models.chatgptLogin(existing?.id);
    await modelsStore.refresh();
    if (provider) {
      modelsStore.setActiveProvider(provider.id);
    }
    mode.value = "view";
  } catch (error) {
    console.warn("[chatgpt] 登录失败:", error);
  }
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
    capabilities: model.capabilities ? toPlain(model.capabilities) : undefined,
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

/** 删除模型（仅手动添加的自定义模型入口可触达），落库不可撤销，需二次确认 */
async function confirmRemoveModel() {
  const providerId = activeProviderId.value;
  const model = modelToRemove.value;
  if (!providerId || !model) {
    return;
  }
  removingModel.value = true;
  await modelsStore.removeModel(providerId, model.id);
  removingModel.value = false;
  modelToRemove.value = null;
}
</script>

<template>
  <section class="grid items-start gap-3.5 grid-cols-[208px_minmax(0,1fr)] max-[720px]:grid-cols-[minmax(0,1fr)]">
    <aside class="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)]" :aria-label="t('settings.models.providerListAria')">
      <div class="flex h-[var(--panel-head-h)] items-center justify-between gap-1.5 border-b border-[var(--color-line)] px-[5px] pl-2.5">
        <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.models.providers") }}</span>
        <div class="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            :title="t('settings.models.chatgptLogin')"
            :aria-label="t('settings.models.chatgptLogin')"
            @click="onChatGptLogin"
          >
            <VendorLogo vendor="ChatGPT" :size="14" />
          </Button>
          <Button variant="ghost" size="icon-sm" :aria-label="t('settings.models.addProvider')" :title="t('settings.models.addProvider')" @click="startAdd">
            <Plus />
          </Button>
        </div>
      </div>
      <div class="flex flex-col gap-0.5 p-[5px]">
        <Button
          v-for="provider in providers"
          :key="provider.id"
          variant="ghost"
          :class="[railClass(provider.id), 'h-auto font-normal dark:hover:bg-[var(--color-menu-hover)]']"
          :title="provider.name"
          @click="selectProvider(provider)"
        >
          <VendorLogo :vendor="provider.name" :size="16" />
          <span class="min-w-0 flex-1 truncate text-[12px]">{{ provider.name }}</span>
          <span class="shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]">
            {{ provider.models.filter((m) => m.enabled).length }}/{{ provider.models.length }}
          </span>
        </Button>
        <p v-if="!providers.length" class="m-0 px-2 py-1.5 text-[12px] text-[var(--color-dim)]">{{ t("settings.models.noProviders") }}</p>
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
          @remove-model="modelToRemove = $event"
        />
      </div>

      <div v-else class="min-w-0 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)] p-3.5">
        <p class="m-0 px-2 py-2.5 text-[12px] text-[var(--color-mut)]">
          {{ t("settings.models.emptyHint") }}
        </p>
      </div>
    </div>

    <ConfirmDialog
      :open="providerToRemove"
      :title="t('settings.models.removeProviderTitle')"
      :description="providerRemoveDesc"
      :confirm-label="t('settings.models.removeProviderConfirm')"
      :pending="removing"
      @update:open="providerToRemove = $event"
      @confirm="confirmRemoveProvider"
    />

    <ConfirmDialog
      :open="!!modelToRemove"
      :title="t('settings.models.removeModelTitle', { name: modelToRemove?.name ?? '' })"
      :description="t('settings.models.removeModelDesc')"
      :confirm-label="t('settings.models.removeModelConfirm')"
      :pending="removingModel"
      @update:open="(value) => { if (!value) modelToRemove = null; }"
      @confirm="confirmRemoveModel"
    />
  </section>
</template>
