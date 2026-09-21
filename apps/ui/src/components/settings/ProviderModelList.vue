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
    "list-row w-full text-[var(--color-txt)] transition-colors",
    [selected, "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"],
    [!model.enabled, "opacity-55"],
    [!selected && model.enabled, "hover:bg-[var(--color-menu-hover)]"],
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

    <div class="relative">
      <Search
        class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-mut)]"
        aria-hidden="true"
      />
      <Input
        v-model="query"
        class="h-8 pl-7 text-[12.5px]"
        placeholder="搜索模型名称或 ID"
      />
    </div>

    <ul v-if="filtered.length" class="m-0 flex list-none flex-col p-0">
      <li v-for="model in filtered" :key="model.id" :class="rowClass(model)">
        <Button
          variant="ghost"
          class="h-full flex min-w-0 flex-1 items-center gap-2 px-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
          :disabled="!model.enabled"
          @click="onSelect(model)"
        >
          <VendorLogo :vendor="model.id" :size="16" />
          <span class="truncate text-[12.5px] font-medium text-[var(--color-txt-strong)]">
            {{ model.name }}
          </span>
          <span
            v-if="model.custom"
            class="shrink-0 rounded-full border border-[var(--color-line-strong)] px-1.5 text-[10px] text-[var(--color-mut)]"
          >
            自定义
          </span>
          <span
            v-if="model.id !== model.name"
            class="min-w-0 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]"
          >
            {{ model.id }}
          </span>
        </Button>
        <CapabilityLine :capabilities="model.capabilities" show-limits class="shrink-0" />
        <Switch
          class="shrink-0 scale-90"
          :model-value="model.enabled"
          aria-label="启用模型"
          @update:model-value="(next) => emit('toggleEnabled', model, next === true)"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
          aria-label="编辑模型"
          title="编辑模型"
          @click="emit('edit', model)"
        >
          <Pencil class="size-3.5" />
        </Button>
      </li>
    </ul>
    <p v-else class="m-0 p-3 text-center text-[12px] text-[var(--color-mut)]">无匹配模型</p>
  </section>
</template>
