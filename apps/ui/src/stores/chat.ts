import { defineStore } from "pinia";
import { uuid } from "rattail";
import { computed, ref } from "vue";

import type { AgentStreamEvent, ChatMessage } from "@zen/shared";
import type { AppInfo } from "@/types/zen-api";

type RunStatus = "idle" | "running" | "error";

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const input = ref("");
  const status = ref<RunStatus>("idle");
  const statusText = ref("");
  const lastError = ref("");
  const sessionId = ref(uuid());
  const sessionName = ref("新会话");
  const appInfo = ref<AppInfo | null>(null);

  const isRunning = computed(() => status.value === "running");
  const hasMessages = computed(() => messages.value.length > 0);
  const canSend = computed(() => input.value.trim().length > 0 && !isRunning.value);
  const workspaceRoot = computed(() => appInfo.value?.workspaceRoot ?? "");

  function appendMessage(message: ChatMessage) {
    messages.value.push(message);
  }

  function appendDelta(text: string) {
    const last = messages.value.at(-1);
    if (last?.role === "assistant") {
      last.content += text;
      return;
    }
    appendMessage({
      id: uuid(),
      role: "assistant",
      content: text,
      createdAt: Date.now(),
    });
  }

  function handleStreamEvent(event: AgentStreamEvent) {
    if (event.type === "delta") {
      appendDelta(event.text);
      return;
    }
    if (event.type === "error") {
      status.value = "error";
      lastError.value = event.message;
      statusText.value = event.message;
      return;
    }
    if (event.type === "done") {
      status.value = "idle";
      statusText.value = event.reason === "cancelled" ? "已取消" : "";
    }
  }

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen) {
      status.value = "error";
      lastError.value = "preload bridge 未注入";
      statusText.value = lastError.value;
      return () => undefined;
    }

    void zen.app.info().then((info) => {
      appInfo.value = info;
    });

    return zen.agent.onEvent(handleStreamEvent);
  }

  async function send() {
    const zen = window.zen;
    const text = input.value.trim();
    if (!zen || !text || isRunning.value) {
      return;
    }

    lastError.value = "";
    input.value = "";
    if (sessionName.value === "新会话") {
      sessionName.value = text.slice(0, 24) + (text.length > 24 ? "…" : "");
    }

    appendMessage({
      id: uuid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    });

    status.value = "running";
    statusText.value = "Agent 思考中…";

    const result = await zen.agent.run({
      sessionId: sessionId.value,
      userMessage: text,
      workspaceRoot: workspaceRoot.value,
    });

    if (!result.ok) {
      status.value = "error";
      lastError.value = result.error ?? "运行失败";
      statusText.value = lastError.value;
    }
  }

  async function cancel() {
    const zen = window.zen;
    if (!zen || !isRunning.value) {
      return;
    }
    await zen.agent.cancel(sessionId.value);
  }

  return {
    messages,
    input,
    status,
    statusText,
    lastError,
    sessionId,
    sessionName,
    appInfo,
    isRunning,
    hasMessages,
    canSend,
    workspaceRoot,
    bootstrap,
    send,
    cancel,
  };
});
