<script setup lang="ts">
import { IconLayoutSidebar as PanelLeft } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import SystemInfoButton from "@/components/topbar/SystemInfoButton.vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout";

/**
 * 顶栏左段的两个常驻控件（会话面板开关 + 系统信息）。
 * 会话面板收起后左段只剩 52px 轨道、放不下交通灯+控件，此时把这一组挪到中段开头，
 * 保证「左段/中段的分界」始终等于下面内容区的左边界。
 */
const { t } = useI18n();
const layoutStore = useLayoutStore();
const { leftCollapsed } = storeToRefs(layoutStore);
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    :class="
      cn(
        'text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]',
        !leftCollapsed && 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]',
      )
    "
    :aria-label="leftCollapsed ? t('sidebar.expandPanel') : t('sidebar.collapsePanel')"
    :title="leftCollapsed ? t('sidebar.expandPanel') : t('sidebar.collapsePanel')"
    :aria-pressed="!leftCollapsed"
    @click="layoutStore.toggleLeft()"
  >
    <PanelLeft />
  </Button>
  <SystemInfoButton />
</template>
