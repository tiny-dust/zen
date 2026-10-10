<script setup lang="ts">
import { ArrowDown } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import ApprovalCard from "@/components/chat/ApprovalCard.vue";
import { groupTimelineMessages } from "@/components/chat/message-groups";
import type { TimelineItem } from "@/components/chat/message-groups";
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
/* 左侧引导线：每条时间线项一个等长刻度，点击定位；悬浮/键盘聚焦显示自绘 tooltip */
/* ------------------------------------------------------------------ */

type TickKind = "user" | "assistant" | "tools";

interface RulerTick {
  id: string;
  /** 刻度类型：tooltip 小标签用（常态样式不分档，全部等长等粗） */
  kind: TickKind;
  /** 消息摘要（悬浮提示） */
  label: string;
  /** 消息顶边相对内容顶部的偏移（px），点击即滚动到这里 */
  y: number;
}

/** 刻度提示文案：问询取原文，回复取正文摘录，工具组汇总条数 */
function tickLabel(item: TimelineItem): string {
  if (item.type === "tools") {
    return `工具记录 · ${item.tools.length} 项`;
  }
  const content = item.message.content.trim();
  if (item.message.role === "user") {
    return content;
  }
  // 回复可能很长，摘要封顶避免 DOM 属性随流式 delta 无限膨胀
  return content.slice(0, 160) || "助手回复";
}

const ticks = ref<RulerTick[]>([]);
const activeTickId = ref<string | null>(null);
let rulerRaf = 0;

/* ------------------------------------------------------------------ */
/* 刻度坡度：悬浮（或键盘聚焦）某刻度时，邻近刻度按距离衰减变长，形成整体坡度 */
/* ------------------------------------------------------------------ */

const hoverTickId = ref<string | null>(null);

const hoverTickIndex = computed(() => {
  if (!hoverTickId.value) {
    return -1;
  }
  return ticks.value.findIndex((tick) => tick.id === hoverTickId.value);
});

/** 基准 12px，悬浮峰值 34px（在 --chat-gutter 预留槽内生长），随距离每格衰减 4px，回落到基准为止 */
function tickStyle(index: number): Record<string, string> {
  const hovered = hoverTickIndex.value;
  if (hovered < 0) {
    return {};
  }
  const distance = Math.abs(index - hovered);
  const width = distance === 0 ? 34 : Math.max(12, 34 - distance * 4);
  return { "--tick-w": `${width}px` };
}

function setHoverTick(tick: RulerTick) {
  hoverTickId.value = tick.id;
}

function clearHoverTick() {
  hoverTickId.value = null;
}

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
  const next: RulerTick[] = [];
  for (const el of content.querySelectorAll<HTMLElement>(".chat-item[data-mid]")) {
    const id = el.dataset.mid ?? "";
    if (!id) {
      continue;
    }
    const role = el.dataset.role;
    const kind: TickKind = role === "user" ? "user" : role === "tools" ? "tools" : "assistant";
    const y = el.getBoundingClientRect().top - base;
    const raw = (el.dataset.q ?? "").trim().replace(/\s+/g, " ");
    next.push({
      id,
      kind,
      label: raw.length > 120 ? `${raw.slice(0, 120)}…` : raw || "（空消息）",
      y,
    });
  }
  ticks.value = next;
  updateRulerViewport();
}

/** 视口位置 → 高亮视口当前所在消息的刻度（视口上沿 1/3 处所在区间） */
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

/* ------------------------------------------------------------------ */
/* 刻度 tooltip：悬浮约 120ms 延迟显示、离开立即隐藏；键盘 focus-visible 同款 */
/* ------------------------------------------------------------------ */

const KIND_LABELS: Record<TickKind, string> = {
  user: "问询",
  assistant: "回复",
  tools: "工具记录",
};

interface RulerTipState {
  kind: TickKind;
  label: string;
  /** tooltip 锚点（fixed 定位，展示瞬间按刻度命中区实测，滚动后隐藏重测） */
  x: number;
  y: number;
}

const rulerTip = ref<RulerTipState | null>(null);
let tipShowTimer = 0;

function showRulerTip(tick: RulerTick, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  rulerTip.value = {
    kind: tick.kind,
    label: tick.label,
    x: rect.right + 8,
    y: rect.top + rect.height / 2,
  };
}

function hideRulerTip() {
  if (tipShowTimer) {
    window.clearTimeout(tipShowTimer);
    tipShowTimer = 0;
  }
  rulerTip.value = null;
}

function onTickEnter(tick: RulerTick, event: MouseEvent) {
  // 坡度跟随：悬浮即生效（无延迟），tooltip 仍延迟展示
  setHoverTick(tick);
  // 离开旧刻度立即隐藏，进入新刻度延迟 120ms，避免扫过时刻度轨闪烁
  hideRulerTip();
  const el = event.currentTarget as HTMLElement;
  tipShowTimer = window.setTimeout(() => {
    tipShowTimer = 0;
    showRulerTip(tick, el);
  }, 120);
}

