<script setup lang="ts">
import { Loader2, Server, Terminal, X } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { useAgentServicesStore } from "@/stores/agent-services";

/**
 * 右栏「服务」面板：runTerminal 起的常驻进程（dev server / watch 等）。
 * 左列只显示优化后的展示名（label），选中后在下方展示完整命令、目录、
 * 进程与终端输出尾部（runTerminal 的 outputTail 由主进程实时累计）。
 */
const services = useAgentServicesStore();
const { items, error, killingIds, expandedId } = storeToRefs(services);
const { t } = useI18n();

onMounted(() => {
  services.bindEvents();
});

function startedAtLabel(startedAt: number): string {
  return new Date(startedAt).toLocaleString();
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
    <p v-if="error" class="m-0 truncate px-1 text-[11px] text-[var(--color-err)]" role="alert">
      {{ error }}
    </p>
    <p v-if="!items.length" class="m-0 px-1 py-3 text-[12px] text-[var(--color-mut)]">
      {{ t("app.services.empty") }}
    </p>

    <section
      v-for="item in items"
      :key="item.id"
      class="rounded-[var(--radius-sm)] border border-[var(--color-line-soft)] bg-[var(--color-set-card)]"
    >
      <div class="flex items-center gap-1 pr-1.5">
        <Button
          variant="ghost"
          class="h-auto min-h-8 min-w-0 flex-1 justify-start gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left font-normal"
          :aria-expanded="expandedId === item.id"
          :title="item.command"
          @click="services.toggle(item.id)"
        >
          <Server class="size-3.5 flex-none text-[var(--color-accent)]" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">
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
          class="size-5! flex-none rounded-[4px]! text-[var(--color-dim)] hover:text-[var(--color-del)]"
          :disabled="killingIds[item.id] === true"
          :aria-label="t('shell.closeService', { name: item.label })"
          :title="t('shell.closeServiceTitle')"
          @click="services.kill(item.id)"
        >
          <X class="size-3" />
        </Button>
      </div>

      <div
        v-if="expandedId === item.id"
        class="flex flex-col gap-1.5 border-t border-[var(--color-line-soft)] px-2 py-1.5"
      >
        <p class="m-0 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-txt)]">
          {{ item.command }}
        </p>
        <p class="m-0 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]">
          {{ item.cwd }}
        </p>
        <p class="m-0 text-[10px] text-[var(--color-dim)]">
          {{ t("shell.serviceStartedAt", { time: startedAtLabel(item.startedAt) }) }}
          · {{ t("shell.servicePids", { pids: item.pids.join(", ") }) }}
        </p>

        <div class="flex items-center gap-1 text-[10px] text-[var(--color-dim)]">
          <Terminal class="size-3 flex-none" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ t("app.services.outputTitle") }}</span>
        </div>
        <pre
          v-if="item.output"
          class="m-0 max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--color-code-bg)] p-2 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--color-code-fg)]"
        >{{ item.output }}</pre>
        <p v-else class="m-0 flex items-center gap-1.5 text-[11px] text-[var(--color-dim)]">
          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
          {{ t("app.services.outputPending") }}
        </p>
      </div>
    </section>
  </div>
</template>
