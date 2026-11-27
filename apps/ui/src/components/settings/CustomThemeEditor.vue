<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SliderRange } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings";

import { BASE_SEEDS, SEED_KEYS, contrastRatio, isHexColor, resolvedSeeds } from "@zen/shared";

import type { CustomTheme, SeedKey, ThemeBase } from "@zen/shared";

/**
 * 自定义主题编辑器：只编辑种子色（accent / background / surface / text）与可选另一套明暗，
 * 保存后由 useAppTheme 推导成 Zen 的 CSS 变量。不做「任意 CSS 覆盖」——那既无必要也扩大注入面。
 */
const props = defineProps<{ open: boolean; theme: CustomTheme | null }>();
const emit = defineEmits<{ "update:open": [boolean]; saved: [CustomTheme] }>();

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const name = ref("");
const base = ref<ThemeBase>("light");
const seeds = ref<Record<SeedKey, string>>({ ...BASE_SEEDS.light });
const variantSeeds = ref<Record<SeedKey, string>>({ ...BASE_SEEDS.dark });
const hasVariant = ref(false);
const backgroundId = ref("");
const backgroundUrl = ref("");
const blur = ref(0);
const dim = ref(0.45);
const busy = ref(false);
const error = ref("");

watch(
  () => [props.open, props.theme] as const,
  async ([open, theme]) => {
    if (!open) return;
    error.value = "";
    name.value = theme?.name.zh || theme?.name.en || t("settings.general.customNewName");
    base.value = theme?.base ?? "light";
    seeds.value = { ...BASE_SEEDS[theme?.base ?? "light"], ...theme?.seeds };
    const other = (theme?.base ?? "light") === "dark" ? "light" : "dark";
    variantSeeds.value = { ...BASE_SEEDS[other], ...theme?.variants?.[other]?.seeds };
    hasVariant.value = Boolean(theme?.variants?.[other]);
    backgroundId.value = theme?.background?.id ?? "";
    blur.value = theme?.background?.blur ?? 0;
    dim.value = theme?.background?.dim ?? 0.45;
    backgroundUrl.value = "";
    if (backgroundId.value) {
      const result = await window.zen?.themeImage.read(backgroundId.value);
      if (result?.ok && result.dataUrl) backgroundUrl.value = result.dataUrl;
    }
  },
  { immediate: true },
);

/** 对比度提示：正文对底色的 WCAG 比值，低于 4.5 只提醒不阻止（推导会自动修正文字亮度） */
const contrast = computed(() => {
  const s = resolvedSeeds({ base: base.value, seeds: seeds.value });
  return Math.round(contrastRatio(s.text, s.background) * 100) / 100;
});

const invalidSeeds = computed(() => SEED_KEYS.filter((key) => !isHexColor(seeds.value[key])));

async function pickBackground(): Promise<void> {
  const result = await window.zen?.themeImage.pick();
  if (!result?.ok || !result.id) {
    if (result && !result.canceled) error.value = t("settings.general.imagePickFailed");
    return;
  }
  backgroundId.value = result.id;
  const read = await window.zen?.themeImage.read(result.id);
  backgroundUrl.value = read?.ok ? read.dataUrl ?? "" : "";
}

function removeBackground(): void {
  backgroundId.value = "";
  backgroundUrl.value = "";
}

