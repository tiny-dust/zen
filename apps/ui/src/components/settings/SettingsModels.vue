<script setup lang="ts">
import { storeToRefs } from "pinia";
import { reactive, ref } from "vue";

import BaseButton from "@/components/base/BaseButton.vue";
import { useModelsStore } from "@/stores/models";
import { PROVIDER_PROTOCOLS } from "@zen/shared";

import type { ProviderProtocol } from "@zen/shared";

const modelsStore = useModelsStore();
const {
  providers,
  activeProvider,
  activeProviderId,
  selection,
  error,
  fetching,
} = storeToRefs(modelsStore);

const showAddProvider = ref(false);
const showAddModel = ref(false);
const loadMessage = ref("");

const providerForm = reactive({
  name: "",
  protocol: "openai-chat" as ProviderProtocol,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
});

const modelForm = reactive({
  id: "",
  name: "",
});

function protocolLabel(id: string) {
  return PROVIDER_PROTOCOLS.find((item) => item.id === id)?.label || id;
}

async function onAddProvider() {
  const created = await modelsStore.addProvider({
    name: providerForm.name,
    protocol: providerForm.protocol,
    baseUrl: providerForm.baseUrl,
    apiKey: providerForm.apiKey,
  });
  if (created) {
    showAddProvider.value = false;
    providerForm.name = "";
    providerForm.apiKey = "";
  }
}

async function onAddModel() {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  const created = await modelsStore.addModel(providerId, modelForm.id, modelForm.name || undefined);
  if (created) {
    showAddModel.value = false;
    modelForm.id = "";
    modelForm.name = "";
  }
}

async function onLoadModels() {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  loadMessage.value = "";
  const result = await modelsStore.fetchModels(providerId);
  if (result) {
    loadMessage.value = `已同步 ${result.models.length} 个模型`;
  }
}

async function onSelectModel(modelId: string) {
  const providerId = activeProviderId.value;
  if (!providerId) {
    return;
  }
  await modelsStore.select(providerId, modelId);
}
</script>

