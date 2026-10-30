<script setup lang="ts">
import { shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const { t } = useI18n();
const clearing = shallowRef(false);
const result = shallowRef<"success" | "error" | null>(null);

async function clearCache() {
  if (clearing.value) {
    return;
  }
  clearing.value = true;
  result.value = null;
  try {
    const response = await window.zen?.cache.clearTemporary();
    result.value = response?.ok ? "success" : "error";
  } catch {
    result.value = "error";
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <section id="set-general-cache" class="flex flex-col scroll-mt-2">
    <h3 class="settings-section-title">{{ t("settings.cache.title") }}</h3>
    <Card size="sm" class="settings-card">
      <CardContent class="flex flex-col items-start gap-3 p-4">
        <p class="m-0 text-[12px] leading-relaxed text-[var(--color-mut)]">
          {{ t("settings.cache.description") }}
        </p>
        <Button variant="outline" size="sm" :disabled="clearing" @click="clearCache">
          {{ clearing ? t("settings.cache.clearing") : t("settings.cache.clear") }}
        </Button>
        <p
          v-if="result"
          class="m-0 text-[12px]"
          :class="result === 'error' ? 'text-[var(--color-err)]' : 'text-[var(--color-mut)]'"
          role="status"
        >
          {{ result === "error" ? t("settings.cache.failed") : t("settings.cache.cleared") }}
        </p>
      </CardContent>
    </Card>
  </section>
</template>
