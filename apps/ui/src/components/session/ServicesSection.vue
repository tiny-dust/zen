<script setup lang="ts">
import { ChevronDown, ChevronRight, Server, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useAgentServicesStore } from "@/stores/agent-services";

/**
 * 会话信息卡「服务」节：主进程收集的 runTerminal 长驻进程
 * （dev server / watch 等，进程组跟踪）。点击行展开命令 / 目录 / 进程详情，
 * 行内 X 关闭整个进程组。
 */
const services = useAgentServicesStore();
const { items, error, killingIds, expandedId } = storeToRefs(services);
const { t } = useI18n();
const open = ref(true);

onMounted(() => {
  services.bindEvents();
});

function startedAtLabel(startedAt: number): string {
  return new Date(startedAt).toLocaleString();
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
        class="overflow-hidden rounded-[var(--radius-sm)]"
        :class="expandedId === item.id ? 'bg-[var(--color-np-btn-bg)]' : ''"
      >
        <div class="group/service flex items-center gap-1 px-1 text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]">
          <Button
            variant="ghost"
            class="h-auto min-h-7 min-w-0 flex-1 justify-start gap-1 rounded-[var(--radius-sm)] px-0 py-1 text-left font-normal hover:bg-transparent"
            :aria-expanded="expandedId === item.id"
            @click="services.toggle(item.id)"
          >
            <span class="h-3.5 w-0.5 flex-none rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
            <Server class="size-3.5 flex-none" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px]">
              {{ item.command }}
            </span>
            <span class="flex-none text-[10px] text-[var(--color-dim)]" :title="t('shell.aliveProcessCount')">
              {{ item.pids.length }}
            </span>
            <span class="flex-none text-[10px] text-[var(--color-dim)]">
              {{ services.durationLabel(item.startedAt) }}
            </span>
            <component
              :is="expandedId === item.id ? ChevronDown : ChevronRight"
              class="size-3 flex-none text-[var(--color-dim)]"
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-5! flex-none rounded-[4px]! text-[var(--color-dim)] group-hover/service:opacity-100 hover:text-[var(--color-del)] md:opacity-60"
            :disabled="killingIds[item.id] === true"
            :aria-label="t('shell.closeService', { name: item.command })"
            :title="t('shell.closeServiceTitle')"
            @click="services.kill(item.id)"
          >
            <X class="size-3" />
          </Button>
        </div>

        <div v-if="expandedId === item.id" class="flex flex-col gap-1 px-2 pb-2 pl-6 text-[11px]">
          <p class="m-0 break-all font-[family-name:var(--font-mono)] text-[var(--color-txt)]">
            {{ item.command }}
          </p>
          <p class="m-0 break-all font-[family-name:var(--font-mono)] text-[var(--color-mut)]">
            {{ item.cwd }}
          </p>
          <p class="m-0 text-[var(--color-dim)]">
            {{ t("shell.serviceStartedAt", { time: startedAtLabel(item.startedAt) }) }}
            · {{ t("shell.servicePids", { pids: item.pids.join(", ") }) }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
