<script setup lang="ts">
import { Plus, RefreshCw } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref } from "vue";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import EditorModelList from "@/components/settings/EditorModelList.vue";
import FetchedModelList from "@/components/settings/FetchedModelList.vue";
import ProviderFields from "@/components/settings/ProviderFields.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModelsStore } from "@/stores/models";

import type {
  FetchModelsResult,
  ProviderModel,
  ProviderProtocol,
} from "@zen/shared";

/** 仅用于「新增供应商」；编辑已有供应商走 ProviderDetail */
const emit = defineEmits<{
  saved: [];
  cancel: [];
}>();

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
const showManualAdd = ref(false);
const manualForm = reactive({ id: "", name: "" });

const canLoadModels = computed(() => Boolean(form.baseUrl.trim() && form.apiKey.trim()));
const fetchedRows = computed(() => fetched.value?.models ?? []);
const knownIds = computed(() => new Set(pendingModels.value.map((item) => item.id)));

function resetFetchState() {
  fetched.value = null;
  checkedIds.value = new Set();
  showManualAdd.value = false;
  manualForm.id = "";
  manualForm.name = "";
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

function onManualAdd() {
  const modelId = manualForm.id.trim();
  if (!modelId || knownIds.value.has(modelId)) {
    return;
  }
  pendingModels.value.push({
    id: modelId,
    name: manualForm.name.trim() || modelId,
    enabled: true,
    custom: true,
  });
  manualForm.id = "";
  manualForm.name = "";
  showManualAdd.value = false;
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
        capabilities: item.capabilities ? { ...item.capabilities } : undefined,
      })),
    });
    if (created) {
      emit("saved");
    }
  } finally {
    saving.value = false;
  }
}

const modelToRemove = ref<ProviderModel | null>(null);
const removing = ref(false);

const modelRemoveDesc = computed(() => {
  const model = modelToRemove.value;
  return model ? `将移除待添加的 ${model.name}（尚未落库）。` : "";
});

function askRemoveModel(model: ProviderModel) {
  pendingModels.value = pendingModels.value.filter((item) => item.id !== model.id);
}

function onModelDialogOpen(next: boolean) {
  if (!next) {
    modelToRemove.value = null;
  }
}

async function confirmRemoveModel() {
  removing.value = false;
  modelToRemove.value = null;
}
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-settings-card)]">
    <header class="flex items-center justify-between gap-2.5 border-b border-[var(--color-line)] py-2 pl-3.5 pr-2.5">
      <div class="flex min-w-0 items-baseline gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">新增供应商</h3>
        <span class="truncate text-[11.5px] text-[var(--color-mut)]">
          协议 · 名称 · Base URL · API Key · User-Agent
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" @click="emit('cancel')">取消</Button>
        <Button size="sm" :disabled="saving" @click="onSave">保存供应商</Button>
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
        :title="canLoadModels ? '按当前连接信息拉取模型列表' : '请先填写 Base URL 与 API Key'"
        @click="onLoadModels"
      >
        <RefreshCw data-icon="inline-start" />
        {{ fetching ? "刷新中…" : "刷新模型" }}
      </Button>
      <Button variant="outline" size="sm" @click="showManualAdd = !showManualAdd">
        <Plus data-icon="inline-start" />
        手动添加
      </Button>
      <span v-if="!canLoadModels" class="text-[11.5px] text-[var(--color-dim)]">
        需先填写 Base URL 与 API Key
      </span>
    </div>

    <form
      v-if="showManualAdd"
      class="mx-3.5 mb-2.5 flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-2.5 py-2"
      @submit.prevent="onManualAdd"
    >
      <label class="shrink-0 text-[11.5px] text-[var(--color-mut)]" for="manual-id">ID</label>
      <Input
        id="manual-id"
        v-model="manualForm.id"
        class="h-7 flex-1 border-0 bg-transparent text-[12.5px]"
        placeholder="gpt-4o / VW2TTQCH/deepseek-v4-flash"
        required
      />
      <label class="shrink-0 text-[11.5px] text-[var(--color-mut)]" for="manual-name">名称</label>
      <Input
        id="manual-name"
        v-model="manualForm.name"
        class="h-7 flex-1 border-0 bg-transparent text-[12.5px]"
        placeholder="留空则自动推断"
      />
      <Button type="submit" size="sm">添加</Button>
    </form>

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

    <ConfirmDialog
      :open="modelToRemove !== null"
      title="移除待添加模型？"
      :description="modelRemoveDesc"
      confirm-label="移除"
      :pending="removing"
      @update:open="onModelDialogOpen"
      @confirm="confirmRemoveModel"
    />
  </div>
</template>