<template>
  <section class="section models-section">
    <div class="section-head">
      <div>
        <h3>模型供应</h3>
        <p class="hint">自定义 OpenAI / Anthropic 兼容供应商，拉取或手动添加模型。</p>
      </div>
      <BaseButton variant="ghost" @click="showAddProvider = !showAddProvider">
        {{ showAddProvider ? "取消" : "添加供应商" }}
      </BaseButton>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="showAddProvider" class="card form" @submit.prevent="onAddProvider">
      <label class="field">
        <span>名称</span>
        <input v-model="providerForm.name" placeholder="例如 OpenAI / DeepSeek / 本地" required />
      </label>
      <label class="field">
        <span>消息协议</span>
        <select v-model="providerForm.protocol">
          <option v-for="item in PROVIDER_PROTOCOLS" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Base URL</span>
        <input
          v-model="providerForm.baseUrl"
          placeholder="https://api.openai.com/v1"
          required
        />
      </label>
      <label class="field">
        <span>API Key</span>
        <input v-model="providerForm.apiKey" type="password" placeholder="sk-..." required />
      </label>
      <div class="form-actions">
        <BaseButton type="submit">保存供应商</BaseButton>
      </div>
    </form>

    <div v-if="!providers.length" class="empty">
      还没有供应商。点击「添加供应商」，填写协议、Base URL 与 Key。
    </div>

    <div v-else class="layout">
      <aside class="provider-list" aria-label="供应商列表">
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          class="provider-item"
          :class="{ 'is-active': provider.id === activeProviderId }"
          @click="modelsStore.setActiveProvider(provider.id)"
        >
          <span class="provider-name">{{ provider.name }}</span>
          <span class="provider-meta">
            {{ protocolLabel(provider.protocol) }} · {{ provider.models.length }} 模型
          </span>
        </button>
      </aside>

      <div v-if="activeProvider" class="detail">
        <div class="detail-head">
          <div>
            <div class="detail-title">{{ activeProvider.name }}</div>
            <div class="detail-sub">
              {{ protocolLabel(activeProvider.protocol) }}
            </div>
            <div class="detail-sub mono">{{ activeProvider.baseUrl }}</div>
            <div class="detail-sub">Key：{{ activeProvider.apiKeyMask || "未配置" }}</div>
          </div>
          <div class="detail-actions">
            <BaseButton variant="ghost" :disabled="fetching" @click="onLoadModels">
              {{ fetching ? "拉取中…" : "模型加载" }}
            </BaseButton>
            <BaseButton variant="ghost" @click="showAddModel = !showAddModel">添加模型</BaseButton>
            <BaseButton variant="ghost" @click="modelsStore.removeProvider(activeProvider.id)">
              删除供应商
            </BaseButton>
          </div>
        </div>

        <p v-if="loadMessage" class="ok">{{ loadMessage }}</p>

        <form v-if="showAddModel" class="card form" @submit.prevent="onAddModel">
          <label class="field">
            <span>模型 ID</span>
            <input v-model="modelForm.id" placeholder="例如 gpt-4o / claude-sonnet-4-20250514" required />
          </label>
          <label class="field">
            <span>显示名称（可选）</span>
            <input v-model="modelForm.name" placeholder="留空则根据 ID 推断" />
          </label>
          <p class="hint">保存时会按官方目录/启发式自动填充推理、上下文等能力。</p>
          <div class="form-actions">
            <BaseButton type="submit">保存模型</BaseButton>
          </div>
        </form>

        <ul class="model-list">
          <li
            v-for="model in activeProvider.models"
            :key="model.id"
            class="model-item"
            :class="{ 'is-active': selection.modelId === model.id && selection.providerId === activeProvider.id }"
          >
            <button type="button" class="model-main" @click="onSelectModel(model.id)">
              <div class="model-name">{{ model.name }}</div>
              <div class="model-id mono">{{ model.id }}</div>
              <div class="caps">
                <span v-if="model.capabilities?.reasoning" class="chip">推理</span>
                <span v-if="model.capabilities?.vision" class="chip">视觉</span>
                <span v-if="model.capabilities?.toolCall" class="chip">工具</span>
                <span v-if="model.capabilities?.contextWindow" class="chip">
                  {{ Math.round(model.capabilities.contextWindow / 1000) }}K 上下文
                </span>
                <span v-if="model.capabilities?.source" class="chip chip--dim">
                  {{ model.capabilities.source }}
                </span>
              </div>
            </button>
            <button
              type="button"
              class="model-del"
              aria-label="删除模型"
              @click="modelsStore.removeModel(activeProvider.id, model.id)"
            >
              ×
            </button>
          </li>
          <li v-if="!activeProvider.models.length" class="empty-line">
            暂无模型。可「模型加载」从 API 同步，或「添加模型」手动录入。
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.section h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--color-txt-strong);
}

.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--color-mut);
  line-height: 1.5;
}

.error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-danger-fg);
}

.ok {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-ok);
}

.empty {
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--color-btn-border);
  color: var(--color-mut);
  font-size: 12px;
}

.card {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-composer-surface);
}

.form {
  display: grid;
  gap: 10px;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--color-mut);
}

.field input,
.field select {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-input-bg);
  color: var(--color-txt-strong);
  font-size: 13px;
}

.field input:focus,
.field select:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-line));
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 12px;
  min-height: 220px;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.provider-item {
  text-align: left;
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-composer-surface);
  color: var(--color-txt);
}

.provider-item:hover {
  background: var(--color-menu-hover);
}

.provider-item.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-line));
  background: color-mix(in srgb, var(--color-accent) 8%, var(--color-composer-surface));
}

.provider-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.provider-meta {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-mut);
}

.detail {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.detail-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-txt-strong);
}

.detail-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-mut);
}

.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-item {
  display: flex;
  align-items: stretch;
  gap: 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-composer-surface);
  overflow: hidden;
}

.model-item.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-line));
}

.model-main {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 10px 12px;
}

.model-name {
  font-size: 13px;
  color: var(--color-txt-strong);
  font-weight: 500;
}

.model-id {
  margin-top: 2px;
  color: var(--color-dim);
}

.caps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.chip {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-chip-bg);
  color: var(--color-chip-text);
  font-size: 10px;
}

.chip--dim {
  color: var(--color-mut);
}

.model-del {
  width: 36px;
  border-left: 1px solid var(--color-line);
  color: var(--color-mut);
  font-size: 16px;
}

.model-del:hover {
  background: var(--color-danger-bg);
  color: var(--color-danger-fg);
}

.empty-line {
  padding: 12px;
  font-size: 12px;
  color: var(--color-mut);
  border: 1px dashed var(--color-btn-border);
  border-radius: var(--radius-sm);
}
</style>
