<script setup lang="ts">
import { IconDots as Ellipsis, IconLoader2 as LoaderCircle, IconPin as Pin, IconPlugConnected as Server } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { classes } from "rattail";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAgentServicesStore } from "@/stores/agent-services";
import { useSessionStatusStore } from "@/stores/session-status";

import type { SessionRuntimeStatus } from "@/stores/session-status";
import type { SessionRecord } from "@zen/shared";

const props = defineProps<{
  session: SessionRecord;
  active: boolean;
  /** 批量管理模式：行首显示勾选框，点击行不再打开会话而是切换勾选 */
  batchMode?: boolean;
  /** 批量模式下的勾选态 */
  selected?: boolean;
}>();

const emit = defineEmits<{
  open: [];
  pin: [];
  "toggle-select": [];
  /** 「更多」按钮：交给父级定位会话菜单 */
  more: [anchor: HTMLElement];
  /** 右键：交给父级在光标处打开同一个会话菜单 */
  menu: [x: number, y: number];
  /** 悬停 / 键盘聚焦：el = null 表示离开（收起详情卡） */
  peek: [el: HTMLElement | null];
}>();

const sessionStatus = useSessionStatusStore();
const { byId } = storeToRefs(sessionStatus);
const { activeSessionCounts } = storeToRefs(useAgentServicesStore());

const { t } = useI18n();

const runtimeStatus = computed<SessionRuntimeStatus>(() => byId.value[props.session.id] ?? "idle");
const running = computed(() => runtimeStatus.value === "running");
const needsAction = computed(() => runtimeStatus.value === "needs_action");
const activeServiceCount = computed(() => activeSessionCounts.value[props.session.id] ?? 0);

/** 结果未读圆点：会话完成/失败且尚未重新打开；停留在当前会话时不展示 */
const showResultDot = computed(
  () => !props.active && !running.value && !needsAction.value && sessionStatus.hasUnseenResult(props.session.id),
);
const resultDotCls = computed(() =>
  runtimeStatus.value === "error" ? "bg-[var(--color-del)]" : "bg-[var(--color-ok)]",
);
const resultDotLabel = computed(() =>
  runtimeStatus.value === "error" ? t("sidebar.lastRunFailed") : t("sidebar.lastRunDone"),
);

/**
 * 行结构（对齐 nomi）：行首一个状态点（运行转圈 / 完成绿点 / 失败红点，不占额外列宽），
 * 单行标题，行尾只有置顶与「更多」；重命名/分叉/导出/归档/删除都在「更多」与右键的同一个菜单里。
 * 注意必须是 computed：普通 const 只在 setup 时求值一次，切换会话后高亮不会跟随。
 */
const rowCls = computed(() =>
  classes(
    "group/session relative flex h-8 w-full items-center rounded-[var(--radius-sm)] pr-1 pl-1 text-left text-[13px] transition-colors duration-[var(--motion-fast)]",
    "text-[var(--color-side-item)]",
    [
      !props.active,
      "hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)]",
    ],
    [
      props.active,
      "bg-[var(--color-side-sel)] text-[var(--color-txt-strong)] font-medium",
    ],
    [needsAction.value, "text-[var(--color-txt-strong)]"],
    [props.batchMode && props.selected, "bg-[var(--color-side-sel)]"],
  ),
);

const titleCls = computed(() =>
  classes("block min-w-0 flex-1 truncate", [
    !props.active && props.session.archived,
    "text-[var(--color-dim)]",
  ]),
);

/** 行首状态点：固定 12px 槽位，没有状态时留空，标题始终对齐 */
const leadCls = "flex size-3 flex-none items-center justify-center";

const tailBtnCls = classes(
  "flex size-5 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-mut)]",
  "transition-opacity duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)]",
  "focus-visible:opacity-100 group-hover/session:opacity-100",
);

/** 置顶按钮：置顶时常显，未置顶时 hover / 聚焦才浮现 */
const pinBtnCls = computed(() => `${tailBtnCls} ${props.session.pinned ? "opacity-100" : "opacity-0"}`);
/** 「更多」按钮：默认隐，hover / 聚焦时随 tailBtnCls 显现 */
const moreBtnCls = `${tailBtnCls} opacity-0`;

