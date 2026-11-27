<script setup lang="ts">
import { IconStack2 as Layers } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import SectionHeader from "@/components/settings/sections/SectionHeader.vue";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelsStore } from "@/stores/models";
import { useSettingsStore } from "@/stores/settings";

import type { PhaseModelRef } from "@zen/shared";

/**
 * 阶段模型：Plan（计划）/ Act（执行）两个全局默认模型。
 * 生效优先级：会话阶段覆盖 → 这里的全局默认 → 会话模型（含自动路由）。
 * 未指定时不改变既有行为。
 */
const { t } = useI18n();
const modelsStore = useModelsStore();
const settingsStore = useSettingsStore();
const { enabledModels } = storeToRefs(modelsStore);

/** 「不指定」哨兵值：shadcn Select 的 value 只接受字符串 */
const INHERIT = "__inherit__";

const options = computed(() =>
  enabledModels.value.map(({ provider, model }) => {
    const ref: PhaseModelRef = { providerId: provider.id, modelId: model.id };
    return {
      key: keyOf(ref),
      ref,
      label: t("settings.models.phaseOptionLabel", { provider: provider.name, model: model.name }),
    };
  }),
);

function keyOf(ref: PhaseModelRef | null | undefined): string {
  return ref ? JSON.stringify([ref.providerId, ref.modelId]) : INHERIT;
}

const planValue = computed(() => keyOf(settingsStore.settings.planModel));
const actValue = computed(() => keyOf(settingsStore.settings.actModel));

function onChange(phase: "plan" | "act", value: unknown) {
  if (value === INHERIT) {
    void settingsStore.setPhaseModelDefault(phase, null);
    return;
  }
  const found = options.value.find((item) => item.key === value);
  if (found) {
    void settingsStore.setPhaseModelDefault(phase, found.ref);
  }
}
</script>

<template>
  <section id="set-models-phase" class="flex scroll-mt-2 flex-col gap-3">
    <SectionHeader
      :icon="Layers"
      :title="t('settings.models.phaseTitle')"
      :desc="t('settings.models.phaseDesc')"
    />

    <div
      class="flex flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)] px-3 py-2"
    >
      <div class="flex h-[30px] items-center gap-3">
        <label
          for="phase-model-plan"
          class="w-[96px] flex-none text-[12px] text-[var(--color-txt)]"
        >
          {{ t("settings.models.phasePlanLabel") }}
        </label>
        <Select :model-value="planValue" @update:model-value="(value) => onChange('plan', value)">
          <SelectTrigger id="phase-model-plan" size="sm" class="h-[30px] min-w-0 flex-1 text-[12px]">
            <SelectValue :placeholder="t('settings.models.phaseInherit')" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="INHERIT">{{ t("settings.models.phaseInherit") }}</SelectItem>
              <SelectItem v-for="item in options" :key="item.key" :value="item.key">
                {{ item.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div class="flex h-[30px] items-center gap-3">
        <label
          for="phase-model-act"
          class="w-[96px] flex-none text-[12px] text-[var(--color-txt)]"
        >
          {{ t("settings.models.phaseActLabel") }}
        </label>
        <Select :model-value="actValue" @update:model-value="(value) => onChange('act', value)">
          <SelectTrigger id="phase-model-act" size="sm" class="h-[30px] min-w-0 flex-1 text-[12px]">
            <SelectValue :placeholder="t('settings.models.phaseInherit')" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="INHERIT">{{ t("settings.models.phaseInherit") }}</SelectItem>
              <SelectItem v-for="item in options" :key="item.key" :value="item.key">
                {{ item.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <p v-if="!options.length" class="m-0 pt-1 text-[11px] text-[var(--color-dim)]">
        {{ t("settings.models.phaseEmpty") }}
      </p>
    </div>
  </section>
</template>
