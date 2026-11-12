<script setup lang="ts">
import type { PetCollectionState, ProviderSummary } from "@zen/shared";
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import FileInput from "@/components/ui/input/FileInput.vue";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SliderRange } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const { t } = useI18n();
const collection = shallowRef<PetCollectionState>({ pets: [] });
const sizes = ref<Record<string, number>>({});
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
const importMessage = ref("");
let unsubscribe: (() => void) | undefined;

function applyCollection(state: PetCollectionState) {
  collection.value = state;
  sizes.value = Object.fromEntries(state.pets.map((pet) => [pet.id, pet.size]));
}

const models = computed(() => providers.value.flatMap((provider) =>
  provider.enabled && provider.hasApiKey && (!provider.authMode || provider.authMode === "api-key")
  && (provider.protocol === "openai-chat" || provider.protocol === "openai-responses")
    ? provider.models.filter((model) => model.enabled && model.capabilities?.imageEdit)
    .map((model) => ({ value: JSON.stringify([provider.id, model.id]), label: `${provider.name} · ${model.name}` })) : [],
));

onMounted(async () => {
  unsubscribe = window.zen!.pet.onChanged(applyCollection);
  try {
    const [state, list] = await Promise.all([window.zen!.pet.get(), window.zen!.models.list()]);
    applyCollection(state);
    source.value = state.pets.find((pet) => pet.sourceDataUrl)?.sourceDataUrl ?? null;
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
    applyCollection(await window.zen!.pet.generate({ providerId, modelId, sourceDataUrl: source.value, style: style.value.trim() }));
    success.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.pet.failed");
  } finally {
    busy.value = false;
  }
}
async function importDirectory() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  importMessage.value = "";
  try {
    const existingIds = new Set(collection.value.pets.map((pet) => pet.id));
    const state = await window.zen!.pet.importDirectory();
    if (!state) return;
    applyCollection(state);
    const count = state.pets.filter((pet) => !existingIds.has(pet.id)).length;
    if (count) importMessage.value = t("settings.pet.imported", { count });
    else error.value = t("settings.pet.importEmpty");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.pet.importFailed");
  } finally {
    busy.value = false;
  }
}
async function setVisible(id: string, visible: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { applyCollection(await window.zen!.pet.setVisible(id, visible)); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : t("settings.pet.failed"); }
  finally { busy.value = false; }
}
async function saveSize(id: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { applyCollection(await window.zen!.pet.setSize(id, sizes.value[id] ?? 160)); }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : t("settings.pet.failed");
    sizes.value[id] = collection.value.pets.find((pet) => pet.id === id)?.size ?? 160;
  } finally { busy.value = false; }
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
          <p v-if="collection.pets.length" class="m-0 text-xs text-[var(--color-mut)]">{{ t("settings.pet.regenerateHint") }}</p>
          <div class="flex items-center gap-3">
            <Button :disabled="busy || !source || !selection || !style.trim()" @click="generate">{{ t(busy ? "settings.pet.generating" : "settings.pet.generate") }}</Button>
            <span v-if="success" class="text-xs text-[var(--color-ok)]">{{ t("settings.pet.generated") }}</span>
          </div>
        </CardContent>
      </Card>
    </section>
    <section id="set-pet-preview" class="flex flex-col scroll-mt-2">
      <h3 class="settings-section-title">{{ t("settings.pet.preview") }}</h3>
      <div class="flex flex-col gap-3">
        <Card size="sm" class="settings-card">
          <CardContent class="flex flex-col items-start gap-2 p-4">
            <Button variant="outline" :disabled="busy" @click="importDirectory">{{ t(busy ? "settings.pet.importing" : "settings.pet.importDirectory") }}</Button>
            <p class="m-0 text-xs text-[var(--color-mut)]">{{ t("settings.pet.importHint") }}</p>
            <p v-if="importMessage" role="status" class="m-0 text-xs text-[var(--color-ok)]">{{ importMessage }}</p>
            <p v-if="error" role="alert" class="m-0 text-xs text-[var(--color-err)]">{{ error }}</p>
          </CardContent>
        </Card>
        <p v-if="!collection.pets.length" class="text-xs text-[var(--color-mut)]">{{ t("settings.pet.empty") }}</p>
        <div v-else class="pet-collection">
          <div class="pet-grid">
            <Card v-for="(item, index) in collection.pets" :key="item.id" size="sm" class="settings-card min-w-0">
              <CardContent class="flex min-w-0 flex-col gap-3 px-3 py-2">
                <h4 class="m-0 truncate text-sm font-medium" :title="item.name">{{ item.name }}</h4>
                <div class="flex h-28 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)]">
                  <div
                    v-if="item.spriteDataUrl"
                    class="pet-portrait"
                    :class="item.spriteLayout === 'dimagent-v2' ? 'pet-portrait--dimagent' : 'pet-portrait--zen'"
                    :style="{ backgroundImage: `url(${item.spriteDataUrl})` }"
                    role="img"
                    :aria-label="item.name"
                  />
                  <p v-else class="text-xs text-[var(--color-mut)]">{{ t("settings.pet.noPreview") }}</p>
                </div>
                <div class="flex min-h-8 items-center justify-between gap-2 text-sm">
                  <label :for="`pet-visible-${index}`" class="min-w-0 truncate" :title="t('settings.pet.visible')">{{ t("settings.pet.visible") }}</label>
                  <Switch :id="`pet-visible-${index}`" :model-value="item.enabled" :disabled="!item.spriteDataUrl || busy" @update:model-value="setVisible(item.id, $event)" />
                </div>
                <div class="flex min-h-8 min-w-0 items-center gap-2 text-sm">
                  <label :for="`pet-size-${index}`" class="shrink-0">{{ t("settings.pet.size") }}</label>
                  <SliderRange :id="`pet-size-${index}`" class="min-w-0 flex-1" :model-value="sizes[item.id] ?? item.size" :min="100" :max="300" :step="10" :disabled="!item.spriteDataUrl || busy" :aria-label="t('settings.pet.size')" @update:model-value="sizes[item.id] = $event" @change="saveSize(item.id)" />
                  <span class="shrink-0 text-right tabular-nums">{{ sizes[item.id] ?? item.size }}px</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pet-collection {
  container-type: inline-size;
}

.pet-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}

@container (min-width: 420px) {
  .pet-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (min-width: 680px) {
  .pet-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.pet-portrait {
  flex: none;
  width: 96px;
  max-height: 100%;
  background-position: left top;
  background-repeat: no-repeat;
}

.pet-portrait--zen {
  aspect-ratio: 1;
  background-size: 400% 400%;
}

.pet-portrait--dimagent {
  aspect-ratio: 12 / 13;
  background-size: 800% 1100%;
}
</style>
