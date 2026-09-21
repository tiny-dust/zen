<script setup lang="ts">
import { storeToRefs } from "pinia";

import PermissionIcon from "@/components/brand/PermissionIcon.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentStore } from "@/stores/agent";

import type { PermissionMode } from "@zen/shared";
import { PERMISSION_MODES } from "@zen/shared";

defineProps<{
  /** 小屏底栏：只显示三态自绘 icon，标签进 title */
  compact?: boolean;
}>();

const agentStore = useAgentStore();
const { permissionMode, permissionLabel } = storeToRefs(agentStore);

const permissionModes = PERMISSION_MODES;

async function setPermissionMode(mode: unknown) {
  await agentStore.updateSettings({ permissionMode: mode as PermissionMode });
}
</script>

<template>
  <!-- 权限：宽屏文字+图标，小屏仅三态自绘 icon -->
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="items-center rounded-lg text-[var(--color-mut)] transition-colors hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt-strong)]"
        :class="compact ? 'size-7 justify-center' : 'h-7 gap-1 px-2'"
        aria-label="选择权限模式"
        :title="`权限：${permissionLabel}`"
      >
        <PermissionIcon :mode="permissionMode" :size="16" class="flex-none" />
        <span v-if="!compact" class="text-[11px] font-normal">{{ permissionLabel }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72">
      <DropdownMenuRadioGroup
        :model-value="permissionMode"
        @update:model-value="setPermissionMode"
      >
        <DropdownMenuRadioItem
          v-for="mode in permissionModes"
          :key="mode.id"
          :value="mode.id"
          class="items-start gap-2 py-1.5"
        >
          <PermissionIcon
            :mode="mode.id"
            class="mt-0.5 size-4 flex-none"
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[12.5px] font-medium text-[var(--color-txt-strong)]">
              {{ mode.label }}
            </span>
            <span class="text-[11px] leading-relaxed text-[var(--color-mut)]">
              {{ mode.description }}
            </span>
          </div>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
