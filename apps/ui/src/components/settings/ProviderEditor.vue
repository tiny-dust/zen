<script setup lang="ts">
import { Plus, RefreshCw } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import CatalogModelPicker from "@/components/settings/CatalogModelPicker.vue";
import EditorModelList from "@/components/settings/EditorModelList.vue";
import FetchedModelList from "@/components/settings/FetchedModelList.vue";
import ModelFormDialog from "@/components/settings/ModelFormDialog.vue";
import ProviderFields from "@/components/settings/ProviderFields.vue";
import { Button } from "@/components/ui/button";
import { toPlain } from "@/lib/utils";
import { useModelsStore } from "@/stores/models";

import type {
  CatalogModel,
  FetchModelsResult,
  ProviderModel,
  ProviderProtocol,
} from "@zen/shared";

/** 仅用于「新增供应商」；编辑已有供应商走 ProviderDetail */
const emit = defineEmits<{
  saved: [];
  cancel: [];
}>();

const { t } = useI18n();
const modelsStore = useModelsStore();
const { fetching } = storeToRefs(modelsStore);

const saving = ref(false);
const form = reactive({
  name: "",
  protocol: "openai-chat" as ProviderProtocol,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  userAgent: "",
});

const pendingModels = ref<ProviderModel[]>([]);
const fetched = ref<FetchModelsResult | null>(null);
const checkedIds = ref<Set<string>>(new Set());

const canLoadModels = computed(() => Boolean(form.baseUrl.trim() && form.apiKey.trim()));
const fetchedRows = computed(() => fetched.value?.models ?? []);
const knownIds = computed(() => new Set(pendingModels.value.map((item) => item.id)));

/** 添加模型与已有供应商（ProviderDetail）同一交互：目录选择 → 模型表单弹窗 */
const showPicker = ref(false);
const showForm = ref(false);
const formTemplate = ref<CatalogModel | null>(null);
const formPresetId = ref("");
const formProviderLabel = computed(() => form.name.trim() || t("settings.models.addTitle"));

function resetFetchState() {
  fetched.value = null;
  checkedIds.value = new Set();
}

function toggleChecked(id: string, next: boolean) {
  const set = new Set(checkedIds.value);
  if (next) {
    set.add(id);
  } else {
    set.delete(id);
  }
  checkedIds.value = set;
}

function checkAll() {
  checkedIds.value = new Set(fetchedRows.value.map((item) => item.id));
}

function clearChecked() {
  checkedIds.value = new Set();
}

async function onLoadModels() {
  if (!canLoadModels.value) {
    return;
  }
  resetFetchState();
  const result = await modelsStore.previewModels({
    protocol: form.protocol,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey.trim() || undefined,
    userAgent: form.userAgent.trim() || undefined,
  });
  if (result) {
    fetched.value = result;
    const known = knownIds.value;
    checkedIds.value = new Set(
      result.models.filter((item) => !known.has(item.id)).map((item) => item.id),
    );
  }
}

function onAddChecked() {
  const picked = fetchedRows.value.filter((item) => checkedIds.value.has(item.id));
  const known = new Set(pendingModels.value.map((item) => item.id));
  for (const item of picked) {
    if (!known.has(item.id)) {
      pendingModels.value.push({
        id: item.id,
        name: item.name || item.id,
        enabled: true,
        custom: false,
        capabilities: item.capabilities,
      });
    }
  }
  resetFetchState();
}

function openPicker() {
  formTemplate.value = null;
  formPresetId.value = "";
  showPicker.value = true;
}

function onPickCustom(prefillId: string) {
  showPicker.value = false;
  formTemplate.value = null;
  formPresetId.value = prefillId;
  showForm.value = true;
}

function onPickTemplate(model: CatalogModel) {
  showPicker.value = false;
  formTemplate.value = model;
  formPresetId.value = "";
  showForm.value = true;
}

function onSaveModel(payload: {
  id: string;
  name: string;
  custom: boolean;
  capabilities?: ProviderModel["capabilities"];
}) {
  if (knownIds.value.has(payload.id)) {
    return;
  }
  pendingModels.value.push({
    id: payload.id,
    name: payload.name,
    enabled: true,
    custom: payload.custom,
    capabilities: payload.capabilities,
  });
}

function askRemoveModel(model: ProviderModel) {
  pendingModels.value = pendingModels.value.filter((item) => item.id !== model.id);
}

async function onSave() {
  if (saving.value) {
    return;
  }
  saving.value = true;
  try {
    const created = await modelsStore.addProvider({
      name: form.name,
      protocol: form.protocol,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      userAgent: form.userAgent.trim() || undefined,
      models: pendingModels.value.map((item) => ({
        id: item.id,
        name: item.name,
        enabled: item.enabled !== false,
        custom: item.custom,
        // 深拷贝：浅展开仍会把 reactive 数组（reasoningEfforts）带进 IPC
        capabilities: item.capabilities ? toPlain(item.capabilities) : undefined,
      })),
    });
    if (created) {
      emit("saved");
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)]">
    <header class="flex items-center justify-between gap-2.5 border-b border-[var(--color-line)] py-2 pl-3.5 pr-2.5">
      <div class="flex min-w-0 items-baseline gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.models.addTitle") }}</h3>
        <span class="truncate text-[11px] text-[var(--color-mut)]">
          {{ t("settings.models.addFieldHint") }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" @click="emit('cancel')">{{ t("common.cancel") }}</Button>
        <Button size="sm" :disabled="saving" @click="onSave">{{ t("settings.models.saveProvider") }}</Button>
      </div>
    </header>

    <ProviderFields
      v-model:name="form.name"
      v-model:protocol="form.protocol"
      v-model:base-url="form.baseUrl"
      v-model:api-key="form.apiKey"
      v-model:user-agent="form.userAgent"
      :edit-mode="false"
    />

    <div class="flex items-center gap-1.5 px-3.5 pb-2.5 pt-1">
      <Button
        variant="outline"
        size="sm"
        :disabled="!canLoadModels || fetching"
        :title="canLoadModels ? t('settings.models.refreshModelsTitle') : t('settings.models.needBaseUrlKeyTitle')"
        @click="onLoadModels"
      >
        <RefreshCw data-icon="inline-start" />
        {{ fetching ? t("settings.models.refreshing") : t("settings.models.refreshModels") }}
      </Button>
      <Button variant="outline" size="sm" @click="openPicker">
        <Plus data-icon="inline-start" />
        {{ t("settings.models.addModel") }}
      </Button>
      <span v-if="!canLoadModels" class="text-[11px] text-[var(--color-dim)]">
        {{ t("settings.models.needBaseUrlKeyHint") }}
      </span>
    </div>

    <FetchedModelList
      v-if="fetchedRows.length"
      :rows="fetchedRows"
      :checked-ids="checkedIds"
      :known-ids="knownIds"
      @toggle="toggleChecked"
      @all="checkAll"
      @clear="clearChecked"
      @add="onAddChecked"
    />

    <EditorModelList :models="pendingModels" :edit-mode="false" @remove="askRemoveModel" />

    <CatalogModelPicker
      v-model:open="showPicker"
      :known-ids="knownIds"
      @pick-custom="onPickCustom"
      @pick-template="onPickTemplate"
    />

    <ModelFormDialog
      v-model:open="showForm"
      :provider-name="formProviderLabel"
      :template="formTemplate"
      :preset-id="formPresetId"
      @save="onSaveModel"
    />
  </div>
</template>
