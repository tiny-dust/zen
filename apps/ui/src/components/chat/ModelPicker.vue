<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useModelsStore } from "@/stores/models";

const modelsStore = useModelsStore();
const { providers, selection, selectedLabel } = storeToRefs(modelsStore);

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const grouped = computed(() => {
  return providers.value.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models,
  }));
});

function onDocClick(event: MouseEvent) {
  const root = rootEl.value;
  if (root && event.target instanceof Node && !root.contains(event.target)) {
    open.value = false;
  }
}

onMounted(() => {
  void modelsStore.refresh();
  document.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
});

async function pick(providerId: string, modelId: string) {
  await modelsStore.select(providerId, modelId);
  open.value = false;
}
</script>

<template>
  <div ref="rootEl" class="model-picker">
    <button type="button" class="trigger" :disabled="!providers.length" @click="open = !open">
      <span class="label">{{ selectedLabel }}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="menu" role="listbox" aria-label="选择模型">
      <div v-if="!grouped.length" class="empty">请先在设置中配置模型供应</div>
      <div v-for="group in grouped" :key="group.id" class="group">
        <div class="group-title">{{ group.name }}</div>
        <button
          v-for="model in group.models"
          :key="model.id"
          type="button"
          class="item"
          :class="{
            'is-active':
              selection.providerId === group.id && selection.modelId === model.id,
          }"
          role="option"
          @click="pick(group.id, model.id)"
        >
          <span class="item-name">{{ model.name }}</span>
          <span class="item-id">{{ model.id }}</span>
        </button>
        <div v-if="!group.models.length" class="group-empty">暂无模型</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-picker {
  position: relative;
  min-width: 0;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-btn-border);
  background: var(--color-input-bg);
  color: var(--color-txt);
  font-size: 12px;
}

.trigger:hover:not(:disabled) {
  background: var(--color-menu-hover);
}

.trigger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chev {
  color: var(--color-mut);
  font-size: 10px;
}

.menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 30;
  width: min(320px, 70vw);
  max-height: 280px;
  overflow: auto;
  padding: 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-set-card);
  box-shadow: var(--shadow-menu);
}

.empty,
.group-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-mut);
}

.group + .group {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-line-soft);
}

.group-title {
  padding: 4px 8px 6px;
  font-size: 11px;
  color: var(--color-mut);
  font-weight: 600;
}

.item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
  color: var(--color-txt);
}

.item:hover {
  background: var(--color-menu-hover);
}

.item.is-active {
  background: var(--color-side-sel);
}

.item-name {
  font-size: 12px;
  color: var(--color-txt-strong);
}

.item-id {
  font-size: 10px;
  color: var(--color-dim);
  font-family: var(--font-mono);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
