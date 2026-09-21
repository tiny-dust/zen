<script setup lang="ts">
import { Check, History, Search } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { classes } from "rattail";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VendorLogo from "@/components/brand/VendorLogo.vue";
import { useModelsStore } from "@/stores/models";

const props = defineProps<{
  /** 小屏底栏：只显示厂商 icon，完整名称进 title */
  compact?: boolean;
}>();

const modelsStore = useModelsStore();
const { providers, selection, selectedLabel } = storeToRefs(modelsStore);

const open = ref(false);
const query = ref("");
const activeTab = ref<"model" | "sub" | "external">("model");
const activeProviderId = ref<string | "recent" | null>(null);
const recentKeys = ref<string[]>([]);
const rootEl = ref<HTMLElement | null>(null);
const searchEl = ref<InstanceType<typeof Input> | null>(null);

const enabledGroups = computed(() =>
  providers.value
    .map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models.filter((m) => m.enabled),
    }))
    .filter((g) => g.models.length > 0),
);

const allModels = computed(() =>
  enabledGroups.value.flatMap((g) =>
    g.models.map((m) => ({ providerId: g.id, providerName: g.name, model: m })),
  ),
);

const recentModels = computed(() => {
  const map = new Map(
    allModels.value.map((item) => [`${item.providerId}:${item.model.id}`, item]),
  );
  return recentKeys.value
    .map((key) => map.get(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 6);
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  let list = allModels.value;
  if (activeProviderId.value && activeProviderId.value !== "recent") {
    list = list.filter((item) => item.providerId === activeProviderId.value);
  } else if (activeProviderId.value === "recent") {
    list = recentModels.value;
  }
  if (!q) {
    return list;
  }
  return list.filter(
    (item) =>
      item.model.name.toLowerCase().includes(q) ||
      item.model.id.toLowerCase().includes(q) ||
      item.providerName.toLowerCase().includes(q),
  );
});

const selectedKey = computed(() => {
  if (!selection.value.providerId || !selection.value.modelId) {
    return "";
  }
  return `${selection.value.providerId}:${selection.value.modelId}`;
});

function itemKey(providerId: string, modelId: string) {
  return `${providerId}:${modelId}`;
}

function isSelected(providerId: string, modelId: string) {
  return selectedKey.value === itemKey(providerId, modelId);
}

function railClass(id: string | "recent") {
  return classes(
    "flex min-h-[30px] items-center gap-2 rounded-lg px-2 text-left text-[12px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]",
    [activeProviderId.value === id, "bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]"],
  );
}

async function pick(providerId: string, modelId: string) {
  await modelsStore.select(providerId, modelId);
  const key = itemKey(providerId, modelId);
  recentKeys.value = [key, ...recentKeys.value.filter((k) => k !== key)].slice(0, 8);
  open.value = false;
}

function selectProvider(id: string | "recent" | null) {
  activeProviderId.value = id;
  query.value = "";
}

function toggleOpen() {
  open.value = !open.value;
  if (open.value) {
    void modelsStore.refresh();
    if (!activeProviderId.value && selection.value.providerId) {
      activeProviderId.value = selection.value.providerId;
    }
    void nextTick(() => searchEl.value?.focus());
  }
}

function onDocClick(event: MouseEvent) {
  const el = rootEl.value;
  if (el && !el.contains(event.target as Node)) {
    open.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  document.removeEventListener("keydown", onKeydown);
});

watch(providers, () => {
  if (open.value && !activeProviderId.value && enabledGroups.value[0]) {
    activeProviderId.value = enabledGroups.value[0].id;
  }
});
</script>

<template>
  <div ref="rootEl" class="relative min-w-0">
    <Button
      variant="ghost"
      class="inline-flex items-center rounded-lg text-[var(--color-txt-strong)] hover:bg-[var(--color-menu-hover)] disabled:cursor-not-allowed disabled:opacity-55"
      :class="compact ? 'size-7 justify-center' : 'max-w-[220px] gap-1.5 px-1.5 py-1 text-[12px]'"
      :disabled="!enabledGroups.length"
      :title="selection.model?.name || selectedLabel"
      :aria-label="`模型：${selection.model?.name || selectedLabel}`"
      @click="toggleOpen"
    >
      <VendorLogo
        :vendor="selection.provider?.name || selection.model?.id"
        :size="compact ? 16 : 16"
      />
      <span v-if="!compact" class="truncate font-medium">{{ selection.model?.name || selectedLabel }}</span>
      <svg
        v-if="!compact"
        class="size-3 shrink-0 text-[var(--color-mut)]"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </Button>

    <div
      v-if="open"
      class="absolute bottom-[calc(100%+8px)] left-0 z-[var(--z-popup)] w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] shadow-[var(--shadow-menu)]"
      role="listbox"
      aria-label="选择模型"
    >
      <div class="flex gap-3.5 border-b border-[var(--color-line)] px-3.5 pt-2.5">
        <Button
          v-for="tab in [
            { id: 'model', label: '模型' },
            { id: 'sub', label: '子代理' },
            { id: 'external', label: '外部 agent' },
          ]"
          :key="tab.id"
          variant="ghost"
          class="relative h-auto rounded-none px-0 pb-2 text-[12.5px] font-normal hover:bg-transparent"
          :class="
            activeTab === tab.id
              ? 'font-semibold text-[var(--color-txt-strong)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-t after:bg-[var(--color-accent)] after:content-\'\']'
              : 'text-[var(--color-mut)]'
          "
          @click="activeTab = tab.id as typeof activeTab"
        >
          {{ tab.label }}
        </Button>
      </div>

      <template v-if="activeTab === 'model'">
        <div class="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
          <Search class="size-3.5 shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
          <Input
            ref="searchEl"
            v-model="query"
            variant="ghost"
            class="h-6 min-w-0 flex-1 text-[12.5px] text-[var(--color-txt-strong)] placeholder:text-[var(--color-dim)]"
            type="search"
            placeholder="搜索模型..."
          />
        </div>

        <div class="grid min-h-[220px] max-h-[320px] grid-cols-[168px_minmax(0,1fr)]">
          <nav class="flex flex-col gap-0.5 overflow-auto border-r border-[var(--color-line)] bg-[var(--color-sunken)] p-1.5" aria-label="供应商">
            <Button variant="ghost" :class="railClass('recent')" @click="selectProvider('recent')">
              <History class="size-4 shrink-0 text-[var(--color-mut)]" aria-hidden="true" />
              <span class="truncate font-normal">最近使用</span>
            </Button>
            <Button
              v-for="group in enabledGroups"
              :key="group.id"
              variant="ghost"
              :class="railClass(group.id)"
              @click="selectProvider(group.id)"
            >
              <VendorLogo :vendor="group.name" :size="16" />
              <span class="truncate font-normal">{{ group.name }}</span>
            </Button>
          </nav>

          <div class="overflow-auto p-1.5">
            <Button
              v-for="item in filtered"
              :key="itemKey(item.providerId, item.model.id)"
              variant="ghost"
              class="flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-normal hover:bg-[var(--color-menu-hover)]"
              :class="
                isSelected(item.providerId, item.model.id)
                  ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                  : 'text-[var(--color-txt)]'
              "
              @click="pick(item.providerId, item.model.id)"
            >
              <Check
                class="size-3.5 shrink-0 text-[var(--color-accent)]"
                :class="isSelected(item.providerId, item.model.id) ? '' : 'invisible'"
                aria-hidden="true"
              />
              <span class="truncate">{{ item.model.name }}</span>
              <span
                v-if="item.model.custom"
                class="shrink-0 rounded-full border border-[var(--color-line-strong)] px-1.5 text-[10px] font-normal text-[var(--color-mut)]"
              >
                自定义
              </span>
            </Button>
            <p v-if="!filtered.length" class="m-0 px-3 py-4 text-center text-[12px] text-[var(--color-mut)]">
              无匹配模型
            </p>
          </div>
        </div>
      </template>

      <div v-else class="m-0 px-3 py-4 text-center text-[12px] text-[var(--color-mut)]">
        {{ activeTab === "sub" ? "暂无子代理" : "暂无外部 agent" }}
      </div>
    </div>
  </div>
</template>
