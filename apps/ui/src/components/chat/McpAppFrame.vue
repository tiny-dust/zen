<script setup lang="ts">
import { AppWindow, Check, Copy, CornerDownLeft } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";

/**
 * MCP Apps 交互视图（SEP-1865）：MCP 工具结果里的 HTML 资源。
 * 安全：sandbox 只开 allow-scripts（唯一源，无 same-origin/表单/弹窗/导航），
 * 注入 CSP 禁止一切远程加载（default-src 'none'），不加载任意外链。
 * 桥：iframe 内 UI 可 postMessage({ type: 'zen:mcp', payload }) 回传交互事件；
 * 渲染层按 event.source 校验来源，第一版提供「复制 / 插入对话」两种回传方式。
 */
const props = defineProps<{
  html: string;
  /** 工具文本结果（给模型看的部分），有值时在帧上方带一行说明 */
  text?: string;
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const frameEl = shallowRef<HTMLIFrameElement | null>(null);

interface McpAppEvent {
  id: number;
  at: number;
  payload: unknown;
}

const events = ref<McpAppEvent[]>([]);
const copied = ref(false);
let eventSeq = 0;

/** 注入到 srcdoc 的基础头：CSP 禁远程资源 + 深浅双主题透明背景适配 */
const SRCDOC_HEAD =
  '<meta charset="utf-8">' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data: blob:;">' +
  "<style>:root{color-scheme:light dark}html,body{margin:0;background:transparent}body{color:CanvasText;font:13px/1.6 system-ui,sans-serif}</style>";

const srcdoc = computed(() => {
  const html = props.html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => head + SRCDOC_HEAD);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (tag) => tag + SRCDOC_HEAD);
  }
  return SRCDOC_HEAD + html;
});

function onMessage(event: MessageEvent) {
  // 只认本组件 iframe 发来的消息：沙箱 iframe 的 origin 是 null，用 source 比对
  if (!frameEl.value || event.source !== frameEl.value.contentWindow) {
    return;
  }
  const data = event.data;
  if (typeof data !== "object" || data === null || (data as { type?: unknown }).type !== "zen:mcp") {
    return;
  }
  eventSeq += 1;
  events.value = [...events.value.slice(-4), { id: eventSeq, at: Date.now(), payload: (data as { payload?: unknown }).payload }];
}

onMounted(() => {
  window.addEventListener("message", onMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
});

const latestPayloadJson = computed(() => {
  const latest = events.value[events.value.length - 1];
  if (!latest) {
    return "";
  }
  try {
    return JSON.stringify(latest.payload ?? null, null, 2);
  } catch {
    return String(latest.payload);
  }
});

async function copyLatestEvent() {
  if (!latestPayloadJson.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(latestPayloadJson.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // 剪贴板不可用时静默：用户仍可走「回传对话」
  }
}

/** 回传对话：把交互事件以文本插入输入框光标处（不自动发送，避免打断用户输入现场） */
function sendLatestToChat() {
  if (!latestPayloadJson.value) {
    return;
  }
  chatStore.insertAtComposerCaret(`[MCP App 交互事件] ${latestPayloadJson.value}`);
  document.getElementById("chat-input")?.focus();
}
</script>

<template>
  <div class="mcp-app-frame">
    <p v-if="text" class="mcp-app-note">{{ text }}</p>
    <iframe
      ref="frameEl"
      class="mcp-app-iframe"
      sandbox="allow-scripts"
      :srcdoc="srcdoc"
      :title="t('mcpapps.frameTitle')"
    />
    <div v-if="events.length" class="mcp-app-footer">
      <span class="mcp-app-event-label" :title="latestPayloadJson">
        {{ t("mcpapps.eventReceived") }}（{{ events.length }}）
      </span>
      <span class="mcp-app-actions">
        <Button
          variant="ghost"
          size="icon-xs"
          class="rounded-md hover:text-[var(--color-txt-strong)]"
          :aria-label="copied ? t('mcpapps.copied') : t('mcpapps.copyEvent')"
          :title="t('mcpapps.copyEventTitle')"
          @click="copyLatestEvent"
        >
          <Check v-if="copied" class="size-3.5" />
          <Copy v-else class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          class="rounded-md hover:text-[var(--color-txt-strong)]"
          :aria-label="t('mcpapps.sendToChat')"
          :title="t('mcpapps.sendToChatTitle')"
          @click="sendLatestToChat"
        >
          <CornerDownLeft class="size-3.5" />
        </Button>
      </span>
    </div>
    <div v-else class="mcp-app-footer mcp-app-footer-hint">
      <AppWindow class="size-3 shrink-0" aria-hidden="true" />
      <span>{{ t("mcpapps.sandboxNote") }}</span>
    </div>
  </div>
</template>

<style scoped>
.mcp-app-frame {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  margin: 4px 0 6px;
  border: 1px solid var(--color-line-soft);
  border-radius: var(--radius-sm);
  background: var(--color-code-bg);
  overflow: hidden;
}

/* 固定高度、帧内滚动（iframe 自身滚动） */
.mcp-app-iframe {
  display: block;
  width: 100%;
  height: 300px;
  border: 0;
  background: transparent;
  color-scheme: light dark;
}

.mcp-app-note {
  margin: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-line-soft);
  color: var(--color-mut);
  font-family: var(--font-sans);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 96px;
  overflow: auto;
}

.mcp-app-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-top: 1px solid var(--color-line-soft);
  color: var(--color-mut);
  font-family: var(--font-sans);
  font-size: 11px;
}

.mcp-app-event-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-app-footer-hint {
  color: var(--color-dim);
}

.mcp-app-actions {
  display: inline-flex;
  flex: none;
  gap: 2px;
}
</style>
