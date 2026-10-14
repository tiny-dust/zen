import { uuid } from "rattail";
import type { ComputedRef, Ref } from "vue";
import { ref } from "vue";

import type { ComposerAttachment, QueuedMessage } from "@/stores/chat-types";

/** 插入队列的依赖：出队续发时写回输入框与附件列表并走正常发送 */
export interface MessageQueueOptions {
  input: Ref<string>;
  attachments: Ref<ComposerAttachment[]>;
  isRunning: ComputedRef<boolean>;
  send: () => Promise<void>;
}

/** 附件快照拷贝：入队/还原都不引用 composer 现场对象，避免后续编辑互相串改 */
function copyAttachments(list: ComposerAttachment[] | undefined): ComposerAttachment[] {
  return (list ?? []).map((item) => ({ ...item }));
}

/**
 * 运行中插入消息的队列：
 * - 运行中发送 → 入队（输入框顶部展示，可插队/编辑/删除；附件随消息快照保存）
 * - 当前 run 正常结束后按顺序自动续发队首
 */
export function createMessageQueue(options: MessageQueueOptions) {
  const { input, attachments, isRunning, send } = options;
  const queuedMessages = ref<QueuedMessage[]>([]);
  /** 续发调度句柄：避免 done 后重复出队 */
  let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

  /** 运行中插入一条消息（正文 + 附件快照；纯附件消息 text 为空串） */
  function enqueue(text: string, attachments?: ComposerAttachment[]): void {
    queuedMessages.value = [
      ...queuedMessages.value,
      {
        id: uuid(),
        text,
        createdAt: Date.now(),
        ...(attachments?.length ? { attachments: copyAttachments(attachments) } : {}),
      },
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
    // 还原该条消息的完整现场（正文 + 附件）：替换 composer 当前草稿，
    // 保证附件随原消息发出、不丢也不与新草稿串
    input.value = next.text;
    attachments.value = copyAttachments(next.attachments);
    await send();
  }

  /** 编辑插入消息：正文与附件放回输入框（从队列移除），改完再发送会重新排队 */
  function edit(id: string): void {
    const item = queuedMessages.value.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    queuedMessages.value = queuedMessages.value.filter((entry) => entry.id !== id);
    input.value = item.text;
    attachments.value = copyAttachments(item.attachments);
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
