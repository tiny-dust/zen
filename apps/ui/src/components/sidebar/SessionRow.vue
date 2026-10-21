<script setup lang="ts">
import { Archive, ArchiveRestore, LoaderCircle, Pin, Trash2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { classes } from "rattail";

import DangerIconButton from "@/components/base/DangerIconButton.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  archive: [archived: boolean];
  remove: [];
  "toggle-select": [];
}>();

const sessionStatus = useSessionStatusStore();
const { byId } = storeToRefs(sessionStatus);

const { t } = useI18n();

const runtimeStatus = computed<SessionRuntimeStatus>(() => byId.value[props.session.id] ?? "idle");
const running = computed(() => runtimeStatus.value === "running");
const needsAction = computed(() => runtimeStatus.value === "needs_action");

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
 * 行结构：单行标题（超长截断）+ 行尾状态槽（运行 spinner / 需要操作 / 未读点 / 已置顶标识）；
 * 仅选中的会话整行圆角浅色底，其余（含运行中）为普通文本 + hover 高亮，
 * 运行状态只通过行尾 spinner 表达，不参与选中底色。
 * 注意必须是 computed：普通 const 只在 setup 时求值一次，点击切换会话后
 * props.active 变化不会反映到 class（高亮会冻结在首帧状态）。
 */
const rowCls = computed(() =>
  classes(
    "group/session relative flex h-8 w-full items-center rounded-[var(--radius-sm)] pr-1.5 pl-2 text-left text-[13px] transition-colors duration-[var(--motion-fast)]",
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

const slotCls = "flex size-4 flex-none items-center justify-center";

/** 行尾操作簇：绝对定位悬浮于行上，hover/聚焦时显现，不改变标题排版；
    底色不透明（--color-side-chip），盖住截断在按钮区下的标题文字；
    右侧让出行尾置顶开关（pr-1.5 + size-5 = 26px），不遮挡其点击 */
const hoverClusterCls = computed(() =>
  classes(
    "absolute top-1/2 right-[26px] z-10 flex -translate-y-1/2 items-center gap-px rounded-[var(--radius-sm)] p-px",
    props.active ? "bg-[var(--color-side-chip-active)]" : "bg-[var(--color-side-chip)]",
    "pointer-events-none opacity-0 transition-opacity duration-[var(--motion-fast)]",
    "group-hover/session:pointer-events-auto group-hover/session:opacity-100",
    "focus-within:pointer-events-auto focus-within:opacity-100",
  ),
);
const actionSlotCls = "flex size-7 flex-none items-center justify-center rounded-[var(--radius-sm)]";
const ghostActionCls = classes(
  actionSlotCls,
  "text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]",
);
</script>

<template>
  <div :class="rowCls" :aria-current="active && !batchMode ? 'true' : undefined" @click="batchMode ? emit('toggle-select') : undefined">
    <!-- 批量模式：行首勾选框（点击行任意位置即切换，勾选行加选中底色） -->
    <Checkbox
      v-if="batchMode"
      :model-value="selected"
      class="mr-1.5 ml-0.5 flex-none"
      :aria-label="t('sidebar.batchSelectedCount', { n: 1 })"
      @click.stop
      @update:model-value="emit('toggle-select')"
    />
    <Button
      variant="ghost"
      class="h-full flex min-w-0 flex-1 items-center px-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      @click="batchMode ? emit('toggle-select') : emit('open')"
    >
      <span :class="titleCls">{{ session.title }}</span>
    </Button>

    <span v-if="running" :class="slotCls" :title="t('sidebar.running')" :aria-label="t('sidebar.running')" role="status">
      <LoaderCircle
        class="size-3.5 shrink-0 animate-spin text-[var(--color-accent)]"
        aria-hidden="true"
      />
    </span>
    <!-- 需要操作：文字 tag 比图标更醒目（askUser 问询 / 工具审批等待） -->
    <span
      v-else-if="needsAction"
      class="flex h-4 flex-none items-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-2)_16%,transparent)] px-1.5 text-[10px] leading-none font-medium text-[var(--color-accent-2)]"
      :title="t('sidebar.awaitingConfirmTitle')"
      :aria-label="t('sidebar.pendingConfirm')"
      role="status"
    >
      {{ t("sidebar.pendingConfirm") }}
    </span>
    <span
      v-else-if="showResultDot"
      :class="slotCls"
      :title="resultDotLabel"
      :aria-label="resultDotLabel"
      role="status"
    >
      <span class="size-1.5 shrink-0 rounded-full" :class="resultDotCls" aria-hidden="true" />
    </span>

    <!-- 行尾置顶开关：置顶时常显（accent 斜钉），可直接点击取消；未置顶时 hover 才浮现（批量模式下隐藏） -->
    <button
      v-if="!batchMode"
      type="button"
      class="flex size-5 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-mut)] transition-opacity duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)] focus-visible:opacity-100 group-hover/session:opacity-100"
      :class="session.pinned ? 'opacity-100' : 'opacity-0'"
      :aria-label="session.pinned ? t('sidebar.unpin') : t('sidebar.pin')"
      :title="session.pinned ? t('sidebar.unpin') : t('sidebar.pin')"
      @click.stop="emit('pin')"
    >
      <Pin
        class="size-3 shrink-0"
        :class="session.pinned ? '-rotate-45 text-[var(--color-accent)]' : ''"
        aria-hidden="true"
      />
    </button>

    <div v-if="!batchMode" :class="hoverClusterCls">
      <Button
        variant="ghost"
        size="icon-sm"
        :class="ghostActionCls"
        :aria-label="session.archived ? t('sidebar.unarchive') : t('sidebar.archive')"
        :title="session.archived ? t('sidebar.unarchive') : t('sidebar.archive')"
        @click="emit('archive', !session.archived)"
      >
        <ArchiveRestore v-if="session.archived" class="size-[13px] shrink-0" />
        <Archive v-else class="size-[13px] shrink-0" />
      </Button>
      <DangerIconButton
        :class="actionSlotCls"
        :label="t('sidebar.deleteSession')"
        @click="emit('remove')"
      >
        <Trash2 class="size-[13px] shrink-0" />
      </DangerIconButton>
    </div>
  </div>
</template>
