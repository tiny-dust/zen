<script setup lang="ts">
import { ListChecks, MessagesSquare, Rocket } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat";

import type { SessionMode } from "@zen/shared";

defineProps<{
  /** 小屏底栏：只显示当前模式 icon，标签进 title */
  compact?: boolean;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const { sessionMode } = storeToRefs(chatStore);

/** 三档模式的展示元数据（icon + i18n 文案键） */
const MODE_META: Record<SessionMode, { icon: typeof MessagesSquare }> = {
  interactive: { icon: MessagesSquare },
  plan: { icon: ListChecks },
  autopilot: { icon: Rocket },
};

const modes: SessionMode[] = ["interactive", "plan", "autopilot"];

const modeLabel = (mode: SessionMode) => t(`session-mode.sessionMode.modes.${mode}.label`);

const currentIcon = computed(() => MODE_META[sessionMode.value].icon);
</script>

<template>
  <!-- 会话模式三档：宽屏文字+图标，小屏仅 icon（与 PermissionPicker 同构） -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="items-center rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
        :class="compact ? 'size-7 justify-center' : 'h-7 gap-1 px-2'"
        :aria-label="t('session-mode.sessionMode.pickerAria')"
        :title="t('session-mode.sessionMode.pickerTitle', { label: modeLabel(sessionMode) })"
      >
        <component :is="currentIcon" :size="16" class="flex-none text-[var(--composer-ic-mode)]" />
        <span v-if="!compact" class="text-[11px] font-normal">{{ modeLabel(sessionMode) }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72">
      <DropdownMenuRadioGroup
        :model-value="sessionMode"
        @update:model-value="(mode) => chatStore.setSessionMode(mode as SessionMode)"
      >
        <DropdownMenuRadioItem
          v-for="mode in modes"
          :key="mode"
          :value="mode"
          class="items-start gap-2 py-1.5"
        >
          <component :is="MODE_META[mode].icon" class="mt-0.5 size-4 flex-none" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ modeLabel(mode) }}
            </span>
            <span class="text-[11px] leading-relaxed text-[var(--color-mut)]">
              {{ t(`session-mode.sessionMode.modes.${mode}.description`) }}
            </span>
          </div>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
