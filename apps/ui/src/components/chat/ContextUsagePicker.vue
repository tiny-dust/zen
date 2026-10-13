<script lang="ts">
/** token 缩写：166.1K / 1.0M→1M / 22.4M（小于 1K 直接显示整数；整数倍不带 .0） */
export function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${Math.round((value / 1000) * 10) / 10}K`;
  }
  return `${Math.round((value / 1_000_000) * 10) / 10}M`;
}
</script>

<script setup lang="ts">
import { Gauge, GitBranch } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chat";
import { useGitStore } from "@/stores/git";

/**
 * 输入框底栏的上下文用量入口（从会话信息卡迁移）。
 * 弹层按统计面板样式分四段：本轮上下文（用量+进度条）→ tokens/缓存命中/会话消耗 →
 * 压缩重点保留（选项 chips + 自定义）→ 分支 + 绿色用量条。
 * 弹层本地开关 + fixed + -translate-y-full 向上展开（同 ComposerBranchPicker） */

defineProps<{
  /** 窄底栏：触发器只显示图标+百分比（默认就紧凑，预留扩展位） */
  compact?: boolean;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const gitStore = useGitStore();

const anchorEl = ref<HTMLElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);
const open = ref(false);
const popupPos = ref({ top: 0, left: 0 });

const usage = computed(() => chatStore.contextUsage ?? 0);
const usageHigh = computed(() => usage.value >= 80);

/** 展示用输入 tokens：真实 usage 优先，未上报时用本地估算 */
const inputTokens = computed(
  () => chatStore.lastInputTokens ?? chatStore.estimatedInputTokens ?? 0,
);
const windowTokens = computed(() => Math.round(chatStore.contextWindowTokens ?? 0));
const cacheHit = computed(() => chatStore.cacheHitRate);
const sessionTokens = computed(() => chatStore.sessionTotalTokens);
const branch = computed(() => gitStore.branch || chatStore.branch);

/** 压缩重点保留的预置选项：id 稳定（i18n 换语言不影响选中判断），标签进 compressFocus */
const focusOptions = computed(() => [
  { id: "code", label: t("chat.context.focus.code") },
  { id: "goal", label: t("chat.context.focus.goal") },
  { id: "errors", label: t("chat.context.focus.errors") },
  { id: "files", label: t("chat.context.focus.files") },
  { id: "decisions", label: t("chat.context.focus.decisions") },
  { id: "recent", label: t("chat.context.focus.recent") },
]);

/** 选项选中判定 = 标签出现在 compressFocus 文本里（单一数据源，无并行状态） */
function isFocusSelected(label: string): boolean {
  return chatStore.compressFocus.includes(label);
}

/** 点选项：选中→从文本摘除该标签；未选中→追加（用顿号分隔，与中文输入习惯一致） */
function toggleFocus(label: string): void {
  const focus = chatStore.compressFocus;
  if (isFocusSelected(label)) {
    const next = focus
      .split(/[,，、;；]/)
      .map((part) => part.trim())
      .filter((part) => part && part !== label)
      .join("、");
    chatStore.compressFocus = next;
    return;
  }
  const trimmed = focus.replace(/[,，、;；\s]+$/, "");
  chatStore.compressFocus = trimmed ? `${trimmed}、${label}` : label;
}

function onDocPointerDown(event: PointerEvent) {
  if (!open.value) {
    return;
  }
  const target = event.target as Node | null;
  if (!target) {
    return;
  }
  // 弹层 Teleport 到 body 后不在锚点内，点弹层内部不能算外部点击
  const inside =
    (!!anchorEl.value && anchorEl.value.contains(target)) ||
    (!!popupEl.value && popupEl.value.contains(target));
  if (!inside) {
    close();
  }
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  }
}

function close() {
  open.value = false;
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
}

function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
  const rect = anchorEl.value?.getBoundingClientRect();
  if (rect) {
    popupPos.value = { top: rect.top, left: rect.left };
  }
}

onMounted(() => {
  gitStore.startStatusWatch();
});
onBeforeUnmount(() => {
  close();
  gitStore.stopStatusWatch();
});
</script>

<template>
  <div ref="anchorEl" class="relative flex-none">
    <Button
      variant="ghost"
      class="flex-none items-center gap-1 rounded-lg px-1.5 font-[family-name:var(--font-mono)] text-[11px]"
      :class="[compact ? 'size-7 justify-center px-0' : 'h-7', usageHigh ? 'text-[var(--color-err)]' : 'text-[var(--color-mut)]']"
      :aria-label="t('chat.contextUsage')"
      :title="chatStore.contextUsageTitle"
      :aria-expanded="open"
      @click="toggle"
    >
      <Gauge class="size-3.5" aria-hidden="true" />
      <span v-if="!compact" class="font-sans font-normal">{{ t("chat.context.label") }}</span>
      <span v-if="chatStore.contextUsage != null">{{ usage }}%</span>
    </Button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popupEl"
        class="fixed z-40 w-[320px] -translate-y-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-popover)] p-3 shadow-[var(--shadow-menu)]"
        :style="{ top: `${popupPos.top - 6}px`, left: `${popupPos.left}px` }"
        role="dialog"
        :aria-label="t('chat.context.panelTitle')"
      >
        <!-- 标题行：本轮上下文 + 用量% -->
        <div class="flex items-center justify-between gap-2">
          <span class="text-[12px] font-medium text-[var(--color-txt)]">
            {{ t("chat.context.panelTitle") }}
          </span>
          <span
            class="font-[family-name:var(--font-mono)] text-[12px]"
            :class="usageHigh ? 'text-[var(--color-err)]' : 'text-[var(--color-mut)]'"
          >
            {{ usage }}%
          </span>
        </div>
        <!-- 灰色用量进度条 -->
        <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-menu-hover)]">
          <div
            class="h-full rounded-full transition-[width] duration-300"
            :class="usageHigh ? 'bg-[var(--color-err)]' : 'bg-[var(--color-mut)]'"
            :style="{ width: `${Math.min(100, usage)}%` }"
          />
        </div>

        <!-- tokens / 缓存命中 -->
        <div class="mt-2.5 flex items-center justify-between gap-2 text-[12px]">
          <span class="font-[family-name:var(--font-mono)] text-[var(--color-txt)]">
            {{ formatTokens(inputTokens) }} / {{ windowTokens > 0 ? formatTokens(windowTokens) : "—" }}
          </span>
          <span
            v-if="cacheHit != null"
            class="font-[family-name:var(--font-mono)] text-[var(--color-mut)]"
            :title="t('chat.context.cacheHitTitle')"
          >
            {{ t("chat.context.cacheHit", { rate: cacheHit }) }}
          </span>
          <span
            v-else
            class="text-[var(--color-dim)]"
            :title="t('chat.context.cacheHitNoneTitle')"
          >
            {{ t("chat.context.cacheHitNone") }}
          </span>
        </div>
        <!-- 会话累计消耗 -->
        <div class="mt-1 text-[12px] text-[var(--color-mut)]">
          <template v-if="sessionTokens > 0">
            {{ t("chat.context.sessionTotal", { tokens: formatTokens(sessionTokens) }) }}
          </template>
          <template v-else>{{ t("chat.context.sessionTotalZero") }}</template>
        </div>

        <!-- 压缩时重点保留 -->
        <div class="mt-3 border-t border-[var(--color-line-soft)] pt-2.5">
          <div class="text-[12px] font-medium text-[var(--color-txt)]">
            {{ t("chat.context.compressTitle") }}
          </div>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="option in focusOptions"
              :key="option.id"
              type="button"
              class="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
              :class="
                isFocusSelected(option.label)
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-line-strong)] text-[var(--color-mut)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-menu-hover)] hover:text-[var(--color-txt)]'
              "
              :aria-pressed="isFocusSelected(option.label)"
              @click="toggleFocus(option.label)"
            >
              {{ option.label }}
            </button>
          </div>
          <Input
            v-model="chatStore.compressFocus"
            variant="ghost"
            class="mt-2 h-7 px-2 text-[12px] text-[var(--color-txt)] placeholder:text-[var(--color-mut)]"
            :placeholder="t('chat.context.focus.customPlaceholder')"
            :title="t('shell.compressFocusTitle')"
          />
          <div class="mt-1 text-[11px] leading-4 text-[var(--color-dim)]">
            {{ t("chat.context.compressHint") }}
          </div>
        </div>

        <!-- 底部：分支 + 绿色用量条 -->
        <div class="mt-3 flex items-center justify-between gap-2 border-t border-[var(--color-line-soft)] pt-2.5">
          <span
            class="flex min-w-0 items-center gap-1.5 font-[family-name:var(--font-mono)] text-[12px] text-[var(--color-mut)]"
            :title="branch || t('shell.noPullRequest')"
          >
            <GitBranch class="size-3.5 flex-none" aria-hidden="true" />
            <span class="truncate">{{ branch || t("shell.selectBranch") }}</span>
          </span>
          <span class="flex flex-none items-center gap-1.5">
            <span class="h-1 w-14 overflow-hidden rounded-full bg-[var(--color-menu-hover)]">
              <span
                class="block h-full rounded-full bg-[var(--color-add)] transition-[width] duration-300"
                :style="{ width: `${Math.min(100, usage)}%` }"
              />
            </span>
            <span class="font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)]">
              {{ usage }}%
            </span>
          </span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
