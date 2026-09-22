<script setup lang="ts">
import { Loader2, Plug, Sparkles } from "@lucide/vue";
import { computed } from "vue";

import { useChatStore } from "@/stores/chat";
import { useSkillUsageStore } from "@/stores/skill-usage";

import type { SkillUsageItem } from "@/stores/skill-usage";

/**
 * 输入框上方的「本会话调用」tag 行：Agent 调用了哪些技能 / MCP 服务，
 * 新调用以弹出动效出现，进行中的调用带旋转指示；再次调用触发 10s 呼吸高亮。
 * 同名技能/MCP 在 store 层已合并为一条。数据来自 skill-usage store。
 */
const chatStore = useChatStore();
const usageStore = useSkillUsageStore();

const entries = computed(() => usageStore.entriesOf(chatStore.sessionId));

function tooltip(item: SkillUsageItem): string {
  const label = item.kind === "mcp" ? `MCP 服务 ${item.name}` : `技能 ${item.name}`;
  return `${label} · 本会话已调用 ${item.calls} 次`;
}

/** 再次调用呼吸高亮：交替 class 重启 CSS animation，10s 后 store 清 breathUntil */
function breathClass(item: SkillUsageItem): string {
  if (!item.breathUntil) {
    return "";
  }
  return item.breathSeq % 2 === 0 ? "usage-breath usage-breath-a" : "usage-breath usage-breath-b";
}
</script>

<template>
  <TransitionGroup
    v-if="entries.length"
    tag="div"
    name="usage"
    class="mb-2 flex flex-wrap items-center gap-1.5"
    aria-label="本会话已调用的技能与 MCP 服务"
  >
    <span
      v-for="item in entries"
      :key="item.key"
      class="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-chip-bg)] px-2 py-[3px] text-[11px] text-[var(--color-mut)]"
      :class="[item.running ? 'text-[var(--color-txt-strong)]' : '', breathClass(item)]"
      :title="tooltip(item)"
    >
      <Loader2 v-if="item.running" class="size-3 animate-spin" aria-hidden="true" />
      <Sparkles v-else-if="item.kind === 'skill'" class="size-3" aria-hidden="true" />
      <Plug v-else class="size-3" aria-hidden="true" />
      <span class="max-w-[160px] truncate leading-none">{{ item.name }}</span>
      <span
        v-if="item.calls > 1"
        class="text-[10px] leading-none text-[var(--color-dim)]"
      >×{{ item.calls }}</span>
    </span>
  </TransitionGroup>
</template>

<style scoped>
/* 新 tag 弹出：上浮 + 轻微放大；只动位移与透明度（规范：动效走 token） */
.usage-enter-active {
  transition:
    opacity var(--motion-base) var(--ease-emph),
    transform var(--motion-base) var(--ease-emph);
}
.usage-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.9);
}
.usage-leave-active {
  transition: opacity var(--motion-fast) var(--ease-exit);
}
.usage-leave-to {
  opacity: 0;
}
.usage-move {
  transition: transform var(--motion-base) var(--ease-emph);
}

/* 再次调用呼吸高亮：边框/底色在 accent 与常色间周期变化；交替 class 重启 animation */
@keyframes usage-breathe {
  0%,
  100% {
    border-color: var(--color-line);
    background-color: var(--color-chip-bg);
  }
  50% {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 14%, var(--color-chip-bg));
  }
}
.usage-breath-a,
.usage-breath-b {
  animation: usage-breathe 1.4s ease-in-out infinite;
}
</style>
