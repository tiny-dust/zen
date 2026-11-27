<script setup lang="ts">
import { IconMessages as MessagesSquare } from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord } from "@zen/shared";

/**
 * 侧栏收起后仍能进会话：点轨道入口（或键盘 Enter）打开最近会话浮层。
 * 用受控浮层而不是 HoverCard：HoverCard 只认悬停，键盘打不开；
 * 这里按钮 Enter/Space 打开、Esc 关闭、点外部关闭，浮层绝对定位在轨道右侧不被裁切。
 * 数据直接读现有 workspace / chat store，不另存一份会话状态。
 */
const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const chatStore = useChatStore();
const { groups } = storeToRefs(workspaceStore);
const { sessionId } = storeToRefs(chatStore);

const RECENT_LIMIT = 20;
/** 显式受控：按钮点击/回车切换，避免依赖触发器内部的指针事件判定 */
const peekOpen = ref(false);

interface PeekRow {
  session: SessionRecord;
  groupName: string;
}

/** 最近活动的前 N 个会话：已归档的不出现，与侧栏展开态的可见范围一致 */
const rows = computed<PeekRow[]>(() => {
  const list: PeekRow[] = [];
  for (const group of groups.value) {
    if (group.archived) {
      continue;
    }
    for (const session of group.sessions) {
      if (!session.archived) {
        list.push({ session, groupName: group.name });
      }
    }
  }
  return list
    .sort((a, b) => (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0))
    .slice(0, RECENT_LIMIT);
});

/** 点浮层外部收起（capture 阶段判断，避免被内部按钮冒泡误关） */
function onDocumentClick(event: MouseEvent): void {
  if (!peekOpen.value) {
    return;
  }
  const target = event.target as Node | null;
  if (target && rootRef.value?.contains(target)) {
    return;
  }
  peekOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && peekOpen.value) {
    peekOpen.value = false;
  }
}

const rootRef = ref<HTMLElement | null>(null);
/** 浮层挂在 body 上并按触发按钮定位：轨道容器有 overflow 滚动，直接绝对定位会被裁切 */
const panelStyle = ref<Record<string, string>>({});

function togglePeek(): void {
  if (!peekOpen.value && rootRef.value) {
    const rect = rootRef.value.getBoundingClientRect();
    // 至少贴到轨道右缘：按钮本身居中在 52px 轨道里，直接用 rect.right 会压住图标
    panelStyle.value = { top: `${Math.round(rect.top)}px`, left: `${Math.max(Math.round(rect.right + 4), 56)}px` };
  }
  peekOpen.value = !peekOpen.value;
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
});

async function open(record: SessionRecord): Promise<void> {
  for (const group of groups.value) {
    if (group.sessions.some((item) => item.id === record.id)) {
      workspaceStore.setActive(group.id);
      break;
    }
  }
  await chatStore.loadSession(record);
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <Button
      variant="ghost"
      size="icon"
      :aria-label="t('sidebar.recentSessions')"
      :title="t('sidebar.recentSessions')"
      :aria-expanded="peekOpen"
      aria-haspopup="true"
      data-testid="rail-session-peek-trigger"
      @click="togglePeek()"
    >
      <MessagesSquare class="size-4" aria-hidden="true" />
    </Button>
    <Teleport to="body">
      <div
      v-if="peekOpen"
      class="fixed z-30 w-[248px] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-popover)] p-1 shadow-[var(--shadow-pop)]"
      role="group"
      :aria-label="t('sidebar.recentSessions')"
      :style="panelStyle"
      data-testid="rail-session-peek"
    >
      <p class="m-0 px-1.5 py-1 text-[11px] font-medium text-[var(--color-dim)]">
        {{ t("sidebar.recentSessions") }}
      </p>
      <p v-if="!rows.length" class="m-0 px-1.5 py-2 text-[12px] text-[var(--color-dim)]">
        {{ t("sidebar.noSessions") }}
      </p>
      <ul v-else class="m-0 flex max-h-[60vh] list-none flex-col gap-px overflow-auto p-0">
        <li v-for="row in rows" :key="row.session.id">
          <button
            type="button"
            class="flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors"
            :class="row.session.id === sessionId
              ? 'bg-[var(--color-menu-active)]'
              : 'hover:bg-[var(--color-menu-hover)]'"
            :aria-current="row.session.id === sessionId ? 'true' : undefined"
            @click="peekOpen = false; open(row.session)"
          >
            <span class="w-full truncate text-[12px] text-[var(--color-txt-strong)]">{{ row.session.title }}</span>
            <span class="w-full truncate text-[11px] text-[var(--color-dim)]">{{ row.groupName }}</span>
          </button>
        </li>
      </ul>
      </div>
    </Teleport>
  </div>
</template>
