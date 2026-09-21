import { uuid } from "rattail";
import type { Ref } from "vue";

import type { ChatMessage, ChatTurn } from "@zen/shared";

import { buildHistory, collectTouchedFiles, collectUploads, compressHistory } from "@/stores/chat-types";
import { useSessionInfoStore } from "@/stores/session-info";

/** 压缩域的依赖：消息与状态由 chat store 持有 */
export interface CompressionDomainOptions {
  messages: Ref<ChatMessage[]>;
  sessionId: Ref<string>;
  statusText: Ref<string>;
  /** 手动压缩开关：点「压缩上下文」后置位，本会话后续发送都走摘要历史 */
  forceCompress: Ref<boolean>;
  /** 上下文用量（%），发送时求值 */
  contextUsage: () => number | null;
}

/**
 * 历史压缩域：滚动摘要 + 超限双保险 + 压缩摘要卡落库。
 * 摘要卡是 role=tool 的独立消息（toolName=contextCompact），展开可看折叠后的全文。
 */
export function createCompressionDomain(options: CompressionDomainOptions) {
  const { messages, sessionId, statusText, forceCompress, contextUsage } = options;

  /** 手动压缩：下一次发送起使用摘要历史（会话内保持） */
  function compressNow() {
    if (!messages.value.length) {
      return;
    }
    forceCompress.value = true;
    statusText.value = "已开启压缩：下一次发送起，更早对话将折叠为摘要";
  }

  /**
   * 压缩摘要卡：插到本轮问询之前并落库；摘要与上一张卡完全一致时不重复插。
   */
  function insertCompactCard(summary: string, compactedTurns: number): void {
    const zen = window.zen;
    const lastCard = [...messages.value]
      .reverse()
      .find(
        (item) =>
          item.role === "tool" &&
          (item.meta as { toolName?: string } | undefined)?.toolName === "contextCompact",
      );
    if (zen && lastCard && (lastCard.meta as { output?: string } | undefined)?.output === summary) {
      return;
    }
    const message: ChatMessage = {
      id: uuid(),
      role: "tool",
      content: "",
      createdAt: Date.now(),
      toolCallId: uuid(),
      meta: {
        toolName: "contextCompact",
        ok: true,
        state: "ok",
        summary: `已折叠 ${compactedTurns} 轮更早对话`,
        args: { compactedTurns },
        output: summary,
      },
    };
    // 插到本轮问询（最后一条 user 消息）之前，时序与「发送前折叠」一致
    messages.value.splice(Math.max(0, messages.value.length - 1), 0, message);
    if (zen) {
      void zen.session.appendMessage(sessionId.value, message);
    }
  }

  /** 发送前的历史压缩：返回压缩后的轮次与结果供 run 请求使用 */
  function prepareCompression(): { historyTurns: ChatTurn[]; compression: ReturnType<typeof compressHistory> } {
    const historyTurns = buildHistory(messages.value).slice(0, -1);
    const compression = compressHistory(historyTurns, {
      tasks: useSessionInfoStore().activeTasks.map((item) => ({
        label: item.label,
        done: item.done,
      })),
      touchedFiles: collectTouchedFiles(messages.value),
      uploads: collectUploads(messages.value),
      force: forceCompress.value,
      overThreshold: (contextUsage() ?? 0) >= 70,
    });
    if (compression.compressed) {
      statusText.value = "已压缩上下文 · Agent 思考中…";
      const summary = compression.turns[0]?.content ?? "";
      if (summary) {
        insertCompactCard(summary, historyTurns.length - (compression.turns.length - 1));
      }
    }
    return { historyTurns, compression };
  }

  return { compressNow, prepareCompression };
}
