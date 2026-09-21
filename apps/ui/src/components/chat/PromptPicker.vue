<script setup lang="ts">
import { Settings2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";

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

defineProps<{
  /** 小屏底栏：只显示 agent icon，名称进 title */
  compact?: boolean;
}>();

const agentStore = useAgentStore();
const { settings: agentSettings, presets } = storeToRefs(agentStore);
const settingsStore = useSettingsStore();

const activePromptName = computed(() => {
  if (agentSettings.value.prompt.presetId === "custom") {
    return "自定义";
  }
  return (
    presets.value.find((item) => item.id === agentSettings.value.prompt.presetId)?.name ??
    "Zen 默认"
  );
});

const activePromptId = computed(() => agentSettings.value.prompt.presetId || "zen-default");

async function selectPromptPreset(id: unknown) {
  if (typeof id !== "string" || !id) {
    return;
  }
  await agentStore.updateSettings({
    prompt: {
      presetId: id,
      customText: agentSettings.value.prompt.customText,
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
        aria-label="选择系统提示词风格"
        :title="`系统提示词：${activePromptName}`"
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
        系统提示词风格
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
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
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
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              自定义
            </span>
            <span class="text-[11px] text-[var(--color-mut)]">
              使用设置页中的自定义提示词
            </span>
          </div>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2" @select="openPromptSettings">
        <Settings2 class="size-3.5" />
        <span class="text-[12px]">前往设置 · 提示词</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
