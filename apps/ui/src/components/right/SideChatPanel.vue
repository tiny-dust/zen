<script setup lang="ts">
import {
  IconAlertCircle as CircleAlert,
  IconDots as Dots,
  IconLoader2 as Loader2,
  IconPlayerStop as PlayerStop,
  IconSend as Send,
  IconTrash as Trash,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useModelsStore } from "@/stores/models";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSideChatStore } from "@/stores/side-chat";

import type { SideChatMessage, SideChatModelRef } from "@zen/shared";

/**
 * 侧边对话面板：一条记录一个标签，消息 / 草稿 / 模型都在记录里独立落库。
 * 关闭标签只关视图；这里只读写 side-chat store，不碰主会话的任何状态。
 */
const props = defineProps<{ chatId: string }>();

const { t } = useI18n();
const store = useSideChatStore();
const models = useModelsStore();
const rightPanel = useRightPanelStore();
const { loading } = storeToRefs(store);

const record = computed(() => store.recordOf(props.chatId));
const live = computed(() => store.liveOf(props.chatId));
const running = computed(() => live.value?.running ?? false);
const messages = computed<SideChatMessage[]>(() => record.value?.messages ?? []);
const showEmpty = computed(() => !!record.value && !messages.value.length && !live.value);

const draft = ref("");
const sendError = ref("");
const deleteOpen = ref(false);
const deleting = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
let draftDirty = false;
let draftTimer: ReturnType<typeof setTimeout> | null = null;

/** 模型下拉：只列已启用且不是明确不支持工具的模型 */
const modelOptions = computed(() =>
  models.enabledModels.filter((item) => item.model.capabilities?.toolCall !== false),
);
const modelValue = computed(() => {
  const model = record.value?.model;
  return model ? `${model.providerId}:${model.modelId}` : "default";
});

function syncDraftFromStore() {
  draft.value = store.draftOf(props.chatId);
  draftDirty = false;
}

watch(() => props.chatId, syncDraftFromStore, { immediate: true });

// 记录首次加载后恢复上次未提交的草稿（正在输入时不覆盖）
watch(
  () => record.value?.id,
  (id) => {
    if (id && !draftDirty) {
      syncDraftFromStore();
    }
    scrollToBottom(true);
  },
);

function scheduleDraft(value: string) {
  if (draftTimer) {
    clearTimeout(draftTimer);
  }
  draftTimer = setTimeout(() => {
    draftTimer = null;
    store.saveDraft(props.chatId, value);
    draftDirty = false;
  }, 400);
}

function onInput(value: string | number) {
  draft.value = String(value);
  draftDirty = true;
  scheduleDraft(draft.value);
}

function flushDraft() {
  if (!draftDirty) {
    return;
  }
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  store.saveDraft(props.chatId, draft.value);
  draftDirty = false;
}

async function submit() {
  const text = draft.value.trim();
  if (!text || running.value) {
    return;
  }
  sendError.value = "";
  const result = await store.send(props.chatId, text);
  if (!result.ok) {
    if (result.error) {
      sendError.value = t("sideChat.sendFailed", { message: result.error });
    }
    // store 已把原文回填草稿，同步回输入框
    draft.value = store.draftOf(props.chatId);
    return;
  }
  draft.value = "";
  draftDirty = false;
  scrollToBottom(true);
}

function stop() {
  void store.stop(props.chatId);
}

function onModelChange(value: unknown) {
  const next = String(value ?? "default");
  if (next === "default") {
    void store.setModel(props.chatId, null, record.value?.effort ?? null);
    return;
  }
  const index = next.indexOf(":");
  if (index <= 0) {
    return;
  }
  const model: SideChatModelRef = {
    providerId: next.slice(0, index),
    modelId: next.slice(index + 1),
  };
  void store.setModel(props.chatId, model, record.value?.effort ?? null);
}

