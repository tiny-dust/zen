<script setup lang="ts">
import type { PetState, ProviderSummary } from "@zen/shared";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import FileInput from "@/components/ui/input/FileInput.vue";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SliderRange } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const { t } = useI18n();
const pet = ref<PetState | null>(null);
const providers = ref<ProviderSummary[]>([]);
const source = ref<string | null>(null);
const style = ref("");
const fileInput = ref<InstanceType<typeof FileInput> | null>(null);
const stylePresets = computed(() => [
  t("settings.pet.styleOriginal"),
  t("settings.pet.stylePixel"),
  t("settings.pet.styleHandDrawn"),
]);
const selection = ref("");
const busy = ref(false);
const error = ref("");
const success = ref(false);
const size = ref(160);
let unsubscribe: (() => void) | undefined;

const models = computed(() => providers.value.flatMap((provider) =>
  provider.enabled && provider.hasApiKey && (!provider.authMode || provider.authMode === "api-key")
  && (provider.protocol === "openai-chat" || provider.protocol === "openai-responses")
    ? provider.models.filter((model) => model.enabled && model.capabilities?.imageEdit)
    .map((model) => ({ value: JSON.stringify([provider.id, model.id]), label: `${provider.name} · ${model.name}` })) : [],
));

onMounted(async () => {
  unsubscribe = window.zen!.pet.onChanged((state) => {
    pet.value = state;
    size.value = state.size;
  });
  try {
    const [state, list] = await Promise.all([window.zen!.pet.get(), window.zen!.models.list()]);
    pet.value = state;
    source.value = state.sourceDataUrl;
    size.value = state.size;
    providers.value = list;
    selection.value = models.value[0]?.value ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.pet.failed");
  }
});
onUnmounted(() => unsubscribe?.());

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > 10 * 1024 * 1024) {
    error.value = t("settings.pet.invalidImage");
    return;
  }
  try {
    source.value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    error.value = "";
    success.value = false;
  } catch {
    error.value = t("settings.pet.failed");
  }
}
async function generate() {
  if (!source.value || !selection.value || busy.value) return;
  busy.value = true;
  error.value = "";
  success.value = false;
  try {
    const [providerId, modelId] = JSON.parse(selection.value) as [string, string];
    pet.value = await window.zen!.pet.generate({ providerId, modelId, sourceDataUrl: source.value, style: style.value.trim() });
    success.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.pet.failed");
  } finally {
    busy.value = false;
  }
}
async function setVisible(visible: boolean) {
  try { pet.value = await window.zen!.pet.setVisible(visible); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : t("settings.pet.failed"); }
}
async function saveSize() {
  try { pet.value = await window.zen!.pet.setSize(size.value); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : t("settings.pet.failed"); }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <section id="set-pet-create" class="flex flex-col scroll-mt-2">
      <h3 class="settings-section-title">{{ t("settings.pet.source") }}</h3>
      <Card size="sm" class="settings-card">
        <CardContent class="flex flex-col gap-4 p-4">
          <div class="flex items-center gap-4">
            <div class="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)]">
              <img v-if="source" :src="source" :alt="t('settings.pet.source')" class="max-h-full max-w-full object-contain">
            </div>
            <div class="flex flex-col items-start gap-2">
              <FileInput id="pet-image" ref="fileInput" class="hidden" accept="image/png,image/jpeg,image/webp" :disabled="busy" :aria-label="t('settings.pet.choose')" @change="onFileChange" />
              <Button variant="outline" :disabled="busy" @click="fileInput?.open()">{{ t("settings.pet.choose") }}</Button>
              <p class="m-0 text-xs text-[var(--color-mut)]">{{ t("settings.pet.imageHint") }}</p>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="pet-model" class="text-xs font-medium">{{ t("settings.pet.model") }}</label>
            <Select v-model="selection">
              <SelectTrigger id="pet-model" class="w-full"><SelectValue :placeholder="t('settings.pet.model')" /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem v-for="model in models" :key="model.value" :value="model.value">{{ model.label }}</SelectItem></SelectGroup></SelectContent>
            </Select>
            <p v-if="!models.length" class="m-0 text-xs text-[var(--color-mut)]">{{ t("settings.pet.noModel") }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="pet-style" class="text-xs font-medium">{{ t("settings.pet.style") }}</label>
            <div class="flex flex-wrap gap-2">
              <Button v-for="preset in stylePresets" :key="preset" variant="outline" size="sm" :disabled="busy" @click="style = preset">{{ preset }}</Button>
            </div>
            <Input id="pet-style" v-model="style" :maxlength="500" :placeholder="t('settings.pet.stylePlaceholder')" :disabled="busy" />
            <p class="m-0 text-xs text-[var(--color-mut)]">{{ t("settings.pet.uploadNotice") }}</p>
          </div>
          <p v-if="pet?.spriteDataUrl" class="m-0 text-xs text-[var(--color-mut)]">{{ t("settings.pet.regenerateHint") }}</p>
          <div class="flex items-center gap-3">
            <Button :disabled="busy || !source || !selection || !style.trim()" @click="generate">{{ t(busy ? "settings.pet.generating" : "settings.pet.generate") }}</Button>
            <span v-if="success" class="text-xs text-[var(--color-ok)]">{{ t("settings.pet.generated") }}</span>
          </div>
          <p v-if="error" role="alert" class="m-0 text-xs text-[var(--color-err)]">{{ error }}</p>
        </CardContent>
      </Card>
    </section>
    <section id="set-pet-preview" class="flex flex-col scroll-mt-2">
      <h3 class="settings-section-title">{{ t("settings.pet.preview") }}</h3>
      <Card size="sm" class="settings-card"><CardContent class="flex flex-col gap-4 p-4">
        <div class="flex h-44 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)]">
          <img v-if="pet?.spriteDataUrl" :src="pet.spriteDataUrl" :alt="t('settings.pet.preview')" class="max-h-full max-w-full object-contain">
          <p v-else class="text-xs text-[var(--color-mut)]">{{ t("settings.pet.empty") }}</p>
        </div>
        <div class="flex items-center justify-between text-sm"><label for="pet-visible">{{ t("settings.pet.visible") }}</label><Switch id="pet-visible" :model-value="pet?.enabled ?? false" :disabled="!pet?.spriteDataUrl || busy" @update:model-value="setVisible" /></div>
        <div class="flex items-center gap-4 text-sm"><label for="pet-size" class="shrink-0">{{ t("settings.pet.size") }}</label><SliderRange id="pet-size" v-model="size" :min="100" :max="300" :step="10" :disabled="!pet?.spriteDataUrl" :aria-label="t('settings.pet.size')" @change="saveSize" /><span class="w-12 text-right tabular-nums">{{ size }}px</span></div>
      </CardContent></Card>
    </section>
  </div>
</template>
