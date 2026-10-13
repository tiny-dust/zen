<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentStore } from "@/stores/agent";

import type { PromptPreset, PromptViewVersion } from "@zen/shared";

/**
 * 提示词配置：内置预设可切换 中 / 英 / 提炼版（推荐）预览；
 * 选择预设即写入 agent 设置，下一次会话使用。
 */
const { t } = useI18n();
const agentStore = useAgentStore();
const { settings, presets } = storeToRefs(agentStore);
const previewId = ref("");
const viewVersion = ref<PromptViewVersion>("distilled");

const activePreset = computed(
  () => presets.value.find((item) => item.id === settings.value.prompt.presetId) ?? null,
);

const activePresetName = computed(() => {
  if (settings.value.prompt.presetId === "custom") {
    return t("settings.prompts.customName");
  }
  return activePreset.value?.name ?? t("settings.prompts.zenDefaultName");
});

const previewPreset = computed(() => {
  if (!previewId.value || previewId.value === "custom") {
    return null;
  }
  return presets.value.find((item) => item.id === previewId.value) ?? null;
});

const availableVersions = computed(() => {
  const versions = previewPreset.value?.versions;
  if (!versions) {
    return [] as Array<{ id: PromptViewVersion; label: string }>;
  }
  const list: Array<{ id: PromptViewVersion; label: string }> = [];
  if (versions.zh) {
    list.push({ id: "zh", label: t("settings.prompts.versionZh") });
  }
  if (versions.en) {
    list.push({ id: "en", label: t("settings.prompts.versionEn") });
  }
  if (versions.distilled) {
    list.push({ id: "distilled", label: t("settings.prompts.versionDistilled") });
  }
  return list;
});

const previewText = computed(() => {
  if (previewId.value === "custom") {
    return settings.value.prompt.customText || t("settings.prompts.customEmpty");
  }
  const preset = previewPreset.value;
  if (!preset?.versions) {
    return preset?.text ?? "";
  }
  const map = preset.versions;
  if (viewVersion.value === "zh" && map.zh) {
    return map.zh;
  }
  if (viewVersion.value === "en" && map.en) {
    return map.en;
  }
  if (viewVersion.value === "distilled" && map.distilled) {
    return map.distilled;
  }
  return map.distilled || map.zh || map.en || preset.text;
});

const previewChars = computed(() => previewText.value.length.toLocaleString());

const versionNote = computed(() => {
  if (viewVersion.value === "distilled") {
    return t("settings.prompts.versionNoteDistilled");
  }
  if (viewVersion.value === "en") {
    return t("settings.prompts.versionNoteEn");
  }
  return t("settings.prompts.versionNoteZh");
});

function selectPreset(id: string) {
  previewId.value = id;
  const preset = presets.value.find((item) => item.id === id);
  // 切换预设时注入版本回落到该预设的推荐视图（用户可再切 中/英/提炼版）
  const version = id === "custom" ? "distilled" : (preset?.defaultView ?? "distilled");
  viewVersion.value = version;
  void agentStore.updateSettings({
    prompt: { presetId: id, customText: settings.value.prompt.customText, version },
  });
}

/** 版本切换同时决定预览与会话实际注入的文本（自定义提示词无版本概念） */
function selectVersion(ver: PromptViewVersion) {
  viewVersion.value = ver;
  if (settings.value.prompt.presetId === "custom") {
    return;
  }
  void agentStore.updateSettings({
    prompt: {
      presetId: settings.value.prompt.presetId,
      customText: settings.value.prompt.customText,
      version: ver,
    },
  });
}

function applyPreviewAsCustom() {
  if (!previewText.value || previewId.value === "custom") {
    return;
  }
  void agentStore.updateSettings({
    prompt: { presetId: "custom", customText: previewText.value },
  });
}

function onCustomInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  settings.value = {
    ...settings.value,
    prompt: { presetId: "custom", customText: value },
  };
  watchOnce();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function watchOnce() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    void agentStore.updateSettings({
      prompt: {
        presetId: "custom",
        customText: settings.value.prompt.customText,
      },
    });
  }, 600);
}

