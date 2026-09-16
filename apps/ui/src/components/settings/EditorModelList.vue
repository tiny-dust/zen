<script setup lang="ts">
import CapabilityLine from "@/components/settings/CapabilityLine.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";

import type { ProviderModel } from "@zen/shared";

defineProps<{
  models: ProviderModel[];
  editMode: boolean;
}>();

const emit = defineEmits<{
  remove: [model: ProviderModel];
}>();
</script>

<template>
  <div class="border-t border-[var(--color-line)] px-1.5 pb-2 pt-1.5">
    <div class="flex items-center gap-1.5 px-2 pb-1.5 pt-0.5">
      <span class="text-[12px] text-[var(--color-mut)]">已配置模型</span>
      <span class="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]">{{ models.length }}</span>
    </div>
    <ul v-if="models.length" class="m-0 flex list-none flex-col gap-0.5 p-0">
      <li
        v-for="model in models"
        :key="model.id"
        class="flex items-center gap-0.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-menu-hover)]"
      >
        <div class="flex min-h-[var(--control-h)] min-w-0 flex-1 items-center gap-2 px-2">
          <span class="max-w-[40%] shrink-0 truncate text-[12.5px] text-[var(--color-txt-strong)]">{{ model.name }}</span>
          <span
            v-if="model.custom"
            class="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] px-1.5 text-[10px] text-[var(--color-accent)]"
          >
            自定义
          </span>
          <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]">{{ model.id }}</span>
          <CapabilityLine :capabilities="model.capabilities" />
        </div>
        <DangerIconButton
          :label="editMode ? '删除模型' : '移除待添加模型'"
          @click="emit('remove', model)"
        />
      </li>
    </ul>
    <p v-else class="m-0 p-2 text-[12px] text-[var(--color-mut)]">暂无模型，可用「刷新模型」勾选或「手动添加」。</p>
  </div>
</template>
