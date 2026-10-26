<script setup lang="ts">
import { useI18n } from "vue-i18n";

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

const { t } = useI18n();

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
  <div class="flex flex-col px-3.5 pb-2 pt-0.5">
    <div class="field-row">
      <FieldLabel class="field-row-label font-normal">{{ t("settings.models.protocol") }}</FieldLabel>
      <Select v-model="protocol">
        <SelectTrigger size="sm" class="h-8 w-full text-[13px]">
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
      <FieldLabel class="field-row-label font-normal" for="provider-name">{{ t("settings.models.name") }}</FieldLabel>
      <Input
        id="provider-name"
        v-model="name"
        class="h-8 text-[13px]"
        :placeholder="t('settings.models.namePlaceholder')"
        required
      />
    </div>
    <div class="field-row">
      <FieldLabel class="field-row-label font-normal" for="provider-base">Base URL</FieldLabel>
      <Input
        id="provider-base"
        v-model="baseUrl"
        class="h-8 font-[family-name:var(--font-mono)] text-[12px]"
        placeholder="https://api.openai.com/v1"
        required
      />
    </div>
    <div class="field-row">
      <FieldLabel class="field-row-label font-normal" for="provider-key">{{ t("settings.models.apiKey") }}</FieldLabel>
      <Input
        id="provider-key"
        v-model="apiKey"
        type="password"
        class="h-8 font-[family-name:var(--font-mono)] text-[12px]"
        :placeholder="editMode ? t('settings.models.apiKeyKeep', { mask: apiKeyMask || '••••' }) : 'sk-...'"
        :required="!editMode"
      />
    </div>
    <div class="field-row">
      <FieldLabel class="field-row-label font-normal" for="provider-ua">User-Agent</FieldLabel>
      <Input
        id="provider-ua"
        v-model="userAgent"
        class="h-8 font-[family-name:var(--font-mono)] text-[12px]"
        :placeholder="t('settings.models.userAgentPlaceholder')"
      />
    </div>
  </div>
</template>
