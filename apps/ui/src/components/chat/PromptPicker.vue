<script setup lang="ts">
import { Settings2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import PromptAgentIcon from "@/components/brand/PromptAgentIcon.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentStore } from "@/stores/agent";
import { useSettingsStore } from "@/stores/settings";

import type { PromptViewVersion } from "@zen/shared";

defineProps<{
  /** 小屏底栏：只显示 agent icon，名称进 title */
  compact?: boolean;
}>();

const { t } = useI18n();
const agentStore = useAgentStore();
const { settings: agentSettings, presets } = storeToRefs(agentStore);
const settingsStore = useSettingsStore();

const activePromptName = computed(() => {
  if (agentSettings.value.prompt.presetId === "custom") {
    return t("chat.prompt.custom");
  }
  return (
    presets.value.find((item) => item.id === agentSettings.value.prompt.presetId)?.name ??
    t("chat.prompt.zenDefault")
  );
});

const activePromptId = computed(() => agentSettings.value.prompt.presetId || "zen-default");

/** 当前预设可切换的注入版本（内置预设才有 versions；自定义无） */
const versionOptions = computed(() => {
  const preset = presets.value.find((item) => item.id === activePromptId.value);
  const versions = preset?.versions;
  if (!versions) {
    return [];
  }
  const options: Array<{ id: PromptViewVersion; label: string }> = [];
  if (versions.distilled) {
    options.push({ id: "distilled", label: t("chat.prompt.versionDistilled") });
  }
  if (versions.zh) {
    options.push({ id: "zh", label: t("chat.prompt.versionZh") });
  }
  if (versions.en) {
    options.push({ id: "en", label: t("chat.prompt.versionEn") });
  }
  return options;
});

const activeVersion = computed<PromptViewVersion>(() => {
  const saved = agentSettings.value.prompt.version;
  if (saved && versionOptions.value.some((item) => item.id === saved)) {
    return saved;
  }
  // 缺省提炼版；不可用时取第一个可选项
  return versionOptions.value.some((item) => item.id === "distilled")
    ? "distilled"
    : (versionOptions.value[0]?.id ?? "distilled");
});

async function selectPromptPreset(id: unknown) {
  if (typeof id !== "string" || !id) {
    return;
  }
  await agentStore.updateSettings({
    prompt: {
      presetId: id,
      customText: agentSettings.value.prompt.customText,
      // 切换预设时校准版本：新预设没有当前版本时回落到默认（提炼版优先）
      version: normalizeVersionFor(id, agentSettings.value.prompt.version),
    },
  });
}

/** 目标预设可用版本里选一个：当前版本可用则保留，否则回落提炼版 */
function normalizeVersionFor(presetId: string, current?: PromptViewVersion): PromptViewVersion | undefined {
  if (presetId === "custom") {
    return undefined;
  }
  const versions = presets.value.find((item) => item.id === presetId)?.versions;
  if (!versions) {
    return undefined;
  }
  if (current && versions[current]) {
    return current;
  }
  return versions.distilled ? "distilled" : versions.zh ? "zh" : "en";
}

async function selectPromptVersion(id: unknown) {
  if (typeof id !== "string") {
    return;
  }
  await agentStore.updateSettings({
    prompt: {
      presetId: agentSettings.value.prompt.presetId,
      customText: agentSettings.value.prompt.customText,
      version: id as PromptViewVersion,
    },
  });
}

function openPromptSettings() {
  settingsStore.openSettings("prompts");
}
</script>

<template>
  <!-- 系统提示词：宽屏显示名称，小屏只显示 agent icon -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="items-center rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
        :class="compact ? 'size-7 justify-center' : 'h-7 max-w-[160px] gap-1 px-1.5'"
        :aria-label="t('chat.prompt.select')"
        :title="t('chat.prompt.label', { name: activePromptName })"
      >
        <PromptAgentIcon
          :preset-id="activePromptId"
          :name="activePromptName"
          :size="16"
          class="flex-none"
        />
        <span v-if="!compact" class="truncate text-[11px] font-normal">{{ activePromptName }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72">
      <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
        {{ t("chat.prompt.style") }}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        :model-value="agentSettings.prompt.presetId"
        @update:model-value="selectPromptPreset"
      >
        <DropdownMenuRadioItem
          v-for="preset in presets"
          :key="preset.id"
          :value="preset.id"
          class="items-start gap-2 py-1.5"
        >
          <PromptAgentIcon
            :preset-id="preset.id"
            :name="preset.name"
            :size="16"
            class="mt-0.5 flex-none"
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ preset.name }}
            </span>
            <span class="text-[11px] leading-snug text-[var(--color-mut)]">
              {{ preset.description }}
            </span>
          </div>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="custom" class="items-start gap-2 py-1.5">
          <PromptAgentIcon
            preset-id="custom"
            :size="16"
            class="mt-0.5 flex-none"
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ t("chat.prompt.custom") }}
            </span>
            <span class="text-[11px] text-[var(--color-mut)]">
              {{ t("chat.prompt.customHint") }}
            </span>
          </div>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <template v-if="versionOptions.length">
        <DropdownMenuSeparator />
        <DropdownMenuLabel class="text-[11px] text-[var(--color-dim)]">
          {{ t("chat.prompt.version") }}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="activeVersion"
          @update:model-value="selectPromptVersion"
        >
          <DropdownMenuRadioItem
            v-for="opt in versionOptions"
            :key="opt.id"
            :value="opt.id"
            class="py-1.5"
          >
            <span class="text-[12px]">{{ opt.label }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2" @select="openPromptSettings">
        <Settings2 class="size-3.5" />
        <span class="text-[12px]">{{ t("chat.prompt.goSettings") }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
