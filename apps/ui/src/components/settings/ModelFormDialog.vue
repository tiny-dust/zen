<script setup lang="ts">
import { computed, reactive, watch } from "vue";

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
  form.media = Boolean(source?.media);
  form.contextWindow = source?.contextWindow ?? 128000;
  form.maxOutputTokens = source?.maxOutputTokens ?? 8192;
  form.chatEndpoint = source?.chatEndpoint ?? "auto";
  // 强度档位独立于「推理」开关读取：用户勾过就必须回显，不能被开关吞掉
  form.efforts = new Set((source?.reasoningEfforts ?? []).filter((e) => e !== "off"));
  form.reasoning = Boolean(source?.reasoning) || form.efforts.size > 0;
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
  // 勾选强度即视为开启推理，保存时不会再被 reasoning 开关丢掉
  if (next.size > 0) {
    form.reasoning = true;
  }
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
    // 只要勾过强度就落库；不依赖 reasoning 开关，避免保存后回显全关
    reasoningEfforts: efforts.length ? efforts : undefined,
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
    if (on) {
      if (!form.efforts.size) {
        form.efforts = new Set<ReasoningEffort>(["low", "medium", "high"]);
      }
      return;
    }
    form.efforts = new Set();
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

      <div class="flex flex-col">
        <div class="field-row">
          <Label class="field-row-label font-normal" for="mf-id">模型 ID</Label>
          <Input
            id="mf-id"
            v-model="form.id"
            class="h-8 font-[family-name:var(--font-mono)] text-[12.5px]"
            placeholder="deepseek-v4-flash"
          />
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal" for="mf-name">显示名称</Label>
          <Input
            id="mf-name"
            v-model="form.name"
            class="h-8 text-[13px]"
            placeholder="DeepSeek V4 Flash"
          />
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal" for="mf-ctx">上下文长度</Label>
          <Input
            id="mf-ctx"
            v-model.number="form.contextWindow"
            type="number"
            min="0"
            step="1000"
            class="h-8 text-[13px]"
          />
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal" for="mf-out">最大输出</Label>
          <Input
            id="mf-out"
            v-model.number="form.maxOutputTokens"
            type="number"
            min="0"
            step="1000"
            class="h-8 text-[13px]"
          />
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal">对话端点</Label>
          <Select v-model="form.chatEndpoint">
            <SelectTrigger class="h-8 w-full text-[13px]">
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
        <div class="field-row">
          <Label class="field-row-label font-normal">工具调用</Label>
          <div class="flex justify-end">
            <Switch v-model="form.toolCall" aria-label="工具调用" />
          </div>
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal">视觉</Label>
          <div class="flex justify-end">
            <Switch v-model="form.vision" aria-label="视觉" />
          </div>
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal">推理</Label>
          <div class="flex justify-end">
            <Switch v-model="form.reasoning" aria-label="推理" />
          </div>
        </div>
        <div class="field-row">
          <Label class="field-row-label font-normal">媒体能力</Label>
          <div class="flex justify-end">
            <Switch v-model="form.media" aria-label="媒体能力" />
          </div>
        </div>
        <div class="field-row">
          <span class="field-row-label font-normal">思考强度</span>
          <div class="flex flex-wrap gap-1.5">
            <Button
              v-for="opt in EFFORT_CHIPS"
              :key="opt.id"
              variant="ghost"
              class="h-auto min-h-[26px] rounded-lg border px-2.5 text-[12px] font-normal"
              :class="
                isEffortActive(opt.id)
                  ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-txt-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]'
                  : 'border-[var(--color-line)] bg-[var(--color-np-btn-bg)] text-[var(--color-txt)] hover:bg-[var(--color-np-btn-bg)] dark:hover:bg-[var(--color-np-btn-bg)]'
              "
              @click="toggleEffort(opt.id)"
            >
              {{ opt.label }}
            </Button>
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