async function confirmDelete() {
  deleting.value = true;
  sendError.value = "";
  const result = await store.remove(props.chatId);
  deleting.value = false;
  if (!result.ok) {
    sendError.value = t("sideChat.deleteFailed", {
      message: result.error ?? t("sideChat.deleteRunning"),
    });
    deleteOpen.value = false;
    return;
  }
  deleteOpen.value = false;
  rightPanel.closeSideChat(props.chatId);
}

// ---------- 滚动：只在用户已在底部附近时跟随 ----------
let stickToBottom = true;

function onScroll() {
  const el = scrollEl.value;
  if (!el) {
    return;
  }
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

function scrollToBottom(force = false) {
  void nextTick(() => {
    const el = scrollEl.value;
    if (!el) {
      return;
    }
    if (force || stickToBottom) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

watch(
  () => [live.value?.text, live.value?.userText, messages.value.length, running.value] as const,
  () => scrollToBottom(),
);

let unbindStream: (() => void) | null = null;

onMounted(() => {
  unbindStream = store.bindStream();
  void store.ensureLoaded(props.chatId);
  scrollToBottom(true);
});

onUnmounted(() => {
  flushDraft();
  unbindStream?.();
  unbindStream = null;
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-col overflow-hidden" data-testid="side-chat-panel">
    <!-- 头部：标题 / 状态 / 模型 / 更多 -->
    <header
      class="flex flex-none items-center gap-2 border-b border-[var(--color-line-soft)] px-2 py-1.5"
    >
      <span
        class="size-1.5 flex-none rounded-full"
        :class="running ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-dim)]'"
        :aria-label="running ? t('sideChat.running') : t('sideChat.idle')"
        data-testid="side-chat-status"
      />
      <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt-strong)]">
        {{ record?.title ?? t("sideChat.tabTitle") }}
      </span>
      <span class="flex-none text-[11px] text-[var(--color-dim)]">
        {{ running ? t("sideChat.running") : t("sideChat.idle") }}
      </span>
      <Select :model-value="modelValue" @update:model-value="onModelChange">
        <SelectTrigger
          size="sm"
          class="h-7 w-[150px] flex-none text-[12px]"
          :aria-label="t('sideChat.modelAria')"
          data-testid="side-chat-model"
        >
          <SelectValue :placeholder="t('sideChat.followDefault')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{{ t("sideChat.followDefault") }}</SelectItem>
          <SelectItem
            v-for="item in modelOptions"
            :key="`${item.provider.id}:${item.model.id}`"
            :value="`${item.provider.id}:${item.model.id}`"
          >
            {{ item.provider.name }} / {{ item.model.name }}
          </SelectItem>
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="flex-none text-[var(--color-mut)]"
            :aria-label="t('sideChat.more')"
            :title="t('sideChat.more')"
          >
            <Dots />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-[140px]">
          <DropdownMenuItem
            class="gap-2 text-[var(--color-danger-fg)]"
            :disabled="running"
            data-testid="side-chat-delete"
            @select="deleteOpen = true"
          >
            <Trash class="size-4" aria-hidden="true" />
            <span class="flex-1">{{ t("sideChat.delete") }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>

    <!-- 消息区 -->
    <div
      ref="scrollEl"
      class="min-h-0 flex-1 overflow-auto px-2 py-2"
      data-testid="side-chat-messages"
      @scroll="onScroll"
    >
      <p v-if="loading && !record" class="m-0 px-1 py-3 text-[12px] text-[var(--color-dim)]">
        {{ t("panels.loading") }}
      </p>
      <p
        v-else-if="showEmpty"
        class="m-0 px-1 py-3 text-[12px] leading-relaxed text-[var(--color-dim)]"
        data-testid="side-chat-empty"
      >
        {{ t("sideChat.empty") }}
      </p>

      <ol v-if="messages.length || live" class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="message in messages"
          :key="message.id"
          class="flex flex-col gap-0.5"
          :class="message.role === 'user' ? 'items-end' : 'items-start'"
        >
          <div
            class="max-w-[92%] whitespace-pre-wrap break-words rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] leading-relaxed"
            :class="
              message.role === 'user'
                ? 'bg-[var(--color-menu-active)] text-[var(--color-txt-strong)]'
                : 'bg-[var(--color-np-btn-bg)] text-[var(--color-txt)]'
            "
          >
            {{ message.text }}
          </div>
          <p
            v-if="message.error"
            class="m-0 flex max-w-[92%] items-start gap-1 text-[11px] text-[var(--color-danger-fg)]"
            role="alert"
            data-testid="side-chat-error"
          >
            <CircleAlert class="mt-0.5 size-3 flex-none" aria-hidden="true" />
            <span class="whitespace-pre-wrap break-words">{{ message.error }}</span>
          </p>
        </li>

        <!-- 进行中的一轮：主进程落库前先在本地画出来 -->
        <template v-if="live">
          <li v-if="live.userText" class="flex flex-col items-end gap-0.5">
            <div
              class="max-w-[92%] whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--color-menu-active)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--color-txt-strong)]"
            >
              {{ live.userText }}
            </div>
          </li>
          <li class="flex flex-col items-start gap-0.5">
            <div
              class="flex max-w-[92%] items-start gap-1.5 whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--color-np-btn-bg)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--color-txt)]"
            >
              <Loader2
                v-if="live.running && !live.text"
                class="mt-0.5 size-3 flex-none animate-spin text-[var(--color-accent)]"
                aria-hidden="true"
              />
              <span v-if="live.text">{{ live.text }}</span>
              <span v-else-if="live.running" class="text-[var(--color-dim)]">
                {{ t("sideChat.waiting") }}
              </span>
            </div>
            <p
              v-if="live.error"
              class="m-0 flex max-w-[92%] items-start gap-1 text-[11px] text-[var(--color-danger-fg)]"
              role="alert"
            >
              <CircleAlert class="mt-0.5 size-3 flex-none" aria-hidden="true" />
              <span class="whitespace-pre-wrap break-words">{{ live.error }}</span>
            </p>
          </li>
        </template>
      </ol>
    </div>

    <!-- 输入区 -->
    <footer class="flex flex-none flex-col gap-1 border-t border-[var(--color-line-soft)] p-2">
      <p v-if="sendError" class="m-0 text-[11px] text-[var(--color-danger-fg)]" role="alert">
        {{ sendError }}
      </p>
      <div class="flex items-end gap-1">
        <Textarea
          :model-value="draft"
          class="max-h-40 min-h-[60px] text-[13px]"
          :placeholder="t('sideChat.placeholder')"
          :aria-label="t('sideChat.placeholder')"
          data-testid="side-chat-composer"
          @update:model-value="onInput"
          @blur="flushDraft"
          @keydown.enter.exact.prevent="submit"
        />
        <Button
          v-if="running"
          variant="outline"
          size="icon-sm"
          class="flex-none"
          :aria-label="t('sideChat.stop')"
          :title="t('sideChat.stop')"
          data-testid="side-chat-stop"
          @click="stop"
        >
          <PlayerStop class="size-4" />
        </Button>
        <Button
          v-else
          variant="default"
          size="icon-sm"
          class="flex-none"
          :aria-label="t('sideChat.send')"
          :title="t('sideChat.send')"
          :disabled="!draft.trim()"
          data-testid="side-chat-send"
          @click="submit"
        >
          <Send class="size-4" />
        </Button>
      </div>
    </footer>

    <ConfirmDialog
      :open="deleteOpen"
      :title="t('sideChat.deleteTitle', { title: record?.title ?? '' })"
      :description="t('sideChat.deleteDesc')"
      :confirm-label="t('sideChat.delete')"
      :pending="deleting"
      @update:open="(open: boolean) => (deleteOpen = open)"
      @confirm="confirmDelete"
    />
  </div>
</template>
