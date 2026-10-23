<script setup lang="ts">
import { Server, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useAgentServicesStore } from "@/stores/agent-services";
import { useRightPanelStore } from "@/stores/right-panel";

/**
 * 会话信息卡「服务」节：主进程收集的 runTerminal 长驻进程
 * （dev server / watch 等，进程组跟踪）。
 * 这里只显示优化后的展示名（完整命令作为悬停提示）；点击条目在右栏
 * 「服务」面板查看完整命令、目录与实时终端输出，行内 X 关闭整个进程组。
 */
const services = useAgentServicesStore();
const rightPanel = useRightPanelStore();
const { items, error, killingIds } = storeToRefs(services);
const { t } = useI18n();
const open = ref(true);

onMounted(() => {
  services.bindEvents();
});

/** 点击条目：打开右栏「服务」面板并展开该服务 */
function focusService(id: string) {
  services.focus(id);
  rightPanel.ensureTab("services");
}
</script>

<template>
  <section v-if="items.length" class="flex flex-col">
    <SessionSectionHead
      :icon="Server"
      :title="t('shell.services')"
      :open="open"
      :count="`${items.length}`"
      @toggle="open = !open"
    />

    <p
      v-if="open && error"
      class="m-0 mt-1 truncate px-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-err)]"
    >
      {{ error }}
    </p>

    <div v-if="open" class="mt-1 flex flex-col gap-0.5">
      <div
        v-for="item in items"
        :key="item.id"
        class="group/service flex items-center gap-1 px-1 text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]"
      >
        <Button
          variant="ghost"
          class="h-auto min-h-7 min-w-0 flex-1 justify-start gap-1 rounded-[var(--radius-sm)] px-0 py-1 text-left font-normal hover:bg-transparent"
          :title="item.command"
          :aria-label="t('shell.openServiceDetail', { name: item.label })"
          @click="focusService(item.id)"
        >
          <span class="h-3.5 w-0.5 flex-none rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
          <Server class="size-3.5 flex-none" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-[12px]">
            {{ item.label }}
          </span>
          <span class="flex-none text-[10px] text-[var(--color-dim)]" :title="t('shell.aliveProcessCount')">
            {{ item.pids.length }}
          </span>
          <span class="flex-none text-[10px] text-[var(--color-dim)]">
            {{ services.durationLabel(item.startedAt) }}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-5! flex-none rounded-[4px]! text-[var(--color-dim)] group-hover/service:opacity-100 hover:text-[var(--color-del)] md:opacity-60"
          :disabled="killingIds[item.id] === true"
          :aria-label="t('shell.closeService', { name: item.label })"
          :title="t('shell.closeServiceTitle')"
          @click="services.kill(item.id)"
        >
          <X class="size-3" />
        </Button>
      </div>
    </div>
  </section>
</template>
