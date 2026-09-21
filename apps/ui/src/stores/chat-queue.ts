import { uuid } from "rattail";
import type { ComputedRef, Ref } from "vue";
import { ref } from "vue";

import type { QueuedMessage } from "@/stores/chat-types";

/** 插入队列的依赖：出队续发时写回输入框并走正常发送 */
export interface MessageQueueOptions {
  input: Ref<string>;
  isRunning: ComputedRef<boolean>;
  send: () => Promise<void>;
}

/**
 * 运行中插入消息的队列：
 * - 运行中发送 → 入队（输入框顶部展示，可插队/编辑/删除）
 * - 当前 run 正常结束后按顺序自动续发队首
 */
export function createMessageQueue(options: MessageQueueOptions) {
  const { input, isRunning, send } = options;
  const queuedMessages = ref<QueuedMessage[]>([]);
  /** 续发调度句柄：避免 done 后重复出队 */
  let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

  /** 运行中插入一条消息 */
  function enqueue(text: string): void {
    queuedMessages.value = [
      ...queuedMessages.value,
      { id: uuid(), text, createdAt: Date.now() },
    ];
  }

  /** run 正常结束后稍候自动续发队首，给 done 后的 UI 留一拍缓冲 */
  function scheduleDispatch(): void {
    if (dispatchTimer != null) {
      return;
    }
    dispatchTimer = setTimeout(() => {
      dispatchTimer = null;
      void dispatchNext();
    }, 400);
  }

  async function dispatchNext(): Promise<void> {
    const next = queuedMessages.value[0];
    if (!next || isRunning.value) {
      return;
    }
    queuedMessages.value = queuedMessages.value.slice(1);
    input.value = next.text;
    await send();
  }

  /** 编辑插入消息：文本放回输入框（从队列移除），改完再发送会重新排队 */
  function edit(id: string): void {
    const item = queuedMessages.value.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    queuedMessages.value = queuedMessages.value.filter((entry) => entry.id !== id);
    input.value = item.text;
  }

  function remove(id: string): void {
    queuedMessages.value = queuedMessages.value.filter((entry) => entry.id !== id);
  }

  /** 插队：把该消息移到队列最前，当前 run 结束后最先执行 */
  function promote(id: string): void {
    const index = queuedMessages.value.findIndex((entry) => entry.id === id);
    if (index <= 0) {
      return;
    }
    const item = queuedMessages.value[index];
    queuedMessages.value = [
      item,
      ...queuedMessages.value.filter((entry) => entry.id !== id),
    ];
  }

  /** 清空队列与续发调度（切换/新建会话时） */
  function clear(): void {
    if (dispatchTimer != null) {
      clearTimeout(dispatchTimer);
      dispatchTimer = null;
    }
    queuedMessages.value = [];
  }

  return { queuedMessages, enqueue, scheduleDispatch, edit, remove, promote, clear };
}

export type MessageQueue = ReturnType<typeof createMessageQueue>;
