<script setup lang="ts">
import { ArrowDown } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import ApprovalCard from "@/components/chat/ApprovalCard.vue";
import { groupTimelineMessages } from "@/components/chat/message-groups";
import ToolCallGroup from "@/components/chat/ToolCallGroup.vue";
import MessageBubble from "@/components/MessageBubble.vue";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";

import { getMessageRun } from "@zen/shared";

const chatStore = useChatStore();
const { messages, lastError } = storeToRefs(chatStore);
const timelineItems = computed(() => groupTimelineMessages(messages.value));

const listEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const showJump = ref(false);
/** 贴底跟随：用户上滚阅读时暂停自动滚动，接近底部时恢复 */
const stickToBottom = ref(true);

/** 顶部错误条：仅展示尚未归属到 assistant run 的错误，避免与消息终态行重复 */
const showTopError = computed(() => {
  if (!lastError.value) {
    return false;
  }
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index];
    if (message?.role === "assistant") {
      const run = getMessageRun(message);
      return run?.reason !== "error";
    }
  }
  return true;
});

function isFarFromBottom() {
  const el = listEl.value;
  if (!el) {
    return false;
  }
  return el.scrollHeight - el.scrollTop - el.clientHeight > 80;
}

function onScroll() {
  stickToBottom.value = !isFarFromBottom();
  showJump.value = isFarFromBottom();
  updateRulerViewport();
}

function scrollToBottom(smooth = false) {
  void nextTick(() => {
    const el = listEl.value;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

/* ------------------------------------------------------------------ */
/* 左侧刻度线：每个刻度是一次问询（用户消息），点击快速定位            */
/* ------------------------------------------------------------------ */

interface RulerTick {
  id: string;
  /** 问询摘要（悬浮提示） */
  label: string;
  /** 消息顶边相对内容顶部的偏移（px），点击即滚动到这里 */
  y: number;
  /** y / 内容总高，映射到刻度轨的纵向位置 */
  percent: number;
}

const ticks = ref<RulerTick[]>([]);
const activeTickId = ref<string | null>(null);
let rulerRaf = 0;

/** rAF 合并：流式期间 ResizeObserver/滚动会高频触发，避免逐帧量 DOM */
function scheduleTicksUpdate() {
  if (rulerRaf) {
    return;
  }
  rulerRaf = window.requestAnimationFrame(() => {
    rulerRaf = 0;
    updateTicks();
    updateRulerViewport();
  });
}

function updateTicks() {
  const container = listEl.value;
  const content = contentEl.value;
  if (!container || !content) {
    return;
  }
  const base = content.getBoundingClientRect().top;
  const total = content.offsetHeight || 1;
  const next: RulerTick[] = [];
  for (const el of content.querySelectorAll<HTMLElement>('[data-role="user"]')) {
    const id = el.dataset.mid ?? "";
    if (!id) {
      continue;
    }
    const y = el.getBoundingClientRect().top - base;
    const raw = (el.dataset.q ?? "").trim().replace(/\s+/g, " ");
    next.push({
      id,
      label: raw.length > 120 ? `${raw.slice(0, 120)}…` : raw || "（空消息）",
      y,
      percent: Math.max(0, Math.min(1, y / total)),
    });
  }
  ticks.value = next;
  updateRulerViewport();
}

/** 视口位置 → 高亮最近一次问询刻度（视口上沿 1/3 处所在区间） */
function updateRulerViewport() {
  const container = listEl.value;
  if (!container || !ticks.value.length) {
    activeTickId.value = null;
    return;
  }
  const line = container.scrollTop + container.clientHeight / 3;
  let current: string | null = null;
  for (const tick of ticks.value) {
    if (tick.y <= line) {
      current = tick.id;
    } else {
      break;
    }
  }
  activeTickId.value = current;
}

function jumpToTick(tick: RulerTick) {
  const container = listEl.value;
  if (!container) {
    return;
  }
  container.scrollTo({ top: Math.max(0, tick.y - 12), behavior: "smooth" });
}

// ref 源的 watch 是浅监听，push/流式 delta 这类嵌套变更不会触发；
// 精确监听会改变布局高度的三类变化：新消息、正文增长、推理文本增长
watch(
  () => [
    messages.value.length,
    messages.value.at(-1)?.content,
    messages.value.at(-1)?.reasoning,
  ],
  () => {
    if (stickToBottom.value) {
      scrollToBottom();
    }
    // 新消息/正文增长会改变内容高度，刻度位置需要重算
    scheduleTicksUpdate();
  },
);

// 刻度跟随当前会话与消息数量变化（含切换历史会话）
watch(
  () => [chatStore.sessionId, messages.value.length],
  () => {
    void nextTick(scheduleTicksUpdate);
  },
);

// markdown 是异步增量渲染，实际高度在 nextTick 之后才长出来；
// 用 ResizeObserver 兜底：内容长高且贴底时继续跟随，避免最新内容滞留视口外
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (stickToBottom.value) {
      const el = listEl.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    scheduleTicksUpdate();
  });
  if (contentEl.value) {
    resizeObserver.observe(contentEl.value);
  }
  window.addEventListener("resize", scheduleTicksUpdate);
  void nextTick(scheduleTicksUpdate);
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", scheduleTicksUpdate);
  if (rulerRaf) {
    window.cancelAnimationFrame(rulerRaf);
    rulerRaf = 0;
  }
});
</script>