function onTickFocus(tick: RulerTick, event: FocusEvent) {
  const el = event.currentTarget as HTMLElement;
  // 鼠标点击聚焦不弹 tooltip，仅键盘聚焦（:focus-visible）展示同款
  if (!el.matches(":focus-visible")) {
    return;
  }
  setHoverTick(tick);
  hideRulerTip();
  showRulerTip(tick, el);
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
    hideRulerTip();
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
  hideRulerTip();
});
</script>

<template>
  <section class="relative h-full min-h-0 min-w-0 flex-1 bg-[var(--color-main-bg)]" aria-label="对话">
    <!-- 左侧引导线轨：刻度簇整体垂直居中贴左缘，点击定位；悬浮/键盘聚焦弹自绘 tooltip。
         悬浮某刻度时邻近刻度按距离衰减变长（--tick-w），形成坡度 -->
    <nav
      v-if="ticks.length"
      class="chat-ruler"
      aria-label="消息刻度"
      @scroll.passive="hideRulerTip"
      @mouseleave="clearHoverTick"
    >
      <button
        v-for="(tick, index) in ticks"
        :key="tick.id"
        type="button"
        class="chat-ruler-tick"
        :class="{ 'chat-ruler-tick-active': tick.id === activeTickId }"
        :style="tickStyle(index)"
        :data-kind="tick.kind"
        :aria-label="`定位到消息：${tick.label}`"
        @click="jumpToTick(tick)"
        @mouseenter="onTickEnter(tick, $event)"
        @mouseleave="hideRulerTip"
        @focus="onTickFocus(tick, $event)"
        @blur="clearHoverTick"
      />
    </nav>

    <!-- 刻度 tooltip：Teleport 到 body + fixed 定位，展示瞬间按刻度实测坐标，不受刻度轨滚动影响 -->
    <Teleport to="body">
      <div
        v-if="rulerTip"
        class="chat-ruler-tip"
        :style="{ left: `${rulerTip.x}px`, top: `${rulerTip.y}px` }"
        role="tooltip"
      >
        <span class="chat-ruler-tip-kind">{{ KIND_LABELS[rulerTip.kind] }}</span>
        <span class="chat-ruler-tip-text">{{ rulerTip.label }}</span>
      </div>
    </Teleport>

    <div
      ref="listEl"
      class="flex h-full flex-col overflow-auto pl-[var(--chat-gutter)] pr-4 pb-3 pt-4 [overflow-anchor:none]"
      @scroll.passive="onScroll"
    >
      <!-- 工具审批固定在对话区顶部，随时可见；Agent 提问卡在输入框上方（见 ChatComposer）。
           左侧负边距随 --chat-gutter 拉通到容器边缘（覆盖刻度槽） -->
      <div
        v-if="chatStore.pendingApproval"
        class="sticky top-0 z-10 -ml-[var(--chat-gutter)] -mr-4 mb-1 flex flex-col gap-2 bg-[var(--color-main-bg)] pl-[var(--chat-gutter)] pr-4 pb-2 pt-3"
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
            :data-mid="item.key"
            :data-role="item.type === 'tools' ? 'tools' : item.message.role"
            :data-q="tickLabel(item)"
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

/* 引导线轨：刻度簇贴对话区左缘、整体垂直居中（safe center：放不下时退化为顶部对齐可滚动） */
.chat-ruler {
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  justify-content: safe center;
  gap: 2px;
  max-height: calc(100% - 32px);
  overflow-y: auto;
  padding: 2px 0;
  scrollbar-width: none;
  z-index: 5;
}

.chat-ruler::-webkit-scrollbar {
  display: none;
}

/* 刻度：按钮本体是 10px 高的隐形命中区（宽度盖住最长 34px 坡峰），横线用 ::before 画 */
.chat-ruler-tick {
  position: relative;
  flex: none;
  width: 38px;
  height: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.chat-ruler-tick::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  /* 宽度由 JS 按悬浮距离注入（--tick-w），基准 12px；width 过渡让坡度展开有动画 */
  width: var(--tick-w, 12px);
  height: 3px;
  border-radius: 2px;
  background: var(--color-mut);
  transition:
    width var(--motion-fast) var(--ease-enter),
    background-color var(--motion-fast) var(--ease-enter);
}

/* 悬浮反馈：提亮（长度由 --tick-w 坡度统一驱动，悬浮刻度峰值 34px，始终在 --chat-gutter 槽内） */
.chat-ruler-tick:hover::before {
  background: var(--color-txt-strong);
}

/* 当前视口所在消息：accent 高亮 */
.chat-ruler-tick-active::before {
  background: var(--color-accent);
}

.chat-ruler-tick-active:hover::before {
  background: var(--color-accent);
}

/* 刻度 tooltip：小标签（类型）+ 摘要正文（最多 2 行省略），纯展示不抢交互 */
.chat-ruler-tip {
  position: fixed;
  z-index: var(--z-popup);
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 240px;
  padding: 5px 8px;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-sm);
  background: var(--color-popover);
  box-shadow: var(--shadow-menu);
  transform: translateY(-50%);
  pointer-events: none;
}

.chat-ruler-tip-kind {
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-dim);
}

.chat-ruler-tip-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-txt);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
</style>
