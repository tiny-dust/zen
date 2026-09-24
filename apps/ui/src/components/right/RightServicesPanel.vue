<script setup lang="ts">
import { RefreshCw, Server, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted } from "vue";

import { Button } from "@/components/ui/button";
import { useAgentServicesStore } from "@/stores/agent-services";

/**
 * 右侧悬浮面板 · 服务模块：主进程收集的 runTerminal 长驻进程
 * （dev server / watch 等，进程组跟踪）。行内可直接关闭整个进程组。
 */
const services = useAgentServicesStore();
const { items, error, killingIds } = storeToRefs(services);

onMounted(() => {
  services.bindEvents();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2" aria-label="长驻服务">
    <div class="flex flex-none items-center gap-0.5">
      <span class="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--color-txt-strong)]">
        服务 {{ items.length }}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="刷新服务列表"
        title="刷新"
        @click="services.refresh()"
      >
        <RefreshCw />
      </Button>
    </div>

    <p
      v-if="error"
      class="m-0 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-err)]"
    >
      {{ error }}
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-width:thin]">
      <div
        v-for="item in items"
        :key="item.id"
        class="group/service flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]"
      >
        <span class="h-3.5 w-0.5 flex-none rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
        <Server class="size-3.5 flex-none" aria-hidden="true" />
        <span
          class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11.5px]"
          :title="`${item.command}\n${item.cwd}`"
        >
          {{ item.command }}
        </span>
        <span class="flex-none text-[10px] text-[var(--color-dim)]" title="进程组存活进程数">
          {{ item.pids.length }}
        </span>
        <span class="flex-none text-[10px] text-[var(--color-dim)]">
          {{ services.durationLabel(item.startedAt) }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-5! flex-none rounded-[4px]! text-[var(--color-dim)] group-hover/service:opacity-100 hover:text-[var(--color-del)] md:opacity-60"
          :disabled="killingIds[item.id] === true"
          :aria-label="`关闭 ${item.command}`"
          title="关闭服务（结束整个进程组）"
          @click="services.kill(item.id)"
        >
          <X class="size-3" />
        </Button>
      </div>

      <p v-if="!items.length" class="m-0 px-1 py-2 text-[12px] text-[var(--color-dim)]">
        暂无长驻服务
      </p>
    </div>
  </div>
</template>
