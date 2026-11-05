<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Copy, LogIn, RefreshCw, Trash2 } from "@lucide/vue";

import VendorLogo from "@/components/brand/VendorLogo.vue";
import CatalogModelPicker from "@/components/settings/CatalogModelPicker.vue";
import CodexUsagePanel from "@/components/settings/CodexUsagePanel.vue";
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
  authorized: [providerId: string];
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
const enabledModelCount = computed(() => props.provider.models.filter((item) => item.enabled).length);

// ChatGPT 账号登录状态（仅 chatgpt-oauth 供应商展示）
const chatgpt = ref<ChatGptAuthStatus | null>(null);
const loginPending = ref(false);
const authError = ref<string | null>(null);
let statusRequestId = 0;

// Codex 手动回调登录：浏览器授权 → 复制地址栏 → 粘贴确认
const codexAuthorizeUrl = ref("");
const codexCallback = ref("");
const codexStarting = ref(false);
const codexCompleting = ref(false);
const codexCopied = ref(false);

const isChatGpt = computed(() => props.provider.authMode === "chatgpt-oauth");
const isCodex = computed(() => isChatGpt.value || (
  props.provider.protocol === "openai-responses" &&
  /^https:\/\/api\.openai\.com\/v1\/?$/i.test(props.provider.baseUrl)
));

async function refreshChatGptStatus() {
  const currentRequest = ++statusRequestId;
  const providerId = props.provider.id;
  if (!isChatGpt.value || !window.zen?.models) {
    chatgpt.value = null;
    return;
  }
  try {
    const status = await window.zen.models.chatgptStatus(providerId);
    if (currentRequest === statusRequestId && providerId === props.provider.id) chatgpt.value = status;
  } catch {
    if (currentRequest === statusRequestId) chatgpt.value = null;
  }
}

async function onCodexStart() {
  if (codexStarting.value || !window.zen?.models) {
    return;
  }
  codexStarting.value = true;
  authError.value = null;
  try {
    const result = await window.zen.models.codexLoginStart(props.provider.id);
    codexAuthorizeUrl.value = result.authorizeUrl;
  } catch (error) {
    authError.value = error instanceof Error ? error.message : t("settings.models.codexLoginFailed");
  } finally {
    codexStarting.value = false;
  }
}

async function onCodexComplete() {
  if (codexCompleting.value || !codexCallback.value.trim() || !window.zen?.models) {
    return;
  }
  codexCompleting.value = true;
  authError.value = null;
  try {
    await window.zen.models.codexLoginComplete(props.provider.id, codexCallback.value);
    codexCallback.value = "";
    codexAuthorizeUrl.value = "";
    await refreshChatGptStatus();
    emit("authorized", props.provider.id);
  } catch (error) {
    authError.value = error instanceof Error ? error.message : t("settings.models.codexLoginFailed");
    await refreshChatGptStatus();
  } finally {
    codexCompleting.value = false;
  }
}

async function copyAuthorizeUrl() {
  if (!codexAuthorizeUrl.value) return;
  try {
    await navigator.clipboard.writeText(codexAuthorizeUrl.value);
    codexCopied.value = true;
    setTimeout(() => { codexCopied.value = false; }, 1500);
  } catch {
    authError.value = t("settings.models.codexCopyFailed");
  }
}

async function onChatGptLogin() {
  if (loginPending.value || !window.zen?.models) {
    return;
  }
  loginPending.value = true;
  authError.value = null;
  try {
    await window.zen.models.chatgptLogin(props.provider.id);
    await refreshChatGptStatus();
    emit("authorized", props.provider.id);
  } catch (error) {
    console.warn("[chatgpt] 登录失败:", error);
    authError.value = error instanceof Error ? error.message : t("settings.models.codexLoginFailed");
    await refreshChatGptStatus();
  } finally {
    loginPending.value = false;
  }
}

async function onChatGptLogout() {
  authError.value = null;
  if (!window.zen?.models) {
    await refreshChatGptStatus();
    return;
  }
  try {
    await window.zen.models.chatgptLogout(props.provider.id);
  } catch {
    authError.value = t("settings.models.codexLogoutWarning");
  } finally {
    await refreshChatGptStatus();
  }
}

watch(
  () => props.provider.id,
  () => {
    authError.value = null;
    chatgpt.value = null;
    void refreshChatGptStatus();
  },
  { immediate: true },
);

onUnmounted(() => { statusRequestId += 1; });

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

