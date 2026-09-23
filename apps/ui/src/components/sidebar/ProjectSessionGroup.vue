<script setup lang="ts">
import { Copy, ExternalLink, Folder, Globe, Pencil, Pin, PinOff, Plus, Trash2 } from "@lucide/vue";
import { computed } from "vue";

import SessionRow from "@/components/sidebar/SessionRow.vue";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspaceStore } from "@/stores/workspace";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const props = defineProps<{
  group: WorkspaceGroup;
  /** 已过滤并排序的全量会话 */
  sessions: SessionRecord[];
  /** 组折叠开关（false = 只显示组头行） */
  open: boolean;
  /** 展开显示全部会话（false = 截断 + 渐隐） */
  expanded: boolean;
  activeSessionId: string | null;
  /** 「在文件管理器中显示」按平台文案 */
  showInFolderLabel: string;
}>();

const emit = defineEmits<{
  toggle: [];
  "toggle-expand": [];
  "new-session": [];
  open: [session: SessionRecord];
  pin: [session: SessionRecord];
  archive: [session: SessionRecord, archived: boolean];
  remove: [session: SessionRecord];
  "pin-workspace": [];
  rename: [];
  "copy-path": [];
  "show-in-folder": [];
  "delete-workspace": [];
}>();

const workspaceStore = useWorkspaceStore();

const isCommon = computed(() => props.group.kind === "common");
const previewCount = workspaceStore.PREVIEW_COUNT;
/** 未展开时多渲染 1 条露头，配合渐隐遮罩提示还有更多 */
const shownSessions = computed(() =>
  props.expanded ? props.sessions : props.sessions.slice(0, previewCount + 1),
);
const truncated = computed(() => !props.expanded && props.sessions.length > previewCount);
const showExpandToggle = computed(() => props.sessions.length > previewCount);
</script>

<template>
  <div class="px-2 pb-0.5">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div
          class="group/row flex h-8 items-center rounded-[var(--radius-sm)] pr-1 text-[var(--color-side-item)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt-strong)]"
        >
          <Button
            variant="ghost"
            class="h-full flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-[12.5px] font-normal hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-inherit"
            :aria-expanded="open"
            :aria-label="group.name"
            @click="emit('toggle')"
          >
            <Globe
              v-if="isCommon"
              class="size-3.5 flex-none text-[var(--color-dim)]"
              aria-hidden="true"
            />
            <Folder
              v-else
              class="size-3.5 flex-none text-[var(--color-dim)]"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate font-medium">{{ group.name }}</span>
            <Pin
              v-if="group.pinned"
              class="size-3 flex-none -rotate-45 text-[var(--color-accent)]"
              aria-hidden="true"
            />
          </Button>
          <!-- 悬浮快捷操作：图标按钮 hover 只提亮图标不出底色，键盘聚焦时保持可见 -->
          <div
            class="flex flex-none items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] focus-within:opacity-100 group-hover/row:opacity-100"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-5 text-[var(--color-dim)] hover:text-[var(--color-txt-strong)] dark:hover:text-[var(--color-txt-strong)]"
              aria-label="新建会话"
              title="新建会话"
              @click.stop="emit('new-session')"
            >
              <Plus class="size-3.5" aria-hidden="true" />
            </Button>
            <template v-if="!isCommon">
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-5 text-[var(--color-dim)] hover:text-[var(--color-txt-strong)] dark:hover:text-[var(--color-txt-strong)]"
                :aria-label="group.pinned ? '取消置顶' : '置顶'"
                :title="group.pinned ? '取消置顶' : '置顶'"
                @click.stop="emit('pin-workspace')"
              >
                <PinOff v-if="group.pinned" class="size-3.5" aria-hidden="true" />
                <Pin v-else class="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-5 text-[var(--color-del)] hover:text-[var(--color-danger-fg)] dark:hover:text-[var(--color-danger-fg)]"
                aria-label="删除工作区"
                title="删除工作区"
                @click.stop="emit('delete-workspace')"
              >
                <Trash2 class="size-3.5" aria-hidden="true" />
              </Button>
            </template>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="text-[12.5px]">
        <ContextMenuItem @select="emit('new-session')">
          <Plus class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
          新建会话
        </ContextMenuItem>
        <template v-if="!isCommon">
          <ContextMenuSeparator />
          <ContextMenuItem @select="emit('pin-workspace')">
            <PinOff v-if="group.pinned" class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            <Pin v-else class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            {{ group.pinned ? "取消置顶" : "置顶" }}
          </ContextMenuItem>
          <ContextMenuItem @select="emit('rename')">
            <Pencil class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem @select="emit('copy-path')">
            <Copy class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            复制路径
          </ContextMenuItem>
          <ContextMenuItem @select="emit('show-in-folder')">
            <ExternalLink class="size-3.5 text-[var(--color-mut)]" aria-hidden="true" />
            {{ showInFolderLabel }}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" @select="emit('delete-workspace')">
            <Trash2 class="size-3.5" aria-hidden="true" />
            删除工作区
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="open && sessions.length" class="mt-0.5">
      <div class="flex flex-col gap-0.5 pl-6" :class="truncated && 'session-list-fade'">
        <SessionRow
          v-for="session in shownSessions"
          :key="session.id"
          :session="session"
          :active="activeSessionId === session.id"
          @open="emit('open', session)"
          @pin="emit('pin', session)"
          @archive="(archived) => emit('archive', session, archived)"
          @remove="emit('remove', session)"
        />
      </div>
      <div v-if="showExpandToggle" class="flex justify-center pr-10 pt-0.5">
        <Button
          variant="ghost"
          class="h-7 px-2 text-[11.5px] font-normal text-[var(--color-dim)] hover:bg-transparent hover:text-[var(--color-mut)] dark:hover:bg-transparent"
          @click="emit('toggle-expand')"
        >
          {{ expanded ? "收起" : "展开显示" }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 截断态：5 行 + 第 6 行露头 12px，底部渐隐提示还有更多 */
.session-list-fade {
  max-height: calc(32px * 5 + 2px * 5 + 12px);
  overflow: hidden;
  mask-image: linear-gradient(to bottom, var(--color-side) calc(100% - 26px), transparent);
  -webkit-mask-image: linear-gradient(to bottom, var(--color-side) calc(100% - 26px), transparent);
}
</style>
