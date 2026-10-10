<script setup lang="ts">
import { Server, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";

import SessionSectionHead from "@/components/session/SessionSectionHead.vue";
import { Button } from "@/components/ui/button";
import { useAgentServicesStore } from "@/stores/agent-services";

/**
 * 会话信息卡「服务」节：主进程收集的 runTerminal 长驻进程
 * （dev server / watch 等，进程组跟踪）。行内可关闭整个进程组。
 */
const services = useAgentServicesStore();
const { items, error, killingIds } = storeToRefs(services);
const open = ref(true);

onMounted(() => {
  services.bindEvents();
});
</script>

<template>
  <section v-if="items.length" class="flex flex-col">
    <SessionSectionHead
      :icon="Server"
      title="服务"
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
        class="group/service flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[var(--color-mut)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]"
      >
        <span class="h-3.5 w-0.5 flex-none rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
        <Server class="size-3.5 flex-none" aria-hidden="true" />
        <span
          class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px]"
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
    </div>
  </section>
</template>
