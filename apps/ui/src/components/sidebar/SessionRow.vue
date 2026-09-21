<script setup lang="ts">
import { Archive, ArchiveRestore, CircleAlert, LoaderCircle, Pin, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { classes } from "rattail";

import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Button } from "@/components/ui/button";
import { useSessionStatusStore } from "@/stores/session-status";

import type { SessionRuntimeStatus } from "@/stores/session-status";
import type { SessionRecord } from "@zen/shared";

const props = defineProps<{
  session: SessionRecord;
  active: boolean;
}>();

const emit = defineEmits<{
  open: [];
  pin: [];
  archive: [archived: boolean];
  remove: [];
}>();

const sessionStatus = useSessionStatusStore();
const { byId } = storeToRefs(sessionStatus);

const runtimeStatus = computed<SessionRuntimeStatus>(() => byId.value[props.session.id] ?? "idle");

/** 运行中的瞬时状态（spinner / 需要操作）保留图标；完成/失败改为未读圆点 */
const liveMeta = computed(() => {
  switch (runtimeStatus.value) {
    case "running":
      return { label: "进行中", tone: "running" as const };
    case "needs_action":
      return { label: "需要操作", tone: "needs" as const };
    default:
      return null;
  }
});

/** 结果未读圆点：会话完成/失败且尚未重新打开；停留在当前会话时不展示 */
const showResultDot = computed(
  () => !props.active && sessionStatus.hasUnseenResult(props.session.id),
);
const resultDotCls = computed(() =>
  runtimeStatus.value === "error" ? "bg-[var(--color-del)]" : "bg-[var(--color-ok)]",
);
const resultDotLabel = computed(() =>
  runtimeStatus.value === "error" ? "上次运行失败" : "上次已完成",
);

/**
 * 行结构：[状态点/置顶] 标题（占满整行）；置顶/归档/删除悬浮在行尾，
 * 不挤压标题。选中态只用高亮底色 + 加粗，不再有「当前」徽标。
 */
const rowCls = classes(
  "group/session relative flex h-9 w-full items-center gap-1.5 rounded-[var(--radius-sm)] py-0 pr-2 pl-2.5 text-left text-[13px] transition-colors duration-[var(--motion-fast)]",
  "text-[var(--color-side-item)]",
  [
    !props.active,
    "hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]",
  ],
  [
    props.active,
    "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)] font-medium",
  ],
  [runtimeStatus.value === "needs_action", "text-[var(--color-txt-strong)]"],
);

const titleCls = classes(
  "block w-max max-w-full truncate",
  [props.active, "font-semibold"],
  [!props.active && props.session.archived, "text-[var(--color-dim)]"],
);

const slotCls = "flex size-4 flex-none items-center justify-center";

/** 行尾操作簇：绝对定位悬浮于行上，hover/聚焦时显现，不改变标题排版；
    底色不透明（--color-side-chip），盖住跑马灯滚进按钮区的标题文字 */
const hoverClusterCls = classes(
  "absolute top-1/2 right-1.5 z-10 flex -translate-y-1/2 items-center gap-px rounded-[8px] p-px",
  props.active
    ? "bg-[var(--color-side-chip-active)]"
    : "bg-[var(--color-side-chip)]",
  "pointer-events-none opacity-0 transition-opacity duration-[var(--motion-fast)]",
  "group-hover/session:pointer-events-auto group-hover/session:opacity-100",
  "focus-within:pointer-events-auto focus-within:opacity-100",
);
const actionSlotCls = "flex size-7 flex-none items-center justify-center rounded-[6px]";
const ghostActionCls = classes(
  actionSlotCls,
  "text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]",
);

// ---------- 标题跑马灯：溢出时 hover 往返滚动，免去标题前后留白 ----------
const titleWrapEl = ref<HTMLElement | null>(null);
const titleTextEl = ref<HTMLElement | null>(null);
/** 标题溢出像素；>0 时挂 .session-title-scroll 并把距离交给 CSS 变量 */
const marqueeShift = ref(0);
let resizeObserver: ResizeObserver | null = null;

function measureTitle() {
  const wrap = titleWrapEl.value;
  const text = titleTextEl.value;
  if (!wrap || !text) {
    return;
  }
  marqueeShift.value = Math.max(0, Math.ceil(text.scrollWidth - wrap.clientWidth));
}

onMounted(() => {
  measureTitle();
  resizeObserver = new ResizeObserver(measureTitle);
  if (titleWrapEl.value) {
    resizeObserver.observe(titleWrapEl.value);
  }
  // 字体异步加载完成后宽度会变，重测一次
  document.fonts?.ready.then(measureTitle).catch(() => undefined);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
watch(
  () => props.session.title,
  () => measureTitle(),
);
</script>

<template>
  <div :class="rowCls" :aria-current="active ? 'true' : undefined">
    <span v-if="liveMeta" :class="slotCls" :title="liveMeta.label" :aria-label="liveMeta.label" role="status">
      <LoaderCircle
        v-if="liveMeta.tone === 'running'"
        class="size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
        aria-hidden="true"
      />
      <CircleAlert
        v-else
        class="size-3.5 shrink-0 text-[var(--color-accent-2,#ff8a4c)]"
        aria-hidden="true"
      />
    </span>
    <span v-if="showResultDot" :class="slotCls" :title="resultDotLabel" :aria-label="resultDotLabel" role="status">
      <span class="size-1.5 shrink-0 rounded-full" :class="resultDotCls" aria-hidden="true" />
    </span>
    <span
      v-if="session.pinned"
      :class="slotCls"
      title="已置顶"
      aria-label="已置顶"
    >
      <Pin class="size-3 shrink-0 -rotate-45 text-[var(--color-accent)]" aria-hidden="true" />
    </span>

    <Button
      variant="ghost"
      class="h-full flex min-w-0 flex-1 items-center px-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      @click="emit('open')"
    >
      <span
        ref="titleWrapEl"
        class="session-title-mask min-w-0 flex-1 overflow-hidden whitespace-nowrap"
      >
        <span
          ref="titleTextEl"
          :class="[titleCls, marqueeShift > 0 && 'session-title-scroll']"
          :style="{ '--marquee-shift': `-${marqueeShift}px` }"
        >{{ session.title }}</span>
      </span>
    </Button>

    <div :class="hoverClusterCls">
      <Button
        variant="ghost"
        size="icon-sm"
        :class="ghostActionCls"
        :aria-label="session.pinned ? '取消置顶' : '置顶'"
        :title="session.pinned ? '取消置顶' : '置顶'"
        @click.stop="emit('pin')"
      >
        <Pin
          class="size-[13px] shrink-0"
          :class="session.pinned ? '-rotate-45' : ''"
          aria-hidden="true"
        />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :class="ghostActionCls"
        :aria-label="session.archived ? '取消归档' : '归档'"
        :title="session.archived ? '取消归档' : '归档'"
        @click="emit('archive', !session.archived)"
      >
        <ArchiveRestore v-if="session.archived" class="size-[13px] shrink-0" />
        <Archive v-else class="size-[13px] shrink-0" />
      </Button>
      <DangerIconButton
        :class="actionSlotCls"
        label="删除会话"
        @click="emit('remove')"
      >
        <Trash2 class="size-[13px] shrink-0" />
      </DangerIconButton>
    </div>
  </div>
</template>
