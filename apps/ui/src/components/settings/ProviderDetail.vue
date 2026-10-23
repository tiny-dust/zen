<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
  ChatGptAuthStatus,
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
  removeModel: [model: ProviderModel];
}>();

const { t } = useI18n();

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

// ChatGPT 账号登录状态（仅 chatgpt-oauth 供应商展示）
const chatgpt = ref<ChatGptAuthStatus | null>(null);
const loginPending = ref(false);

const isChatGpt = computed(() => props.provider.authMode === "chatgpt-oauth");

async function refreshChatGptStatus() {
  if (!isChatGpt.value || !window.zen?.models) {
    chatgpt.value = null;
    return;
  }
  try {
    chatgpt.value = await window.zen.models.chatgptStatus(props.provider.id);
  } catch {
    chatgpt.value = null;
  }
}

async function onChatGptLogin() {
  if (loginPending.value || !window.zen?.models) {
    return;
  }
  loginPending.value = true;
  try {
    await window.zen.models.chatgptLogin(props.provider.id);
    await refreshChatGptStatus();
  } catch (error) {
    console.warn("[chatgpt] 登录失败:", error);
    await refreshChatGptStatus();
    throw error;
  } finally {
    loginPending.value = false;
  }
}

async function onChatGptLogout() {
  if (!window.zen?.models) {
    await refreshChatGptStatus();
    return;
  }
  try {
    chatgpt.value = await window.zen.models.chatgptLogout(props.provider.id);
  } catch {
    await refreshChatGptStatus();
  }
}

watch(
  () => props.provider.id,
  () => void refreshChatGptStatus(),
  { immediate: true },
);

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

const fieldLabel = "field-row-label font-normal";
const ctrl = "h-8 text-[13px] bg-[var(--color-np-btn-bg)]";
const selectCtrl = "h-8 w-full text-[13px] bg-[var(--color-np-btn-bg)]";
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3.5">
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <VendorLogo :vendor="provider.name" :size="22" />
        <div>
          <div class="text-[14px] font-semibold text-[var(--color-txt-strong)]">{{ form.name || provider.name }}</div>
          <div class="text-[12px] text-[var(--color-mut)]">{{ form.enabled ? t("settings.models.enabled") : t("settings.models.disabled") }}</div>
        </div>
      </div>
      <Switch v-model="form.enabled" :aria-label="t('settings.models.enableProviderAria')" @update:model-value="markDirty" />
    </header>

    <div class="flex flex-col">
      <div class="field-row">
        <Label for="pd-protocol" :class="fieldLabel">{{ t("settings.models.protocol") }}</Label>
        <Select v-model="form.protocol" @update:model-value="markDirty">
          <SelectTrigger id="pd-protocol" :class="selectCtrl">
            <SelectValue :placeholder="t('settings.models.protocolPlaceholder')" />
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
      <div class="field-row">
        <Label for="pd-name" :class="fieldLabel">{{ t("settings.models.name") }}</Label>
        <Input id="pd-name" v-model="form.name" :class="ctrl" @input="markDirty" />
      </div>
      <div class="field-row">
        <Label for="pd-base" :class="fieldLabel">{{ t("settings.models.baseUrlLabel") }}</Label>
        <Input id="pd-base" v-model="form.baseUrl" :class="ctrl" @input="markDirty" />
      </div>
      <div v-if="isChatGpt" class="field-row">
        <Label :class="fieldLabel">{{ t("settings.models.chatgptAccount") }}</Label>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <template v-if="chatgpt?.loggedIn">
            <span class="min-w-0 truncate text-[13px] text-[var(--color-txt)]">
              {{ chatgpt.email || t("settings.models.chatgptLoggedIn") }}
              <span v-if="chatgpt.planType" class="text-[11px] text-[var(--color-dim)]">({{ chatgpt.planType }})</span>
            </span>
            <Button variant="outline" size="sm" @click="onChatGptLogout">
              {{ t("settings.models.chatgptLogout") }}
            </Button>
          </template>
          <template v-else>
            <span class="text-[13px] text-[var(--color-dim)]">{{ t("settings.models.chatgptLoggedOut") }}</span>
            <Button size="sm" :disabled="loginPending" @click="onChatGptLogin">
              {{ loginPending ? t("settings.models.chatgptPending") : t("settings.models.chatgptLogin") }}
            </Button>
          </template>
        </div>
      </div>
      <div v-else class="field-row">
        <Label for="pd-key" :class="fieldLabel">{{ t("settings.models.apiKey") }}</Label>
        <Input
          id="pd-key"
          v-model="form.apiKey"
          type="password"
          :class="ctrl"
          :placeholder="provider.hasApiKey ? t('settings.models.apiKeySavedPlaceholder') : 'sk-...'"
          @input="markDirty"
        />
      </div>
      <div class="field-row">
        <Label for="pd-ua" :class="fieldLabel">User-Agent</Label>
        <div class="min-w-0">
          <Input
            id="pd-ua"
            v-model="form.userAgent"
            :class="ctrl + ' w-full'"
            placeholder="Mozilla/5.0 ..."
            @input="markDirty"
          />
          <p class="m-0 mt-1 text-[11px] leading-snug text-[var(--color-dim)]">{{ t("settings.models.userAgentHint") }}</p>
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-1.5">
      <Button variant="ghost" size="sm" @click="onCancel">{{ t("common.cancel") }}</Button>
      <Button size="sm" @click="onSave">{{ t("common.save") }}</Button>
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
      @remove="(m) => emit('removeModel', m)"
      @refresh="emit('refreshModels')"
      @add="openPicker"
    />

    <div class="flex justify-center px-0 py-1">
      <Button variant="destructive" size="sm" @click="emit('removeProvider')">
        <Trash2 data-icon="inline-start" />
        {{ t("settings.models.deleteThisProvider") }}
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
