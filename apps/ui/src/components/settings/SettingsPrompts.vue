<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentStore } from "@/stores/agent";

import type { PromptPreset, PromptViewVersion } from "@zen/shared";

/**
 * 提示词配置：内置预设可切换 中 / 英 / 提炼版（推荐）预览；
 * 选择预设即写入 agent 设置，下一次会话使用。
 */
const agentStore = useAgentStore();
const { settings, presets } = storeToRefs(agentStore);
const previewId = ref("");
const viewVersion = ref<PromptViewVersion>("distilled");

const activePreset = computed(
  () => presets.value.find((item) => item.id === settings.value.prompt.presetId) ?? null,
);

const activePresetName = computed(() => {
  if (settings.value.prompt.presetId === "custom") {
    return "自定义";
  }
  return activePreset.value?.name ?? "Zen 默认";
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
    list.push({ id: "zh", label: "中" });
  }
  if (versions.en) {
    list.push({ id: "en", label: "英" });
  }
  if (versions.distilled) {
    list.push({ id: "distilled", label: "提炼版（推荐）" });
  }
  return list;
});

const previewText = computed(() => {
  if (previewId.value === "custom") {
    return settings.value.prompt.customText || "（尚未填写自定义提示词）";
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
    return "运行时默认注入提炼版";
  }
  if (viewVersion.value === "en") {
    return "完整英文原文（对照用；选用预设仍默认提炼版）";
  }
  return "完整中文版（对照用；选用预设仍默认提炼版）";
});

function selectPreset(id: string) {
  previewId.value = id;
  const preset = presets.value.find((item) => item.id === id);
  viewVersion.value = preset?.defaultView ?? "distilled";
  if (id === "custom") {
    void agentStore.updateSettings({
      prompt: { presetId: "custom", customText: settings.value.prompt.customText },
    });
    return;
  }
  void agentStore.updateSettings({
    prompt: { presetId: id, customText: settings.value.prompt.customText },
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
    viewVersion.value = preset?.defaultView ?? "distilled";
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-5">
    <section class="flex flex-col gap-2.5">
      <div class="flex items-center gap-2">
        <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">系统提示词</h3>
        <Badge variant="secondary">当前：{{ activePresetName }}</Badge>
      </div>
      <p class="m-0 text-[12px] text-[var(--color-mut)]">
        「提炼版」为运行时默认注入；「中 / 英」为完整原文或完整中文版，供对照阅读。
        调研见
        <code class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]">docs/research/agent-system-prompts.md</code>
        ，原文存
        <code class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]">apps/desktop/src/main/prompt-texts/</code>
        。
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
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ preset.name }}
            </span>
            <Badge
              v-if="preset.kind === 'full'"
              class="bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]! text-[var(--color-accent)]!"
              variant="secondary"
            >
              含完整原文
            </Badge>
          </div>
          <p class="m-0 mt-1 text-[11.5px] leading-snug text-[var(--color-mut)]">
            {{ preset.description }}
          </p>
          <p class="m-0 mt-1 truncate text-[10.5px] text-[var(--color-dim)]">
            来源：{{ preset.origin }}
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
          <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">自定义</span>
          <p class="m-0 mt-1 text-[11.5px] text-[var(--color-mut)]">
            完全按你的规则约束 Agent 的行为与输出。
          </p>
        </Button>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <div
        class="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[var(--color-txt-strong)]"
      >
        <h3 class="m-0">
          {{ settings.prompt.presetId === 'custom' ? '编辑自定义提示词' : '预览' }}
        </h3>
        <span class="text-[11px] font-normal text-[var(--color-dim)]">{{ previewChars }} 字符</span>
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
            @click="viewVersion = ver.id"
          >
            {{ ver.label }}
          </Button>
          <Button
            v-if="previewId !== 'custom' && previewText"
            variant="outline"
            class="h-auto ml-1 rounded-md border-[var(--color-line)] bg-transparent px-2 py-0.5 text-[11px] font-normal text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-mut)] dark:hover:bg-[var(--color-menu-hover)]"
            title="把当前预览全文写入自定义提示词并立即生效"
            @click="applyPreviewAsCustom"
          >
            用此版本
          </Button>
        </div>
      </div>
      <p class="m-0 text-[11.5px] text-[var(--color-mut)]">
        {{ versionNote }}。Zen 另会自动附加工作目录、平台、日期、可用技能与 MCP 清单。
      </p>
      <Textarea
        v-if="settings.prompt.presetId === 'custom'"
        :model-value="settings.prompt.customText"
        class="min-h-[260px] rounded-xl border-[var(--color-line)] bg-[var(--color-np-btn-bg)] text-[12.5px] leading-relaxed"
        placeholder="你是…（描述身份、代码修改规范、工具使用规则、输出风格等）"
        @input="onCustomInput"
      />
      <pre
        v-else
        class="m-0 max-h-[320px] overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-np-btn-bg)] p-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--color-mut)]"
      >{{ previewText }}</pre>
    </section>
  </div>
</template>
