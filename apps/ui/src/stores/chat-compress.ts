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
  /**
   * 会话级压缩模式：点「压缩上下文」后置位，之后每次发送都折叠更早对话。
   * 与自动超限互补；本会话保持，切换会话时由 chat store 复位。
   */
  forceCompress: Ref<boolean>;
  /** 上下文用量（%），发送时求值 */
  contextUsage: () => number | null;
}

/** 自动触发压缩的用量阈值（%） */
export const COMPRESS_THRESHOLD = 70;

/**
 * 历史压缩域：滚动摘要 + 超限双保险 + 压缩摘要卡落库。
 * 摘要卡是 role=tool 的独立消息（toolName=contextCompact），展开可看折叠后的全文。
 */
export function createCompressionDomain(options: CompressionDomainOptions) {
  const { messages, sessionId, statusText, forceCompress, contextUsage } = options;

  /**
   * 手动压缩：开启会话级压缩模式，下一次发送起把更早对话折叠为摘要。
   * 已有消息才生效；摘要卡插入后可在时间线展开查看。
   */
  function compressNow() {
    if (!messages.value.length) {
      return;
    }
    forceCompress.value = true;
    statusText.value = "已开启压缩：之后发送会把更早对话折叠为摘要";
  }

  function findCompactCard(): ChatMessage | undefined {
    // tsconfig lib 低于 es2023，不用 Array.prototype.findLast
    for (let i = messages.value.length - 1; i >= 0; i -= 1) {
      const item = messages.value[i];
      if (
        item.role === "tool" &&
        (item.meta as { toolName?: string } | undefined)?.toolName === "contextCompact"
      ) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * 压缩摘要卡：滚动压缩时更新同一张卡（不每轮插新卡）；首次折叠插到本轮问询之前并落库。
   */
  function insertCompactCard(summary: string, compactedCount: number): void {
    const zen = window.zen;
    const label = `上下文已压缩 · 已折叠 ${compactedCount} 条更早消息`;
    const lastCard = findCompactCard();
    if (lastCard) {
      const prev = lastCard.meta as { output?: string } | undefined;
      if (prev?.output === summary) {
        return;
      }
      lastCard.meta = {
        ...(lastCard.meta as Record<string, unknown>),
        toolName: "contextCompact",
        ok: true,
        state: "ok",
        summary: label,
        args: { compactedTurns: compactedCount },
        output: summary,
      };
      if (zen) {
        void zen.session.appendMessage(sessionId.value, lastCard);
      }
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
        summary: label,
        args: { compactedTurns: compactedCount },
        output: summary,
      },
    };
    // 插到本轮问询（最后一条 user 消息）之前，时序与「发送前折叠」一致
    const insertAt = messages.value.length ? messages.value.length - 1 : 0;
    messages.value.splice(insertAt, 0, message);
    if (zen) {
      void zen.session.appendMessage(sessionId.value, message);
    }
  }

  /**
   * 发送前的历史压缩：返回压缩后的轮次与结果供 run 请求使用。
   * 压缩生效时 turns 明显短于全量历史（摘要 + 最近几条）。
   */
  function prepareCompression(): { historyTurns: ChatTurn[]; compression: ReturnType<typeof compressHistory> } {
    const historyTurns = buildHistory(messages.value).slice(0, -1);
    const usage = contextUsage() ?? 0;
    // 压缩模式 / 已有摘要卡 / 超限：三者任一触发，避免压一次后又把全量历史发回去
    const shouldCompact = forceCompress.value || findCompactCard() != null || usage >= COMPRESS_THRESHOLD;
    const compression = compressHistory(historyTurns, {
      tasks: useSessionInfoStore().activeTasks.map((item) => ({
        label: item.label,
        done: item.done,
      })),
      touchedFiles: collectTouchedFiles(messages.value),
      uploads: collectUploads(messages.value),
      force: shouldCompact,
      overThreshold: usage >= COMPRESS_THRESHOLD,
    });
    if (compression.compressed) {
      // 折叠成功即进入会话级压缩模式，后续发送保持短历史
      forceCompress.value = true;
      statusText.value = "已压缩上下文 · Agent 思考中…";
      if (compression.summary) {
        insertCompactCard(compression.summary, compression.compactedCount);
      }
    }
    return { historyTurns, compression };
  }

  return { compressNow, prepareCompression };
}

