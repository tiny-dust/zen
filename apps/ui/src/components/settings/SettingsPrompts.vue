<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";

import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAgentStore } from "@/stores/agent";

/**
 * 提示词配置：可选知名工具的内置系统提示词（见 docs/research/agent-system-prompts.md），
 * 也可完全自定义；选择即生效，下一次会话使用。
 */
const agentStore = useAgentStore();
const { settings, presets } = storeToRefs(agentStore);
const previewId = ref("");

const activePresetName = computed(() => {
  if (settings.value.prompt.presetId === "custom") {
    return "自定义";
  }
  return (
    presets.value.find((item) => item.id === settings.value.prompt.presetId)?.name ??
    "Zen 默认"
  );
});

const previewText = computed(() => {
  if (previewId.value === "custom") {
    return settings.value.prompt.customText || "（尚未填写自定义提示词）";
  }
  if (previewId.value) {
    return (
      presets.value.find((item) => item.id === previewId.value)?.text ?? ""
    );
  }
  if (settings.value.prompt.presetId === "custom") {
    return settings.value.prompt.customText || "（尚未填写自定义提示词）";
  }
  return presets.value.find((item) => item.id === previewId.value)?.text ?? "";
});

/** 预览字数：让「提炼版 / 完整原文」的体量差异一目了然 */
const previewChars = computed(() => previewText.value.length.toLocaleString());

function selectPreset(id: string) {
  previewId.value = id;
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

function onCustomInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  settings.value = {
    ...settings.value,
    prompt: { presetId: "custom", customText: value },
  };
  // 输入时本地更新，失焦保存，避免逐键写盘
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
        「提炼」预设是公开主流工具系统提示词的中文提炼（调研见
        <code class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]">docs/research/agent-system-prompts.md</code>
        ）；「完整原文」预设提取自本机安装包，未做改写（原文存
        <code class="rounded bg-[var(--color-chip-bg)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[11px]">docs/research/prompts/</code>
        ）。选择后对新会话生效。
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="rounded-xl border p-3 text-left transition-colors"
          :class="
            settings.prompt.presetId === preset.id
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)]'
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
              完整原文
            </Badge>
          </div>
          <p class="m-0 mt-1 text-[11.5px] leading-snug text-[var(--color-mut)]">
            {{ preset.description }}
          </p>
          <p class="m-0 mt-1 truncate text-[10.5px] text-[var(--color-dim)]">
            来源：{{ preset.origin }}
          </p>
        </button>
        <button
          type="button"
          class="rounded-xl border p-3 text-left transition-colors"
          :class="
            settings.prompt.presetId === 'custom'
              ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-line)] hover:bg-[var(--color-menu-hover)]'
          "
          :aria-pressed="settings.prompt.presetId === 'custom'"
          @click="selectPreset('custom')"
        >
          <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">自定义</span>
          <p class="m-0 mt-1 text-[11.5px] text-[var(--color-mut)]">
            完全按你的规则约束 Agent 的行为与输出。
          </p>
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="m-0 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-txt-strong)]">
        {{ settings.prompt.presetId === 'custom' ? '编辑自定义提示词' : '预览' }}
        <span class="text-[11px] font-normal text-[var(--color-dim)]">{{ previewChars }} 字符</span>
      </h3>
      <p class="m-0 text-[11.5px] text-[var(--color-mut)]">
        Zen 会自动附加工作目录、平台、日期、可用技能与 MCP 清单；这里的内容是核心行为规则。
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