async function save(): Promise<void> {
  if (!name.value.trim() || invalidSeeds.value.length) {
    error.value = invalidSeeds.value.length ? t("settings.general.customInvalidColor") : t("settings.general.customNeedName");
    return;
  }
  busy.value = true;
  try {
    const id = props.theme?.id ?? `t${Date.now().toString(36)}`.slice(0, 10);
    const other: ThemeBase = base.value === "dark" ? "light" : "dark";
    const theme: CustomTheme = {
      id,
      name: { zh: name.value.trim(), en: name.value.trim() },
      base: base.value,
      seeds: { ...seeds.value },
      ...(hasVariant.value ? { variants: { [other]: { seeds: { ...variantSeeds.value } } } } : {}),
      ...(backgroundId.value ? { background: { id: backgroundId.value, blur: blur.value, dim: dim.value } } : {}),
    };
    await settingsStore.saveCustomTheme(theme);
    emit("saved", theme);
    emit("update:open", false);
  } catch {
    error.value = t("settings.general.customSaveFailed");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-[520px]" data-testid="custom-theme-editor">
      <DialogHeader>
        <DialogTitle>{{ theme ? t("settings.general.customEdit") : t("settings.general.customNew") }}</DialogTitle>
        <DialogDescription>{{ t("settings.general.customHint") }}</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.general.customName") }}</span>
          <Input v-model="name" class="h-8 text-[13px]" maxlength="40" data-testid="custom-theme-name" />
        </label>

        <div class="flex flex-col gap-1">
          <span class="text-[12px] text-[var(--color-mut)]">{{ t("settings.general.customBase") }}</span>
          <div class="flex gap-2" role="radiogroup" :aria-label="t('settings.general.customBase')">
            <Button
              v-for="option in (['light', 'dark'] as ThemeBase[])"
              :key="option"
              type="button"
              role="radio"
              :aria-checked="base === option"
              :variant="base === option ? 'default' : 'outline'"
              size="sm"
              @click="base = option; seeds = { ...BASE_SEEDS[option] }"
            >
              {{ option === "light" ? t("settings.general.customLight") : t("settings.general.customDark") }}
            </Button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label v-for="key in SEED_KEYS" :key="key" class="flex flex-col gap-1">
            <span class="text-[12px] text-[var(--color-mut)]">{{ t(`settings.general.seed.${key}`) }}</span>
            <span class="flex items-center gap-1.5">
              <span class="size-6 flex-none rounded-[var(--radius-xs)] border border-[var(--color-line)]" :style="{ backgroundColor: isHexColor(seeds[key]) ? seeds[key] : 'transparent' }" aria-hidden="true" />
              <Input v-model="seeds[key]" class="h-8 font-mono text-[12px]" maxlength="9" :aria-label="t(`settings.general.seed.${key}`)" />
            </span>
          </label>
        </div>

        <p class="m-0 text-[11px]" :class="contrast >= 4.5 ? 'text-[var(--color-dim)]' : 'text-[var(--color-danger)]'" data-testid="custom-theme-contrast">
          {{ t("settings.general.customContrast", { ratio: contrast }) }}
        </p>

        <div class="flex items-center gap-2 text-[12px] text-[var(--color-txt)]">
          <Switch
            :model-value="hasVariant"
            :aria-label="t('settings.general.customVariant')"
            data-testid="custom-theme-variant"
            @update:model-value="hasVariant = Boolean($event)"
          />
          {{ t("settings.general.customVariant") }}
        </div>
        <div v-if="hasVariant" class="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-soft)] p-2">
          <label v-for="key in SEED_KEYS" :key="`v-${key}`" class="flex flex-col gap-1">
            <span class="text-[11px] text-[var(--color-mut)]">{{ t(`settings.general.seed.${key}`) }}</span>
            <span class="flex items-center gap-1.5">
              <span class="size-5 flex-none rounded-[var(--radius-xs)] border border-[var(--color-line)]" :style="{ backgroundColor: isHexColor(variantSeeds[key]) ? variantSeeds[key] : 'transparent' }" aria-hidden="true" />
              <Input v-model="variantSeeds[key]" class="h-7 font-mono text-[11px]" maxlength="9" />
            </span>
          </label>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span class="size-9 overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-line-soft)]">
              <img v-if="backgroundUrl" :src="backgroundUrl" alt="" class="h-full w-full object-cover">
            </span>
            <Button type="button" variant="outline" size="sm" @click="pickBackground">
              {{ backgroundUrl ? t("settings.general.imageChange") : t("settings.general.customBackground") }}
            </Button>
            <Button v-if="backgroundUrl" type="button" variant="ghost" size="sm" @click="removeBackground">
              {{ t("settings.general.imageRemove") }}
            </Button>
          </div>
          <template v-if="backgroundUrl">
            <div class="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
              <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.general.imageBlur") }}</span>
              <SliderRange v-model="blur" :min="0" :max="40" :aria-label="t('settings.general.imageBlur')" />
            </div>
            <div class="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
              <span class="text-[11px] text-[var(--color-mut)]">{{ t("settings.general.imageDim") }}</span>
              <SliderRange :model-value="Math.round(dim * 100)" :min="0" :max="90" :step="5" :aria-label="t('settings.general.imageDim')" @update:model-value="dim = $event / 100" />
            </div>
          </template>
        </div>

        <p v-if="error" class="m-0 text-[11px] text-[var(--color-danger)]">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="ghost" type="button" @click="emit('update:open', false)">{{ t("settings.general.customCancel") }}</Button>
        <Button type="button" :disabled="busy" data-testid="custom-theme-save" @click="save">{{ t("settings.general.customSave") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
