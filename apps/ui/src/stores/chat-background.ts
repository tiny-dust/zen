import { uuid } from "rattail";

import type { AgentStreamEvent, ChatMessage } from "@zen/shared";
import { applyStreamToMessage } from "@zen/shared";

/** 单个后台会话的消息缓冲：切走运行中会话时的快照 + 持续归约进来的流式事件 */
interface BackgroundTranscript {
  messages: ChatMessage[];
  /** 插入 run 结束 / 原 run 恢复后另起新助手气泡（对齐 chat-events 的 breakAssistantBubble） */
  breakBubble: boolean;
}

function lastAssistantOf(messages: ChatMessage[]): ChatMessage | undefined {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last : undefined;
}

/**
 * 后台会话消息缓冲：运行中的会话不在前台时，消息级流事件持续归约进缓冲。
 * - 切走的运行中会话：切走前快照当前消息（stash），之后的事件继续归约；
 * - 从未在前台打开过的运行中会话（计划任务等后台运行）：apply 从首个事件
 *   起懒建空缓冲，用户中途打开时可补看已流出的内容（已落库前缀由
 *   mergeBackgroundTranscript 在打开时合并补上）。
 * 纯逻辑无 Vue 依赖，方便单测。
 */
export class BackgroundTranscripts {
  private transcripts = new Map<string, BackgroundTranscript>();

  /** 切走运行中会话前快照当前消息数组（浅拷贝数组，元素引用复用） */
  stash(sessionId: string, messages: ChatMessage[]): void {
    if (sessionId.includes("::")) {
      return;
    }
    this.transcripts.set(sessionId, { messages: [...messages], breakBubble: false });
  }

  /**
   * 把后台收到的消息级事件归约进缓冲（逻辑对齐 chat-events 活跃路径）。
   * 无缓冲的会话懒建空缓冲：从未在前台打开过的运行中会话（计划任务等
   * 后台运行）由此也能积累流式内容，中途打开时补看。子 Agent 会话（::）不缓冲。
   */
  apply(sessionId: string, event: AgentStreamEvent): void {
    if (sessionId.includes("::")) {
      return;
    }
    let transcript = this.transcripts.get(sessionId);
    if (!transcript) {
      transcript = { messages: [], breakBubble: false };
      this.transcripts.set(sessionId, transcript);
    }
    switch (event.type) {
      case "insert_started":
        // 插入 run 开始：其输出另起新气泡，不并进原 run 的回复
      case "original_resumed":
        // 原 run 恢复：续跑输出另起新气泡
        transcript.breakBubble = true;
        return;
      case "delta":
      case "reasoning_delta":
      case "reasoning_end":
      case "tool_input_start":
      case "tool_start":
      case "tool_progress":
      case "tool_end":
      case "step_start":
      case "usage":
      case "error":
      case "done": {
        const message = this.ensureAssistantMessage(transcript);
        applyStreamToMessage(message, event);
        return;
      }
      default:
        // approval/ask/status 等不改消息，忽略（侧栏状态由 chat-events 维护）
        return;
    }
  }

  /** 取出并删除缓冲：切回运行中会话时优先用缓冲恢复消息列表 */
  take(sessionId: string): ChatMessage[] | undefined {
    if (sessionId.includes("::")) {
      return undefined;
    }
    const transcript = this.transcripts.get(sessionId);
    if (!transcript) {
      return undefined;
    }
    this.transcripts.delete(sessionId);
    return transcript.messages;
  }

  /** 丢弃过期缓冲：目标会话已不在运行态时，缓冲内容不可信 */
  drop(sessionId: string): void {
    this.transcripts.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.transcripts.has(sessionId);
  }

  /** 与 chat-events 同名函数语义一致：breakBubble 时另起新气泡 */
  private ensureAssistantMessage(transcript: BackgroundTranscript): ChatMessage {
    let last = transcript.breakBubble ? undefined : lastAssistantOf(transcript.messages);
    transcript.breakBubble = false;
    if (!last) {
      const message: ChatMessage = {
        id: uuid(),
        role: "assistant",
        content: "",
        parts: [],
        createdAt: Date.now(),
      };
      transcript.messages.push(message);
      last = message;
    }
    last.parts ??= [];
    return last;
  }
}

/**
 * 打开运行中的后台会话时合并恢复消息：数据库前缀（用户消息/已完成轮次——
 * 流式内容 run 结束前不落库）+ 后台缓冲增量（切走快照或懒建缓冲），按消息 id
 * 去重：快照里已含的落库消息不重复，懒建缓冲缺失的已落库前缀由数据库补上。
 */
export function mergeBackgroundTranscript(
  persisted: ChatMessage[],
  buffered: ChatMessage[],
): ChatMessage[] {
  const seen = new Set(persisted.map((item) => item.id));
  return [...persisted, ...buffered.filter((item) => !seen.has(item.id))];
}