function onMore(event: MouseEvent) {
  emit("more", event.currentTarget as HTMLElement);
}

function onContextMenu(event: MouseEvent) {
  emit("menu", event.clientX, event.clientY);
}

function onPeek(event: Event) {
  emit("peek", event.currentTarget as HTMLElement);
}
</script>

<template>
  <div :class="rowCls" :aria-current="active && !batchMode ? 'true' : undefined"
    :data-session-id="session.id" @click="batchMode ? emit('toggle-select') : undefined"
    @mouseenter="onPeek" @mouseleave="emit('peek', null)" @focusin="onPeek" @focusout="emit('peek', null)"
    @contextmenu.prevent.stop="onContextMenu">
    <!-- 批量模式：行首勾选框（点击行任意位置即切换，勾选行加选中底色） -->
    <Checkbox
      v-if="batchMode"
      :model-value="selected"
      class="mr-1.5 ml-0.5 flex-none"
      :aria-label="t('sidebar.batchSelectedCount', { n: 1 })"
      @click.stop
      @update:model-value="emit('toggle-select')"
    />

    <!-- 行首状态：运行中转圈 / 完成未读绿点 / 失败红点（读屏用 role=status 文本） -->
    <span v-if="batchMode ? false : running || showResultDot" :class="leadCls"
      :title="running ? t('sidebar.running') : resultDotLabel"
      :aria-label="running ? t('sidebar.running') : resultDotLabel" role="status">
      <LoaderCircle v-if="running" class="size-3 shrink-0 animate-spin text-[var(--color-accent)]" aria-hidden="true" />
      <span v-else class="size-1.5 shrink-0 rounded-full" :class="resultDotCls" aria-hidden="true" />
    </span>

    <Button
      variant="ghost"
      class="h-full flex min-w-0 flex-1 items-center px-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      @click.stop="batchMode ? emit('toggle-select') : emit('open')"
    >
      <span :class="titleCls">{{ session.title }}</span>
    </Button>

    <!-- 需要操作：文字 tag 比图标更醒目（askUser 问询 / 工具审批等待） -->
    <span v-if="needsAction"
      class="mx-1 flex h-4 flex-none items-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-2)_16%,transparent)] px-1.5 text-[10px] leading-none font-medium text-[var(--color-accent-2)]"
      :title="t('sidebar.awaitingConfirmTitle')" :aria-label="t('sidebar.pendingConfirm')" role="status">
      {{ t("sidebar.pendingConfirm") }}
    </span>

    <span v-if="activeServiceCount > 0" class="mx-0.5 flex size-4 flex-none items-center justify-center text-[var(--color-accent)]"
      :title="t('sidebar.activeTerminalServices', { n: activeServiceCount })"
      :aria-label="t('sidebar.activeTerminalServices', { n: activeServiceCount })" role="status">
      <Server class="size-3.5 shrink-0" aria-hidden="true" />
    </span>

    <!-- 行尾置顶开关：置顶时常显（accent 斜钉），可直接点击取消；未置顶时 hover 才浮现 -->
    <button v-if="!batchMode" type="button" :class="pinBtnCls"
      :aria-label="session.pinned ? t('sidebar.unpin') : t('sidebar.pin')"
      :title="session.pinned ? t('sidebar.unpin') : t('sidebar.pin')"
      :data-pinned="session.pinned || undefined"
      @click.stop="emit('pin')">
      <Pin class="size-3 shrink-0" :class="session.pinned ? '-rotate-45 text-[var(--color-accent)]' : ''" aria-hidden="true" />
    </button>

    <!-- 「更多」：与右键同一个菜单（重命名 / 分叉 / 导出 / 归档 / 删除） -->
    <button v-if="!batchMode" type="button" :class="moreBtnCls"
      :aria-label="t('sidebar.moreActions')" :title="t('sidebar.moreActions')" aria-haspopup="menu"
      @click.stop="onMore">
      <Ellipsis class="size-3.5 shrink-0" aria-hidden="true" />
    </button>
  </div>
</template>
