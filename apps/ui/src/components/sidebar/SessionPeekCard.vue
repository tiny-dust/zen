<script setup lang="ts">
import { IconFolder as Folder } from "@tabler/icons-vue";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { SessionRecord } from "@zen/shared";

/**
 * 会话详情小卡（对齐 nomi）：悬停 / 键盘聚焦会话行时贴在行右侧弹出。
 * 首行标题 + 多久前，状态行，工作区行；点标题就地改名（Enter 保存、Esc 取消、失焦保存）。
 * 挂到 body 上，侧栏的 overflow 裁不到；鼠标移进卡片不收起，方便直接改名。
 */
const props = defineProps<{
  session: SessionRecord;
  /** 行中心相对窗口的纵坐标（卡片垂直居中） */
  top: number;
  left: number;
  /** 状态文案（运行中 / 需要操作 / 上次已完成…），空串不显示 */
  status: string;
  /** 所属工作区名（公共区为空） */
  place: string;
  /** 由父级打开改名（菜单里的「重命名」也走这里） */
  editing: boolean;
}>();

const emit = defineEmits<{
  rename: [title: string];
  "update:editing": [value: boolean];
  hold: [];
  release: [];
}>();

const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const draft = ref("");

const style = computed(() => ({
  top: `${props.top}px`,
  left: `${Math.max(8, Math.min(props.left, window.innerWidth - 340))}px`,
}));

/** 相对时间：与 nomi 详情卡一致，最近用「刚刚 / N 分钟前」，久了用天数 */
const relativeTime = computed(() => {
  const diff = Date.now() - (props.session.updatedAt || props.session.createdAt);
  if (diff < 60_000) return t("sidebar.justNow");
  if (diff < 3_600_000) return t("sidebar.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("sidebar.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  return t("sidebar.daysAgo", { n: Math.floor(diff / 86_400_000) });
});

watch(
  () => props.editing,
  async (editing) => {
    if (!editing) return;
    draft.value = props.session.title;
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
  { immediate: true },
);

function commit() {
  const next = draft.value.trim();
  emit("update:editing", false);
  if (next && next !== props.session.title) {
    emit("rename", next);
  }
}

function onKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Enter") commit();
  if (event.key === "Escape") emit("update:editing", false);
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed z-[2999] flex max-w-[320px] -translate-y-1/2 flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-popover)] px-2.5 py-1.5 shadow-[var(--shadow-pop)]"
      :style="style" role="dialog" :aria-label="session.title" @mouseenter="emit('hold')"
      @mouseleave="emit('release')">
      <div class="flex min-w-[200px] items-center gap-1.5">
        <input v-if="editing" ref="input" v-model="draft"
          class="h-6 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-1.5 text-[12px] font-medium text-[var(--color-txt-strong)] outline-none focus-visible:border-[var(--color-accent)]"
          maxlength="60" :aria-label="t('sidebar.sessionTitleLabel')" @keydown="onKeydown" @blur="commit">
        <button v-else type="button"
          class="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] text-left text-[12px] font-medium text-[var(--color-txt-strong)] hover:bg-[var(--color-side-hover)]"
          :title="t('sidebar.peekTitleHint')" @click="emit('update:editing', true)">
          {{ session.title }}
        </button>
        <span class="ml-auto flex-none pl-3 text-[11px] whitespace-nowrap text-[var(--color-dim)]">
          {{ relativeTime }}
        </span>
      </div>
      <span v-if="status" class="text-[11px] whitespace-nowrap text-[var(--color-mut)]">{{ status }}</span>
      <span v-if="place" class="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--color-mut)]" :title="place">
        <Folder class="size-3.5 flex-none" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ place }}</span>
      </span>
    </div>
  </Teleport>
</template>
