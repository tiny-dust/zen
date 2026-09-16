<script setup lang="ts">
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVIDER_PROTOCOLS } from "@zen/shared";

import type { ProviderProtocol } from "@zen/shared";

const name = defineModel<string>("name", { required: true });
const protocol = defineModel<ProviderProtocol>("protocol", { required: true });
const baseUrl = defineModel<string>("baseUrl", { required: true });
const apiKey = defineModel<string>("apiKey", { required: true });
const userAgent = defineModel<string>("userAgent", { required: true });

defineProps<{
  editMode: boolean;
  apiKeyMask?: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-3 px-3.5 pb-2 pt-0.5">
    <div class="flex flex-col gap-1.5">
      <FieldLabel class="text-[12px] text-[var(--color-mut)]">消息协议</FieldLabel>
      <Select v-model="protocol">
        <SelectTrigger size="sm" class="h-9 w-full rounded-[10px] text-[13px]">
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
      <FieldLabel class="text-[12px] text-[var(--color-mut)]" for="provider-name">名称</FieldLabel>
      <Input
        id="provider-name"
        v-model="name"
        class="h-9 rounded-[10px] text-[13px]"
        placeholder="OpenAI / DeepSeek / 本地"
        required
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <FieldLabel class="text-[12px] text-[var(--color-mut)]" for="provider-base">Base URL</FieldLabel>
      <Input
        id="provider-base"
        v-model="baseUrl"
        class="h-9 rounded-[10px] text-[13px]"
        placeholder="https://api.openai.com/v1"
        required
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <FieldLabel class="text-[12px] text-[var(--color-mut)]" for="provider-key">API 密钥</FieldLabel>
      <Input
        id="provider-key"
        v-model="apiKey"
        type="password"
        class="h-9 rounded-[10px] text-[13px]"
        :placeholder="editMode ? `${apiKeyMask || '••••'}（留空保持不变）` : 'sk-...'"
        :required="!editMode"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <FieldLabel class="text-[12px] text-[var(--color-mut)]" for="provider-ua">User-Agent</FieldLabel>
      <Input
        id="provider-ua"
        v-model="userAgent"
        class="h-9 rounded-[10px] text-[13px]"
        placeholder="留空则使用 zen-desktop"
      />
    </div>
  </div>
</template>
