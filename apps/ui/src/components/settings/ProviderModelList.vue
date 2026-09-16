<script setup lang="ts">
import { computed, ref } from "vue";
import { Pencil, Plus, RefreshCw, Search } from "@lucide/vue";
import { classes } from "rattail";

import VendorLogo from "@/components/brand/VendorLogo.vue";
import CapabilityLine from "@/components/settings/CapabilityLine.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import type { ProviderModel } from "@zen/shared";

const props = defineProps<{
  models: ProviderModel[];
  providerId: string;
  selectionProviderId: string | null;
  selectionModelId: string | null;
  fetching?: boolean;
}>();

const emit = defineEmits<{
  select: [modelId: string];
  toggleEnabled: [model: ProviderModel, enabled: boolean];
  edit: [model: ProviderModel];
  refresh: [];
  add: [];
}>();

const query = ref("");

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) {
    return props.models;
  }
  return props.models.filter(
    (item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
  );
});

const enabledCount = computed(() => props.models.filter((item) => item.enabled).length);

function rowClass(model: ProviderModel) {
  const selected =
    props.selectionProviderId === props.providerId && props.selectionModelId === model.id;
  return classes(
    "flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-input-bg)] px-2.5 py-2 hover:border-[var(--color-line-strong)]",
    [selected, "border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-line))]"],
    [!model.enabled, "opacity-55"],
  );
}

function onSelect(model: ProviderModel) {
  if (!model.enabled) {
    return;
  }
  emit("select", model.id);
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2 pt-2.5 pb-1">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[12.5px] text-[var(--color-txt-strong)]">
        模型 · {{ enabledCount }}/{{ models.length }}
      </span>
      <div class="flex items-center gap-1">
        <Button variant="outline" size="sm" @click="emit('add')">
          <Plus data-icon="inline-start" />
          添加模型
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新模型"
          :disabled="fetching"
          @click="emit('refresh')"
        >
          <RefreshCw :class="fetching ? 'animate-spin' : ''" />
        </Button>
      </div>
    </div>

    <div class="flex h-9 items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-input-bg)] px-3">
      <Search class="size-3.5 shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
      <Input
        v-model="query"
        class="h-8 border-0 bg-transparent p-0 text-[12.5px] shadow-none"
        placeholder="搜索模型名称或 ID"
      />
    </div>

    <ul v-if="filtered.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
      <li v-for="model in filtered" :key="model.id" :class="rowClass(model)">
        <button
          type="button"
          class="min-w-0 flex-1 text-left disabled:cursor-default"
          :disabled="!model.enabled"
          @click="onSelect(model)"
        >
          <div class="flex min-w-0 items-center gap-2">
            <VendorLogo :vendor="model.id" :size="16" />
            <span class="truncate text-[13px] font-semibold text-[var(--color-txt-strong)]">
              {{ model.name }}
            </span>
            <span
              v-if="model.custom"
              class="shrink-0 rounded-full border border-[var(--color-line-strong)] px-1.5 text-[10px] text-[var(--color-mut)]"
            >
              自定义
            </span>
            <CapabilityLine :capabilities="model.capabilities" show-limits class="min-w-0" />
          </div>
        </button>
        <Switch
          class="shrink-0 scale-90"
          :model-value="model.enabled"
          aria-label="启用模型"
          @update:model-value="(next) => emit('toggleEnabled', model, next === true)"
        />
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
          aria-label="编辑模型"
          title="编辑模型"
          @click="emit('edit', model)"
        >
          <Pencil class="size-3.5" />
        </button>
      </li>
    </ul>
    <p v-else class="m-0 p-3 text-center text-[12px] text-[var(--color-mut)]">无匹配模型</p>
  </section>
</template>
