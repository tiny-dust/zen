<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ChevronDown, ChevronRight, Plus, Search } from "@lucide/vue";

import CapabilityLine from "@/components/settings/CapabilityLine.vue";
import VendorLogo from "@/components/brand/VendorLogo.vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useModelsStore } from "@/stores/models";

import type { CatalogModel } from "@zen/shared";

const props = defineProps<{
  open: boolean;
  knownIds?: Set<string>;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  pickCustom: [prefillId: string];
  pickTemplate: [model: CatalogModel];
}>();

const modelsStore = useModelsStore();
const query = ref("");
const expanded = ref<Set<string>>(new Set());
const allModels = ref<CatalogModel[]>([]);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) {
    return allModels.value;
  }
  return allModels.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.vendorLabel.toLowerCase().includes(q),
  );
});

const groups = computed(() => {
  const map = new Map<string, { vendor: string; label: string; models: CatalogModel[] }>();
  for (const item of filtered.value) {
    const group = map.get(item.vendor) ?? {
      vendor: item.vendor,
      label: item.vendorLabel,
      models: [],
    };
    group.models.push(item);
    map.set(item.vendor, group);
  }
  return [...map.values()];
});

function toggleGroup(vendor: string) {
  const next = new Set(expanded.value);
  if (next.has(vendor)) {
    next.delete(vendor);
  } else {
    next.add(vendor);
  }
  expanded.value = next;
}

function isKnown(model: CatalogModel) {
  return props.knownIds?.has(model.id) ?? false;
}

async function load() {
  const rows = await modelsStore.loadCatalogModels();
  allModels.value = rows;
  // 默认展开有结果的第一家
  if (!expanded.value.size && rows.length) {
    const first = rows[0];
    if (first) {
      expanded.value = new Set([first.vendor]);
    }
  }
}

watch(
  () => props.open,
  (next) => {
    if (next) {
      query.value = "";
      void load();
    }
  },
);

watch(query, () => {
  // 搜索时自动展开所有命中组
  if (!query.value.trim()) {
    return;
  }
  expanded.value = new Set(groups.value.map((g) => g.vendor));
});

onMounted(() => {
  void modelsStore.loadCatalogVendors();
});
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex w-[min(520px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-48px))] flex-col gap-0 pt-3.5"
    >
      <DialogHeader class="sr-only absolute h-px w-px overflow-hidden p-0 m-[-1px]">
        <DialogTitle>选择模型模板</DialogTitle>
      </DialogHeader>

      <div class="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <Search class="size-[15px] shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
        <Input
          v-model="query"
          class="h-7 border-0 bg-transparent p-0 text-[13px] shadow-none"
          placeholder="搜索模型..."
          @keydown.enter.prevent="emit('pickCustom', query.trim())"
        />
      </div>

      <div class="border-b border-[var(--color-line)] px-1.5 pb-2 pt-1.5">
        <button
          type="button"
          class="flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left hover:bg-[var(--color-menu-hover)]"
          @click="emit('pickCustom', query.trim())"
        >
          <Plus class="mt-0.5 size-4 shrink-0 text-[var(--color-mut)]" />
          <div>
            <div class="text-[13px] text-[var(--color-txt-strong)]">添加自定义模型</div>
            <p class="m-0 mt-0.5 text-[12px] text-[var(--color-mut)]">
              从空白配置开始；搜索内容会预填为模型 ID。
            </p>
          </div>
        </button>
        <div class="px-2.5 pb-1 pt-2">
          <div class="text-[12px] text-[var(--color-txt-strong)]">使用模板创建</div>
          <p class="m-0 mt-0.5 text-[11.5px] text-[var(--color-mut)]">
            选择预设配置作为起点，保存前仍可修改所有字段。
          </p>
        </div>
      </div>

      <div class="max-h-[min(420px,55vh)] overflow-auto px-1.5 pb-2.5 pt-1">
        <div v-for="group in groups" :key="group.vendor">
          <button
            type="button"
            class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--color-menu-hover)]"
            @click="toggleGroup(group.vendor)"
          >
            <ChevronDown
              v-if="expanded.has(group.vendor)"
              class="size-3.5 shrink-0 text-[var(--color-mut)]"
            />
            <ChevronRight v-else class="size-3.5 shrink-0 text-[var(--color-mut)]" />
            <VendorLogo :vendor="group.vendor" :size="18" />
            <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--color-txt-strong)]">
              {{ group.label }}
            </span>
            <span class="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]">
              {{ group.models.length }}
            </span>
          </button>
          <div v-if="expanded.has(group.vendor)" class="flex flex-col gap-0.5 pb-1.5 pl-[22px] pt-0.5">
            <button
              v-for="model in group.models"
              :key="model.modelKey"
              type="button"
              class="flex w-full flex-col items-start gap-[3px] rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-menu-hover)] disabled:hover:bg-transparent"
              :class="isKnown(model) ? 'opacity-50' : ''"
              :disabled="isKnown(model)"
              @click="emit('pickTemplate', model)"
            >
              <div class="flex items-center gap-1.5 text-[13px] text-[var(--color-txt-strong)]">
                {{ model.name }}
                <span v-if="isKnown(model)" class="text-[11px] text-[var(--color-mut)]">已添加</span>
              </div>
              <div class="font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--color-mut)]">
                {{ model.id }}
              </div>
              <CapabilityLine :capabilities="model.capabilities" />
            </button>
          </div>
        </div>
        <p v-if="!groups.length" class="m-0 px-2.5 py-3 text-[12px] text-[var(--color-mut)]">
          无匹配模型，可直接添加自定义模型
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