watch(
  () => settings.value.prompt.presetId,
  (id) => {
    previewId.value = id;
    const preset = presets.value.find((item) => item.id === id) as PromptPreset | undefined;
    viewVersion.value = settings.value.prompt.version ?? preset?.defaultView ?? "distilled";
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-5">
    <section id="set-prompts-presets" class="flex flex-col gap-2.5 scroll-mt-2">
      <div class="flex items-center gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">{{ t("settings.prompts.title") }}</h3>
        <Badge variant="secondary">{{ t("settings.prompts.currentBadge", { name: activePresetName }) }}</Badge>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        {{ t("settings.prompts.descA") }}<code class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]">docs/research/agent-system-prompts.md</code>{{ t("settings.prompts.descB") }}<code class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]">apps/desktop/src/main/prompt-texts/</code>{{ t("settings.prompts.descC") }}
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <Button
          v-for="preset in presets"
          :key="preset.id"
          variant="ghost"
          class="h-auto flex flex-col whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
          :class="
            settings.prompt.presetId === preset.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.prompt.presetId === preset.id"
          @click="selectPreset(preset.id)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ preset.name }}
            </span>
            <Badge
              v-if="preset.kind === 'full'"
              class="bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]! text-[var(--color-accent)]!"
              variant="secondary"
            >
              {{ t("settings.prompts.fullOriginalBadge") }}
            </Badge>
          </div>
          <p class="m-0 mt-1 text-[11px] leading-snug text-[var(--color-mut)]">
            {{ preset.description }}
          </p>
          <p class="m-0 mt-1 truncate text-[10px] text-[var(--color-dim)]">
            {{ t("settings.prompts.originPrefix", { origin: preset.origin }) }}
          </p>
        </Button>
        <Button
          variant="ghost"
          class="h-auto flex flex-col whitespace-normal rounded-xl border p-3 text-left font-normal transition-colors"
          :class="
            settings.prompt.presetId === 'custom'
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.prompt.presetId === 'custom'"
          @click="selectPreset('custom')"
        >
          <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ t("settings.prompts.customName") }}</span>
          <p class="m-0 mt-1 text-[11px] text-[var(--color-mut)]">
            {{ t("settings.prompts.customDesc") }}
          </p>
        </Button>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <div
        class="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[var(--color-txt-strong)]"
      >
        <h3 class="m-0">
          {{ settings.prompt.presetId === 'custom' ? t('settings.prompts.editCustom') : t('settings.prompts.preview') }}
        </h3>
        <span class="text-[11px] font-normal text-[var(--color-dim)]">{{ t("settings.prompts.charsCount", { count: previewChars }) }}</span>
        <div class="ml-auto flex items-center gap-1">
          <Button
            v-for="ver in availableVersions"
            :key="ver.id"
            variant="ghost"
            class="h-auto rounded-md border px-2 py-0.5 text-[11px] font-normal transition-colors"
            :class="
              viewVersion === ver.id
                ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-txt-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                : 'border-[var(--color-line)] text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]'
            "
            :aria-pressed="viewVersion === ver.id"
            @click="selectVersion(ver.id)"
          >
            {{ ver.label }}
          </Button>
          <Button
            v-if="previewId !== 'custom' && previewText"
            variant="outline"
            class="h-auto ml-1 rounded-md border-[var(--color-line)] bg-transparent px-2 py-0.5 text-[11px] font-normal text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-mut)] dark:hover:bg-[var(--color-menu-hover)]"
            :title="t('settings.prompts.applyAsCustomTitle')"
            @click="applyPreviewAsCustom"
          >
            {{ t("settings.prompts.applyAsCustom") }}
          </Button>
        </div>
      </div>
      <p class="m-0 text-[11px] text-[var(--color-mut)]">
        {{ versionNote }}。{{ t("settings.prompts.autoAppendNote") }}
      </p>
      <Textarea
        v-if="settings.prompt.presetId === 'custom'"
        :model-value="settings.prompt.customText"
        class="min-h-[260px] rounded-xl border-[var(--color-line)] bg-[var(--color-np-btn-bg)] text-[12px] leading-relaxed"
        :placeholder="t('settings.prompts.customPlaceholder')"
        @input="onCustomInput"
      />
      <pre
        v-else
        class="m-0 max-h-[320px] overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] p-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--color-mut)]"
      >{{ previewText }}</pre>
    </section>
  </div>
</template>
