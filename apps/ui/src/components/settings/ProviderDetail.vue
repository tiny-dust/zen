<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Trash2 } from "@lucide/vue";

import VendorLogo from "@/components/brand/VendorLogo.vue";
import CatalogModelPicker from "@/components/settings/CatalogModelPicker.vue";
import ModelFormDialog from "@/components/settings/ModelFormDialog.vue";
import ProviderModelList from "@/components/settings/ProviderModelList.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_PROTOCOLS } from "@zen/shared";

import type {
  CatalogModel,
  ModelCapabilities,
  ProviderModel,
  ProviderProtocol,
  ProviderSummary,
} from "@zen/shared";

const props = defineProps<{
  provider: ProviderSummary;
  fetching?: boolean;
  selectionProviderId?: string | null;
  selectionModelId?: string | null;
}>();

const emit = defineEmits<{
  save: [patch: {
    name: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    apiKey?: string;
    userAgent?: string;
    enabled: boolean;
  }];
  refreshModels: [];
  removeProvider: [];
  selectModel: [modelId: string];
  toggleModelEnabled: [model: ProviderModel, enabled: boolean];
  addModel: [payload: {
    id: string;
    name: string;
    custom: boolean;
    capabilities: ModelCapabilities;
  }];
  updateModel: [payload: {
    id: string;
    name: string;
    capabilities: ModelCapabilities;
  }];
}>();

const form = reactive({
  name: "",
  protocol: "openai-chat" as ProviderProtocol,
  baseUrl: "",
  apiKey: "",
  userAgent: "",
  enabled: true,
});

const dirty = ref(false);
const showPicker = ref(false);
const showForm = ref(false);
const formTemplate = ref<CatalogModel | null>(null);
const formPresetId = ref("");
const editingModel = ref<ProviderModel | null>(null);
const knownIds = computed(() => new Set(props.provider.models.map((item) => item.id)));

function syncFromProvider() {
  form.name = props.provider.name;
  form.protocol = props.provider.protocol;
  form.baseUrl = props.provider.baseUrl;
  form.apiKey = "";
  form.userAgent = props.provider.userAgent ?? "";
  form.enabled = props.provider.enabled;
  dirty.value = false;
}

watch(() => props.provider.id, syncFromProvider, { immediate: true });
watch(
  () => [
    props.provider.name,
    props.provider.protocol,
    props.provider.baseUrl,
    props.provider.userAgent,
    props.provider.enabled,
  ],
  () => {
    if (!dirty.value) {
      syncFromProvider();
    }
  },
);

function markDirty() {
  dirty.value = true;
}

function onSave() {
  emit("save", {
    name: form.name.trim(),
    protocol: form.protocol,
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim() || undefined,
    userAgent: form.userAgent.trim(),
    enabled: form.enabled,
  });
  dirty.value = false;
}

function onCancel() {
  syncFromProvider();
}

function openPicker() {
  formTemplate.value = null;
  formPresetId.value = "";
  editingModel.value = null;
  showPicker.value = true;
}

function onPickCustom(prefillId: string) {
  showPicker.value = false;
  formTemplate.value = null;
  formPresetId.value = prefillId;
  editingModel.value = null;
  showForm.value = true;
}

function onPickTemplate(model: CatalogModel) {
  showPicker.value = false;
  formTemplate.value = model;
  formPresetId.value = "";
  editingModel.value = null;
  showForm.value = true;
}

function onEditModel(model: ProviderModel) {
  editingModel.value = model;
  formTemplate.value = null;
  formPresetId.value = "";
  showForm.value = true;
}

function onSaveModel(payload: {
  id: string;
  name: string;
  custom: boolean;
  capabilities: ModelCapabilities;
}) {
  if (editingModel.value) {
    emit("updateModel", {
      id: payload.id,
      name: payload.name,
      capabilities: payload.capabilities,
    });
    return;
  }
  emit("addModel", payload);
}

const fieldLabel = "text-[12px] text-[var(--color-mut)]";
const ctrl = "h-9 rounded-[10px] text-[13px] bg-[var(--color-input-bg)]";
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3.5">
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <VendorLogo :vendor="provider.name" :size="22" />
        <div>
          <div class="text-[14px] font-semibold text-[var(--color-txt-strong)]">{{ form.name || provider.name }}</div>
          <div class="text-[12px] text-[var(--color-mut)]">{{ form.enabled ? "已启用" : "已停用" }}</div>
        </div>
      </div>
      <Switch v-model="form.enabled" aria-label="启用供应商" @update:model-value="markDirty" />
    </header>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1.5">
        <Label for="pd-protocol" :class="fieldLabel">协议</Label>
        <Select v-model="form.protocol" @update:model-value="markDirty">
          <SelectTrigger id="pd-protocol" :class="ctrl">
            <SelectValue placeholder="选择协议" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="item in PROVIDER_PROTOCOLS" :key="item.id" :value="item.id">
                {{ item.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="pd-name" :class="fieldLabel">名称</Label>
        <Input id="pd-name" v-model="form.name" :class="ctrl" @input="markDirty" />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="pd-base" :class="fieldLabel">基础 URL</Label>
        <Input id="pd-base" v-model="form.baseUrl" :class="ctrl" @input="markDirty" />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="pd-key" :class="fieldLabel">API 密钥</Label>
        <Input
          id="pd-key"
          v-model="form.apiKey"
          type="password"
          :class="ctrl"
          :placeholder="provider.hasApiKey ? '已保存，如需更换请重新输入' : 'sk-...'"
          @input="markDirty"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="pd-ua" :class="fieldLabel">User-Agent</Label>
        <Input
          id="pd-ua"
          v-model="form.userAgent"
          :class="ctrl"
          placeholder="Mozilla/5.0 ..."
          @input="markDirty"
        />
        <p class="m-0 text-[11.5px] text-[var(--color-dim)]">留空则使用运行时默认值。仅应用于此供应商的模型获取和模型请求。</p>
      </div>
    </div>

    <div class="flex justify-end gap-1.5">
      <Button variant="ghost" size="sm" @click="onCancel">取消</Button>
      <Button size="sm" @click="onSave">保存</Button>
    </div>

    <ProviderModelList
      :models="provider.models"
      :provider-id="provider.id"
      :selection-provider-id="selectionProviderId ?? null"
      :selection-model-id="selectionModelId ?? null"
      :fetching="fetching"
      @select="(id) => emit('selectModel', id)"
      @toggle-enabled="(m, next) => emit('toggleModelEnabled', m, next)"
      @edit="onEditModel"
      @refresh="emit('refreshModels')"
      @add="openPicker"
    />

    <div class="flex justify-center px-0 py-1">
      <Button variant="ghost" size="sm" class="text-[var(--color-del)]" @click="emit('removeProvider')">
        <Trash2 data-icon="inline-start" />
        删除此供应商
      </Button>
    </div>

    <CatalogModelPicker
      v-model:open="showPicker"
      :known-ids="knownIds"
      @pick-custom="onPickCustom"
      @pick-template="onPickTemplate"
    />

    <ModelFormDialog
      v-model:open="showForm"
      :provider-name="provider.name"
      :template="formTemplate"
      :preset-id="formPresetId"
      :initial="editingModel"
      @save="onSaveModel"
    />
  </div>
</template>