<template>
  <section class="relative h-full min-h-0 min-w-0 flex-1 bg-[var(--color-main-bg)]" aria-label="对话">
    <!-- 左侧刻度线轨：刻度 = 一次问询的位置，点击定位 -->
    <nav v-if="ticks.length" class="chat-ruler" aria-label="问询刻度">
      <Button
        v-for="tick in ticks"
        :key="tick.id"
        variant="ghost"
        class="chat-ruler-tick"
        :class="{ 'chat-ruler-tick-active': tick.id === activeTickId }"
        :style="{ top: `${tick.percent * 100}%` }"
        :title="tick.label"
        :aria-label="`定位到问询：${tick.label}`"
        @click="jumpToTick(tick)"
      />
    </nav>

    <div
      ref="listEl"
      class="flex h-full flex-col overflow-auto px-4 pb-3 pt-4 [overflow-anchor:none]"
      @scroll.passive="onScroll"
    >
      <!-- 工具审批固定在对话区顶部，随时可见；Agent 提问卡在输入框上方（见 ChatComposer） -->
      <div
        v-if="chatStore.pendingApproval"
        class="sticky top-0 z-10 -mx-4 mb-1 flex flex-col gap-2 bg-[var(--color-main-bg)] px-4 pb-2 pt-3"
      >
        <div class="mx-auto flex w-full max-w-[860px] flex-col gap-2">
          <ApprovalCard />
        </div>
      </div>

      <div
        ref="contentEl"
        class="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-4"
      >
        <div v-if="messages.length === 0" class="m-auto text-center text-[var(--color-mut)]">
          <p class="m-0">开始一段对话</p>
          <p class="mt-2 text-[12px] text-[var(--color-dim)]">
            在下方输入并发送，Agent 将流式回复。
          </p>
        </div>
        <template v-else>
          <p
            v-if="showTopError"
            class="mx-auto w-full rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-2.5 py-2 text-[12px] text-[var(--color-danger-fg)] shadow-[var(--shadow-tip)]"
            role="alert"
          >
            {{ lastError }}
          </p>
          <div
            v-for="item in timelineItems"
            :key="item.key"
            class="chat-item"
            :data-mid="item.type === 'message' ? item.message.id : undefined"
            :data-role="item.type === 'message' ? item.message.role : undefined"
            :data-q="item.type === 'message' && item.message.role === 'user' ? item.message.content : undefined"
          >
            <ToolCallGroup v-if="item.type === 'tools'" :tools="item.tools" />
            <MessageBubble
              v-else
              :message="item.message"
              :streaming="chatStore.isRunning && item.message.id === messages.at(-1)?.id"
            />
          </div>
        </template>
      </div>
    </div>

    <!-- 离底较远时出现，回到底部（MiMo 同构圆形按钮） -->
    <Button
      v-show="showJump"
      variant="ghost"
      size="icon"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border-[var(--color-line-strong)] bg-[var(--color-composer-surface)] text-[var(--color-txt)] shadow-[var(--shadow-tip)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--color-txt-strong)]"
      aria-label="滚到底部"
      @click="scrollToBottom(true)"
    >
      <ArrowDown class="size-4" />
    </Button>
  </section>
</template>

<style scoped>
/* 时间线项：视口外跳过渲染与布局，长会话滚动/流式开销显著下降；
   contain-intrinsic-size 的 auto 关键字记住已渲染过的真实高度，滚动条保持稳定 */
.chat-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 96px;
  min-width: 0;
}

/* 刻度线轨：贴对话区左缘的细轨，刻度按内容高度等比分布 */
.chat-ruler {
  position: absolute;
  top: 16px;
  bottom: 12px;
  left: 3px;
  width: 10px;
  z-index: 5;
}

.chat-ruler-tick {
  position: absolute;
  left: 0;
  width: 7px;
  height: 2px;
  padding: 0;
  border: 0;
  border-radius: 1px;
  background: var(--color-line-strong);
  cursor: pointer;
  transform: translateY(-1px);
  transition: background-color var(--motion-fast) var(--ease-enter);
}

.chat-ruler-tick:hover {
  background: var(--color-txt);
}

.chat-ruler-tick-active {
  background: var(--color-accent);
}
</style>
