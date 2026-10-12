<script setup lang="ts">
import { useI18n } from "vue-i18n";

import CapabilityLine from "@/components/settings/CapabilityLine.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import type { ModelCapabilities } from "@zen/shared";

const props = defineProps<{
  rows: Array<{ id: string; name: string; capabilities?: ModelCapabilities }>;
  checkedIds: Set<string>;
  knownIds: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [id: string, next: boolean];
  all: [];
  clear: [];
  add: [];
}>();

const { t } = useI18n();

function isKnown(id: string) {
  return props.knownIds.has(id);
}
</script>

<template>
  <div class="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-np-btn-bg)]">
    <div class="flex items-center justify-between gap-2 border-b border-[var(--color-line-soft)] px-2.5 py-2 text-[11px] text-[var(--color-mut)]">
      <span>{{ t("settings.models.fetchedCount", { count: rows.length }) }}</span>
      <span class="flex gap-2.5">
        <Button variant="link" class="h-auto px-0 text-[11px] font-normal text-[var(--color-link)]" @click="emit('all')">{{ t("settings.models.selectAll") }}</Button>
        <Button variant="link" class="h-auto px-0 text-[11px] font-normal text-[var(--color-link)]" @click="emit('clear')">{{ t("settings.models.clearAll") }}</Button>
      </span>
    </div>
    <div class="max-h-[220px] overflow-auto">
      <label
        v-for="item in rows"
        :key="item.id"
        class="flex cursor-pointer items-start gap-2 px-2.5 py-[7px] hover:bg-[var(--color-menu-hover)]"
        :class="isKnown(item.id) ? 'opacity-55' : ''"
      >
        <Checkbox
          :model-value="checkedIds.has(item.id) || isKnown(item.id)"
          :disabled="isKnown(item.id)"
          class="mt-0.5"
          @update:model-value="(next) => emit('toggle', item.id, next === true)"
        />
        <span class="max-w-[55%] shrink-0 truncate text-[12px] text-[var(--color-txt-strong)]">{{ item.name }}</span>
        <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-dim)]">{{ item.id }}</span>
        <CapabilityLine :capabilities="item.capabilities" />
        <span v-if="isKnown(item.id)" class="shrink-0 text-[10px] text-[var(--color-mut)]">{{ t("settings.models.addedTag") }}</span>
      </label>
    </div>
    <div class="flex justify-end border-t border-[var(--color-line-soft)] px-2.5 py-2">
      <Button size="sm" :disabled="!checkedIds.size" @click="emit('add')">
        {{ t("settings.models.addSelected", { count: checkedIds.size }) }}
      </Button>
    </div>
  </div>
</template>