const stackLabel = "text-[12px] text-[var(--color-mut)]";
const ctrl = "h-8 text-[13px] bg-[var(--color-np-btn-bg)]";
const selectCtrl = "h-8 w-full text-[13px] bg-[var(--color-np-btn-bg)]";
/** 字段纵向排布：label 在输入框上方（与截图一致） */
const fieldStack = "flex min-w-0 flex-col gap-1";
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3.5">
    <header class="flex items-center justify-between gap-3 border-b border-[var(--color-line)] pb-3">
      <div class="flex items-center gap-2.5">
        <VendorLogo :vendor="provider.name" :size="22" />
        <div>
          <div class="text-[14px] font-semibold text-[var(--color-txt-strong)]">{{ form.name || provider.name }}</div>
          <div class="text-[12px] text-[var(--color-mut)]">
            {{ form.enabled ? t("settings.models.enabled") : t("settings.models.disabled") }}
            · {{ t("settings.models.modelCount", { enabled: enabledModelCount, total: provider.models.length }) }}
          </div>
        </div>
      </div>
      <Switch
        v-model="form.enabled"
        class="data-checked:bg-[var(--color-add)]"
        :aria-label="t('settings.models.enableProviderAria')"
        @update:model-value="markDirty"
      />
    </header>

    <div class="flex flex-col gap-2">
      <span class="text-[12px] font-medium text-[var(--color-txt)]">{{ t("settings.models.connectionSection") }}</span>
      <div :class="fieldStack">
        <Label for="pd-protocol" :class="stackLabel">{{ t("settings.models.protocol") }}</Label>
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
      <div :class="fieldStack">
        <Label for="pd-name" :class="stackLabel">{{ t("settings.models.name") }}</Label>
        <Input id="pd-name" v-model="form.name" :class="ctrl" @input="markDirty" />
      </div>
      <div :class="fieldStack">
        <Label for="pd-base" :class="stackLabel">{{ t("settings.models.baseUrlLabel") }}</Label>
        <Input id="pd-base" v-model="form.baseUrl" :class="ctrl" @input="markDirty" />
      </div>
      <!-- Codex / ChatGPT 账号：登录态与手动回调都收在一张卡里 -->
      <div
        v-if="isChatGpt"
        class="flex min-w-0 flex-col gap-2 rounded-[8px] border px-2.5 py-2"
        :class="chatgpt?.loggedIn
          ? 'border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
          : 'border-[var(--color-line)] bg-[var(--color-sunken)]'"
      >
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="min-w-0 truncate text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ chatgpt?.loggedIn ? (chatgpt.email || t("settings.models.chatgptLoggedIn")) : t("settings.models.chatgptLoggedOut") }}
            </span>
            <span class="text-[11px] text-[var(--color-mut)]">
              {{ chatgpt?.loggedIn && chatgpt.planType ? `${t("settings.models.chatgptAccount")} · ${chatgpt.planType}` : t("settings.models.codexAccountHint") }}
            </span>
          </div>
          <template v-if="chatgpt?.loggedIn">
            <Button variant="outline" size="xs" class="flex-none" @click="refreshChatGptStatus">
              <RefreshCw data-icon="inline-start" />
              {{ t("settings.models.codexRefreshStatus") }}
            </Button>
            <Button variant="ghost" size="xs" class="flex-none" @click="onChatGptLogout">
              {{ t("settings.models.chatgptLogout") }}
            </Button>
          </template>
        </div>

        <template v-if="!chatgpt?.loggedIn">
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <Button size="xs" :disabled="codexStarting" @click="onCodexStart">
              <LogIn data-icon="inline-start" />
              {{ codexStarting ? t("settings.models.codexOpening") : t("settings.models.codexOpenAuth") }}
            </Button>
            <Button
              v-if="codexAuthorizeUrl"
              variant="ghost"
              size="xs"
              class="min-w-0"
              @click="copyAuthorizeUrl"
            >
              <Copy data-icon="inline-start" />
              {{ codexCopied ? t("settings.models.codexCopied") : t("settings.models.codexCopyLink") }}
            </Button>
          </div>
          <div class="flex min-w-0 items-center gap-1.5">
            <Input
              v-model="codexCallback"
              class="h-7 flex-1 text-[12px]"
              :placeholder="t('settings.models.codexPastePlaceholder')"
              @keydown.enter="onCodexComplete"
            />
            <Button
              variant="outline"
              size="xs"
              class="flex-none"
              :disabled="!codexCallback.trim() || codexCompleting"
              @click="onCodexComplete"
            >
              {{ codexCompleting ? t("settings.models.chatgptPending") : t("settings.models.codexConfirm") }}
            </Button>
          </div>
          <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
            {{ t("settings.models.codexPasteHint") }}
          </p>
          <button
            type="button"
            class="self-start text-[11px] text-[var(--color-link)] hover:underline"
            :disabled="loginPending"
            @click="onChatGptLogin"
          >
            {{ loginPending ? t("settings.models.chatgptPending") : t("settings.models.codexAutoFallback") }}
          </button>
        </template>
        <p v-if="authError" class="m-0 text-[11px] text-[var(--color-err)]" role="alert">{{ authError }}</p>
      </div>
      <div v-else :class="fieldStack">
        <Label for="pd-key" :class="stackLabel">{{ t("settings.models.apiKey") }}</Label>
        <Input
          id="pd-key"
          v-model="form.apiKey"
          type="password"
          :class="ctrl"
          :placeholder="provider.hasApiKey ? t('settings.models.apiKeySavedPlaceholder') : 'sk-...'"
          @input="markDirty"
        />
      </div>
      <div :class="fieldStack">
        <Label for="pd-ua" :class="stackLabel">User-Agent</Label>
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

    <div class="flex justify-end gap-1.5 border-t border-[var(--color-line)] pt-3">
      <Button variant="ghost" size="sm" @click="onCancel">{{ t("common.cancel") }}</Button>
      <Button size="sm" @click="onSave">{{ t("common.save") }}</Button>
    </div>

    <CodexUsagePanel
      v-if="isCodex"
      :key="`${provider.id}:${chatgpt?.accountId ?? chatgpt?.email ?? ''}`"
      :provider-id="provider.id"
      :account-mode="isChatGpt"
    />

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
      <Button
        variant="ghost"
        size="sm"
        class="text-[var(--color-err)] hover:bg-transparent! hover:text-[var(--color-err)] dark:hover:bg-transparent!"
        @click="emit('removeProvider')"
      >
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
