<script setup lang="ts">
import {
  IconArchive as Archive,
  IconArrowsSplit2 as Split,
  IconDownload as Download,
  IconPencil as Pencil,
  IconPin as Pin,
  IconPinnedOff as PinOff,
  IconTrash as Trash2,
} from "@tabler/icons-vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import type { SessionRecord } from "@zen/shared";

/**
 * 会话操作菜单：会话行的「更多」按钮与右键共用同一个实例（父级按坐标挂一份）。
 * 挂到 body 上，侧栏 overflow 裁不到；点外面 / Esc 收起。
 */
const props = defineProps<{
  session: SessionRecord;
  /** 相对窗口的坐标（右键为光标，更多按钮为按钮左下角） */
  x: number;
  y: number;
  /** 运行中的会话不能分叉（主进程会拒绝） */
  canFork: boolean;
}>();

const emit = defineEmits<{
  close: [];
  rename: [];
  pin: [];
  fork: [];
  export: [];
  archive: [archived: boolean];
  remove: [];
}>();

const { t } = useI18n();
const root = ref<HTMLElement | null>(null);

const MENU_WIDTH = 200;
const MENU_HEIGHT = 246;

/** 贴边时往里收，避免被窗口裁掉 */
const style = computed(() => ({
  left: `${Math.max(4, Math.min(props.x, window.innerWidth - MENU_WIDTH - 4))}px`,
  top: `${Math.max(4, Math.min(props.y, window.innerHeight - MENU_HEIGHT - 4))}px`,
}));

function onPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) {
    emit("close");
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  const items = Array.from(root.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  if (!items.length) {
    return;
  }
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  event.preventDefault();
}

onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  root.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
});

/** 先执行动作再收起：父级要读当前 session 才能定位操作对象 */
function act(fn: () => void) {
  fn();
  emit("close");
}

const itemCls =
  "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12px] text-[var(--color-txt)] transition-colors hover:bg-[var(--color-side-hover)] focus-visible:bg-[var(--color-side-hover)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";
</script>

<template>
  <Teleport to="body">
    <div ref="root" role="menu" :aria-label="t('sidebar.moreActions')"
      class="fixed z-[3000] w-[200px] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-popover)] p-1 shadow-[var(--shadow-pop)]"
      :style="style">
      <button type="button" role="menuitem" :class="itemCls" @click="act(() => emit('rename'))">
        <Pencil class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        {{ t("sidebar.renameSession") }}
      </button>
      <button type="button" role="menuitem" :class="itemCls" :disabled="!canFork"
        :title="canFork ? undefined : t('sidebar.forkRunning')"
        @click="act(() => emit('fork'))">
        <Split class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        {{ t("sidebar.forkSession") }}
      </button>
      <button type="button" role="menuitem" :class="itemCls" @click="act(() => emit('pin'))">
        <PinOff v-if="session.pinned" class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        <Pin v-else class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        {{ session.pinned ? t("sidebar.unpin") : t("sidebar.pin") }}
      </button>

      <div class="my-1 h-px bg-[var(--color-line-soft)]" role="separator" />

      <button type="button" role="menuitem" :class="itemCls" @click="act(() => emit('export'))">
        <Download class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        {{ t("features.exportSession") }}
      </button>
      <button type="button" role="menuitem" :class="itemCls" @click="act(() => emit('archive', !session.archived))">
        <Archive class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
        {{ session.archived ? t("sidebar.unarchive") : t("sidebar.archive") }}
      </button>
      <button type="button" role="menuitem" :class="[itemCls, 'text-[var(--color-del)]']"
        @click="act(() => emit('remove'))">
        <Trash2 class="size-3.5 flex-none" aria-hidden="true" />
        {{ t("sidebar.deleteSession") }}
      </button>
    </div>
  </Teleport>
</template>
