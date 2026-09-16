<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import CapabilityBadge from "@/components/settings/CapabilityBadge.vue";
import VendorLogo from "@/components/brand/VendorLogo.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  MODEL_CHAT_ENDPOINTS,
  PROVIDER_PROTOCOLS,
  REASONING_EFFORTS,
} from "@zen/shared";

import type {
  CatalogModel,
  ModelCapabilities,
  ModelChatEndpoint,
  ProviderProtocol,
  ReasoningEffort,
} from "@zen/shared";

const props = defineProps<{
  open: boolean;
  providerName: string;
  /** 从目录模板带入的初始值 */
  template?: CatalogModel | null;
  /** 纯自定义（搜索预填 ID） */
  presetId?: string;
  /** 编辑已有模型时的初始值 */
  initial?: {
    id: string;
    name: string;
    custom?: boolean;
    capabilities?: ModelCapabilities;
  } | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  save: [payload: {
    id: string;
    name: string;
    custom: boolean;
    capabilities: ModelCapabilities;
  }];
}>();

const form = reactive({
  id: "",
  name: "",
  contextWindow: 128000,
  maxOutputTokens: 8192,
  chatEndpoint: "auto" as ModelChatEndpoint,
  toolCall: true,
  vision: false,
  reasoning: false,
  media: false,
  efforts: new Set<ReasoningEffort>(),
});

const subtitle = computed(() => {
  if (props.initial) {
    return `${props.providerName} / ${props.initial.id}`;
  }
  if (form.id) {
    return `${props.providerName} / ${form.id}`;
  }
  return props.providerName;
});

const EFFORT_CHIPS = REASONING_EFFORTS;

function applyCapabilities(source?: ModelCapabilities) {
  form.toolCall = Boolean(source?.toolCall ?? true);
  form.vision = Boolean(source?.vision);
  form.reasoning = Boolean(source?.reasoning);
  form.media = Boolean(source?.media);
  form.contextWindow = source?.contextWindow ?? 128000;
  form.maxOutputTokens = source?.maxOutputTokens ?? 8192;
  form.chatEndpoint = source?.chatEndpoint ?? "auto";
  form.efforts = new Set((source?.reasoningEfforts ?? []).filter((e) => e !== "off"));
  if (form.reasoning && !form.efforts.size) {
    form.efforts = new Set<ReasoningEffort>(["low", "medium", "high"]);
  }
}

function resetFromProps() {
  if (props.initial) {
    form.id = props.initial.id;
    form.name = props.initial.name;
    applyCapabilities(props.initial.capabilities);
    return;
  }
  if (props.template) {
    form.id = props.template.id;
    form.name = props.template.name;
    applyCapabilities(props.template.capabilities);
    return;
  }
  form.id = props.presetId ?? "";
  form.name = "";
  applyCapabilities(undefined);
}

