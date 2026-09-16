<script setup lang="ts">
import { Check, ChevronDown, CirclePause, Loader2, Play, Square, Wrench, X } from "@lucide/vue";
import { computed, ref } from "vue";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";

const chatStore = useChatStore();
const expanded = ref(false);
const toolLabel = computed(() => chatStore.activeTool?.toolName || "准备中");
const isBusy = computed(() => chatStore.isRunning && !chatStore.isPaused);

const approvalInputText = computed(() => {
  const input = chatStore.pendingApproval?.input;
  if (input == null) {
    return "";
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
});
</script>

<template>
  <div
    v-if="chatStore.isRunning || chatStore.isPaused || chatStore.activeTool || chatStore.pendingApproval"
    class="mx-auto w-full max-w-[860px]"
    aria-live="polite"
  >
    <div v-if="chatStore.pendingApproval" class="rounded-[var(--radius)] bg-[var(--color-composer-surface)] p-3 shadow-[var(--shadow-raised)] outline outline-1 -outline-offset-1 outline-[color-mix(in_srgb,var(--color-accent-2)_25%,transparent)]">
      <div class="flex items-start gap-[9px]">
        <div class="grid size-6 flex-none place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--color-accent-2)_14%,transparent)] text-[var(--color-accent-2)]"><Wrench :size="15" /></div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-[7px] text-[var(--color-txt-strong)]">
            <strong>需要确认</strong>
            <Badge variant="outline">{{ chatStore.pendingApproval.toolName }}</Badge>
          </div>
          <p class="m-0 mt-0.5 truncate whitespace-normal text-[11px] text-[var(--color-mut)]">{{ chatStore.pendingApproval.prompt }}</p>
          <pre v-if="approvalInputText" class="mt-2 max-h-40 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-code-bg)] p-2.5 font-[family-name:var(--font-mono)] text-[11px] leading-normal whitespace-pre-wrap break-words text-[var(--color-code-fg)]">{{ approvalInputText }}</pre>
        </div>
      </div>
      <div class="mt-2.5 flex gap-2 pl-[33px]">
        <Button size="sm" @click="chatStore.approve(true)">
          <Check :size="14" data-icon="inline-start" />批准
        </Button>
        <Button variant="outline" size="sm" @click="chatStore.approve(false)">
          <X :size="14" data-icon="inline-start" />拒绝
        </Button>
      </div>
    </div>

    <div v-else class="flex items-center gap-[9px] rounded-[var(--radius)] bg-[var(--color-side-glass)] p-2.5 text-[12px] text-[var(--color-mut)] shadow-[var(--shadow-tip)]">
      <div :class="cn('grid size-6 flex-none place-items-center rounded-[7px] bg-[var(--color-chip-bg)] text-[var(--color-mut)]', isBusy && 'text-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]')">
        <Loader2 v-if="isBusy" class="animate-spin" :size="15" />
        <CirclePause v-else-if="chatStore.isPaused" :size="15" />
        <Check v-else :size="15" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-[7px] text-[var(--color-txt-strong)]">
          <strong>{{
            chatStore.isPaused
              ? "已暂停"
              : chatStore.status === "tool-running"
                ? "正在执行工具"
                : chatStore.phase === "thinking"
                  ? "正在思考"
                  : "正在回复"
          }}</strong>
          <Badge v-if="chatStore.activeTool" variant="secondary">
            <Wrench :size="11" data-icon="inline-start" />{{ toolLabel }}
          </Badge>
        </div>
        <p class="mt-0.5 truncate text-[11px] text-[var(--color-mut)]">{{ chatStore.activeTool?.message || chatStore.statusText || "Agent 正在处理请求" }}</p>
      </div>
      <template v-if="chatStore.isPaused">
        <Button variant="ghost" size="sm" @click="chatStore.resume()">
          <Play :size="14" data-icon="inline-start" />继续
        </Button>
      </template>
      <template v-else>
        <Button variant="ghost" size="sm" @click="chatStore.pause()">
          <CirclePause :size="14" data-icon="inline-start" />暂停
        </Button>
        <Button variant="ghost" size="sm" @click="chatStore.cancel()">
          <Square :size="14" data-icon="inline-start" />停止
        </Button>
      </template>
    </div>

    <button
      v-if="chatStore.toolHistory.length"
      type="button"
      class="ml-2.5 mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--color-dim)] hover:text-[var(--color-txt-strong)]"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <ChevronDown :class="cn('transition-transform duration-[var(--motion-fast)] ease-[var(--ease-enter)]', expanded && 'rotate-180')" :size="14" />
      {{ chatStore.toolHistory.length }} 个工具步骤
    </button>
    <div v-if="expanded" class="ml-3 mt-1.5 rounded-[var(--radius-sm)] bg-[var(--color-side-glass)] px-2.5 py-1.5">
      <div v-for="item in chatStore.toolHistory" :key="item.id" class="flex justify-between gap-3 py-[3px] text-[11px] text-[var(--color-mut)]">
        <span :class="cn('shrink-0', !item.ok && 'text-[var(--color-err)]')">{{ item.toolName }}</span>
        <span class="truncate text-[var(--color-dim)]">{{ item.summary }}</span>
      </div>
    </div>
  </div>
</template>

