<script setup lang="ts">
import { Download, Plus, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useModelsStore } from "@/stores/models";
import { PROVIDER_PROTOCOLS } from "@zen/shared";

import type { ProviderProtocol } from "@zen/shared";

const modelsStore = useModelsStore();
const { providers, activeProvider, activeProviderId, selection, error, fetching } =
  storeToRefs(modelsStore);

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

const canOperateModels = computed(() => {
  const p = activeProvider.value;
  return Boolean(p?.baseUrl && p?.hasApiKey);
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
  if (!providerId || !canOperateModels.value) {
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
  if (!providerId || !canOperateModels.value) {
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
  <section class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="mb-1 text-[13px] font-semibold text-foreground">模型供应</h3>
        <p class="m-0 text-xs text-muted-foreground">
          自定义 OpenAI / Anthropic 兼容供应商；配置 Base URL 与 API Key 后才能加载或添加模型。
        </p>
      </div>
      <Button variant="outline" size="sm" @click="showAddProvider = !showAddProvider">
        <Plus data-icon="inline-start" />
        {{ showAddProvider ? "取消" : "添加供应商" }}
      </Button>
    </div>

    <p v-if="error" class="m-0 text-xs text-destructive">{{ error }}</p>

    <Card v-if="showAddProvider">
      <CardHeader>
        <CardTitle class="text-sm">新增供应商</CardTitle>
        <CardDescription>选择消息协议，填写 Base URL 与 API Key。</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-3" @submit.prevent="onAddProvider">
          <FieldGroup>
            <Field>
              <FieldLabel for="provider-name">名称</FieldLabel>
              <Input id="provider-name" v-model="providerForm.name" placeholder="OpenAI / DeepSeek / 本地" required />
            </Field>
            <Field>
              <FieldLabel>消息协议</FieldLabel>
              <Select v-model="providerForm.protocol">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="选择协议" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="item in PROVIDER_PROTOCOLS"
                      :key="item.id"
                      :value="item.id"
                    >
                      {{ item.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="provider-base">Base URL</FieldLabel>
              <Input id="provider-base" v-model="providerForm.baseUrl" placeholder="https://api.openai.com/v1" required />
            </Field>
            <Field>
              <FieldLabel for="provider-key">API Key</FieldLabel>
              <Input id="provider-key" v-model="providerForm.apiKey" type="password" placeholder="sk-..." required />
            </Field>
          </FieldGroup>
          <div class="flex justify-end">
            <Button type="submit">保存供应商</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card v-if="!providers.length && !showAddProvider">
      <CardContent class="py-8 text-center text-xs text-muted-foreground">
        还没有供应商。点击「添加供应商」开始配置。
      </CardContent>
    </Card>

    <div v-else-if="providers.length" class="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
      <div class="flex flex-col gap-1.5">
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          class="rounded-xl border border-border bg-card px-3 py-2.5 text-left"
          :class="provider.id === activeProviderId ? 'ring-1 ring-ring' : ''"
          @click="modelsStore.setActiveProvider(provider.id)"
        >
          <div class="truncate text-[13px] font-medium text-foreground">{{ provider.name }}</div>
          <div class="truncate text-[11px] text-muted-foreground">
            {{ protocolLabel(provider.protocol) }} · {{ provider.models.length }} 模型
          </div>
        </button>
      </div>

      <Card v-if="activeProvider">
        <CardHeader>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <CardTitle class="text-base">{{ activeProvider.name }}</CardTitle>
              <CardDescription class="mt-1">{{ protocolLabel(activeProvider.protocol) }}</CardDescription>
              <p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {{ activeProvider.baseUrl }}
              </p>
              <p class="mt-0.5 text-[11px] text-muted-foreground">
                Key：{{ activeProvider.apiKeyMask || "未配置" }}
              </p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="!canOperateModels || fetching"
                :title="canOperateModels ? '从 API 拉取模型列表' : '请先配置 Base URL 与 API Key'"
                @click="onLoadModels"
              >
                <Download data-icon="inline-start" />
                {{ fetching ? "拉取中…" : "模型加载" }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="!canOperateModels"
                :title="canOperateModels ? '手动添加模型' : '请先配置 Base URL 与 API Key'"
                @click="showAddModel = !showAddModel"
              >
                <Plus data-icon="inline-start" />
                添加模型
              </Button>
              <Button variant="ghost" size="sm" @click="modelsStore.removeProvider(activeProvider.id)">
                <Trash2 data-icon="inline-start" />
                删除
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <p v-if="!canOperateModels" class="m-0 text-xs text-muted-foreground">
            Base URL 与 API Key 配置完成后，才能使用「模型加载」和「添加模型」。
          </p>
          <p v-if="loadMessage" class="m-0 text-xs text-muted-foreground">{{ loadMessage }}</p>

          <form v-if="showAddModel && canOperateModels" class="flex flex-col gap-3 rounded-xl border border-border p-3" @submit.prevent="onAddModel">
            <FieldGroup>
              <Field>
                <FieldLabel for="model-id">模型 ID</FieldLabel>
                <Input id="model-id" v-model="modelForm.id" placeholder="gpt-4o / claude-sonnet-4-20250514" required />
              </Field>
              <Field>
                <FieldLabel for="model-name">显示名称（可选）</FieldLabel>
                <Input id="model-name" v-model="modelForm.name" placeholder="留空则根据 ID 推断" />
              </Field>
            </FieldGroup>
            <p class="m-0 text-[11px] text-muted-foreground">
              保存时会按官方目录/启发式自动填充推理、上下文等能力。
            </p>
            <div class="flex justify-end">
              <Button type="submit" size="sm">保存模型</Button>
            </div>
          </form>

          <Separator />

          <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="model in activeProvider.models"
              :key="model.id"
              class="flex items-stretch overflow-hidden rounded-xl border border-border"
              :class="
                selection.modelId === model.id && selection.providerId === activeProvider.id
                  ? 'ring-1 ring-ring'
                  : ''
              "
            >
              <button type="button" class="min-w-0 flex-1 px-3 py-2.5 text-left" @click="onSelectModel(model.id)">
                <div class="text-[13px] font-medium text-foreground">{{ model.name }}</div>
                <div class="truncate font-mono text-[11px] text-muted-foreground">{{ model.id }}</div>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <Badge v-if="model.capabilities?.reasoning" variant="secondary">推理</Badge>
                  <Badge v-if="model.capabilities?.vision" variant="secondary">视觉</Badge>
                  <Badge v-if="model.capabilities?.toolCall" variant="secondary">工具</Badge>
                  <Badge v-if="model.capabilities?.contextWindow" variant="outline">
                    {{ Math.round(model.capabilities.contextWindow / 1000) }}K
                  </Badge>
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                class="border-l border-border"
                aria-label="删除模型"
                @click="modelsStore.removeModel(activeProvider.id, model.id)"
              >
                <Trash2 />
              </Button>
            </li>
            <li v-if="!activeProvider.models.length" class="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              暂无模型。配置完成后可「模型加载」或「添加模型」。
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