function toggleEffort(id: ReasoningEffort) {
  const next = new Set(form.efforts);
  if (id === "off") {
    next.clear();
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  form.efforts = next;
}

function isEffortActive(id: ReasoningEffort): boolean {
  if (id === "off") {
    return form.efforts.size === 0;
  }
  return form.efforts.has(id);
}

function buildCapabilities(): ModelCapabilities {
  const efforts = [...form.efforts];
  return {
    toolCall: form.toolCall || undefined,
    vision: form.vision || undefined,
    reasoning: form.reasoning || undefined,
    media: form.media || undefined,
    contextWindow: form.contextWindow > 0 ? form.contextWindow : undefined,
    maxOutputTokens: form.maxOutputTokens > 0 ? form.maxOutputTokens : undefined,
    chatEndpoint: form.chatEndpoint === "auto" ? undefined : form.chatEndpoint,
    reasoningEfforts: form.reasoning && efforts.length ? efforts : undefined,
    source: "manual",
  };
}

function onSubmit() {
  const id = form.id.trim();
  if (!id) {
    return;
  }
  emit("save", {
    id,
    name: form.name.trim() || id,
    custom: Boolean(props.initial?.custom ?? !props.template),
    capabilities: buildCapabilities(),
  });
  emit("update:open", false);
}

watch(
  () => props.open,
  (next) => {
    if (next) {
      resetFromProps();
    }
  },
  { immediate: true },
);

watch(
  () => form.reasoning,
  (on) => {
    if (on && !form.efforts.size) {
      form.efforts = new Set<ReasoningEffort>(["low", "medium", "high"]);
    }
  },
);

function protocolOptions() {
  return MODEL_CHAT_ENDPOINTS.filter(
    (item) => item.id === "auto" || PROVIDER_PROTOCOLS.some((p) => p.id === item.id),
  );
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex w-[min(560px,calc(100vw-32px))] flex-col gap-3">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <span>{{ initial ? "编辑模型" : "添加模型" }}</span>
          <VendorLogo :vendor="template?.vendor || form.id || providerName" :size="18" />
        </DialogTitle>
        <DialogDescription class="mt-0.5 font-[family-name:var(--font-mono)] text-[11.5px]">
          {{ subtitle }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label class="text-[12px] text-[var(--color-mut)]" for="mf-id">模型 ID</Label>
            <Input
              id="mf-id"
              v-model="form.id"
              class="h-9 rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]"
              placeholder="deepseek-v4-flash"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-[12px] text-[var(--color-mut)]" for="mf-name">显示名称</Label>
            <Input
              id="mf-name"
              v-model="form.name"
              class="h-9 rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]"
              placeholder="DeepSeek V4 Flash"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label class="text-[12px] text-[var(--color-mut)]" for="mf-ctx">上下文长度</Label>
            <Input
              id="mf-ctx"
              v-model.number="form.contextWindow"
              type="number"
              min="0"
              step="1000"
              class="h-9 rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label class="text-[12px] text-[var(--color-mut)]" for="mf-out">最大输出</Label>
            <Input
              id="mf-out"
              v-model.number="form.maxOutputTokens"
              type="number"
              min="0"
              step="1000"
              class="h-9 rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label class="text-[12px] text-[var(--color-mut)]">对话端点</Label>
          <Select v-model="form.chatEndpoint">
            <SelectTrigger class="h-9 rounded-[10px] bg-[var(--color-np-btn-bg)] text-[13px]">
              <SelectValue placeholder="自动" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="item in protocolOptions()"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <label
            class="flex min-h-[42px] cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-3 text-[13px] text-[var(--color-txt-strong)]"
          >
            <span>工具</span>
            <Switch v-model="form.toolCall" />
          </label>
          <label
            class="flex min-h-[42px] cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-3 text-[13px] text-[var(--color-txt-strong)]"
          >
            <span>视觉</span>
            <Switch v-model="form.vision" />
          </label>
          <label
            class="flex min-h-[42px] cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] px-3 text-[13px] text-[var(--color-txt-strong)]"
          >
            <span>推理</span>
            <Switch v-model="form.reasoning" />
          </label>
        </div>

        <div
          class="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] p-3"
        >
          <div>
            <div class="text-[13px] text-[var(--color-txt-strong)]">媒体能力</div>
            <p class="m-0 mt-0.5 text-[11.5px] text-[var(--color-mut)]">
              选择该模型可用于哪些媒体操作。
            </p>
          </div>
          <Switch v-model="form.media" />
        </div>

        <div>
          <div class="mb-2 text-[12px] text-[var(--color-mut)]">思考强度</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="opt in EFFORT_CHIPS"
              :key="opt.id"
              type="button"
              class="min-h-[30px] rounded-lg border px-3 text-[12.5px]"
              :class="
                isEffortActive(opt.id)
                  ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-txt-strong)]'
                  : 'border-[var(--color-line)] bg-[var(--color-np-btn-bg)] text-[var(--color-txt)]'
              "
              @click="toggleEffort(opt.id)"
            >
              {{ opt.label }}
            </button>
          </div>
          <div v-if="form.reasoning" class="mt-2 flex flex-wrap gap-1">
            <CapabilityBadge
              v-for="item in [...form.efforts]"
              :key="item"
              :label="REASONING_EFFORTS.find((e) => e.id === item)?.label ?? item"
              tone="accent"
            />
          </div>
        </div>
      </div>

      <footer class="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" @click="emit('update:open', false)">取消</Button>
        <Button size="sm" :disabled="!form.id.trim()" @click="onSubmit">保存</Button>
      </footer>
    </DialogContent>
  </Dialog>
</template>
