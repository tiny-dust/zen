import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { createMessageQueue } from "@/stores/chat-queue";
import type { ComposerAttachment } from "@/stores/chat-types";

function att(id: string, name: string): ComposerAttachment {
  return { id, name, path: `/tmp/${name}`, size: 1, isImage: name.endsWith(".png") };
}

function setup() {
  const input = ref("");
  const attachments = ref<ComposerAttachment[]>([]);
  const isRunning = ref(false);
  /** 续发时 composer 现场（正文 + 附件），供断言还原是否正确 */
  const sent: Array<{ text: string; attachments: ComposerAttachment[] }> = [];
  const send = vi.fn(async () => {
    sent.push({ text: input.value, attachments: [...attachments.value] });
    input.value = "";
  });
  const queue = createMessageQueue({
    input,
    attachments,
    isRunning: isRunning as never,
    send,
  });
  return { input, attachments, isRunning, send, sent, queue };
}

describe("createMessageQueue", () => {
  it("运行中插入消息按顺序入队", () => {
    const { queue } = setup();
    queue.enqueue("a");
    queue.enqueue("b");
    expect(queue.queuedMessages.value.map((item) => item.text)).toEqual(["a", "b"]);
  });

  it("promote 插队到队首", () => {
    const { queue } = setup();
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    const target = queue.queuedMessages.value[2];
    queue.promote(target.id);
    expect(queue.queuedMessages.value.map((item) => item.text)).toEqual(["c", "a", "b"]);
  });

  it("edit 移出队列并回填输入框", () => {
    const { input, queue } = setup();
    queue.enqueue("a");
    queue.enqueue("b");
    const target = queue.queuedMessages.value[0];
    queue.edit(target.id);
    expect(queue.queuedMessages.value.map((item) => item.text)).toEqual(["b"]);
    expect(input.value).toBe("a");
  });

  it("remove 删除指定消息", () => {
    const { queue } = setup();
    queue.enqueue("a");
    queue.enqueue("b");
    const target = queue.queuedMessages.value[0];
    queue.remove(target.id);
    expect(queue.queuedMessages.value.map((item) => item.text)).toEqual(["b"]);
  });

  it("scheduleDispatch 空闲后出队续发队首", async () => {
    vi.useFakeTimers();
    const { input, isRunning, send, queue } = setup();
    isRunning.value = true;
    queue.enqueue("a");
    isRunning.value = false;
    input.value = "keep";
    queue.scheduleDispatch();
    // 重复调度不叠加
    queue.scheduleDispatch();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
    expect(queue.queuedMessages.value).toHaveLength(0);
    vi.useRealTimers();
  });

  it("运行中不自动出队", async () => {
    vi.useFakeTimers();
    const { isRunning, send, queue } = setup();
    isRunning.value = true;
    queue.enqueue("a");
    queue.scheduleDispatch();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).not.toHaveBeenCalled();
    expect(queue.queuedMessages.value).toHaveLength(1);
    vi.useRealTimers();
  });

  it("enqueue 捕获附件快照：后续 composer 清空不影响队列条目", () => {
    const { attachments, queue } = setup();
    attachments.value = [att("a1", "图.png")];
    queue.enqueue("看图", attachments.value);
    attachments.value = [];
    expect(queue.queuedMessages.value[0]?.attachments?.map((item) => item.name)).toEqual([
      "图.png",
    ]);
  });

  it("scheduleDispatch 续发时还原正文与附件", async () => {
    vi.useFakeTimers();
    const { send, sent, queue } = setup();
    queue.enqueue("看图", [att("a1", "图.png")]);
    queue.scheduleDispatch();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({ text: "看图", attachments: [att("a1", "图.png")] });
    expect(queue.queuedMessages.value).toHaveLength(0);
    vi.useRealTimers();
  });

  it("续发不带附件的条目时替换 composer 当前附件（不串）", async () => {
    vi.useFakeTimers();
    const { attachments, send, sent, queue } = setup();
    queue.enqueue("纯文本");
    // 续发前用户已在新草稿里挂了别的附件：不能随队列消息串发
    attachments.value = [att("b1", "新草稿.png")];
    queue.scheduleDispatch();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({ text: "纯文本", attachments: [] });
    vi.useRealTimers();
  });

  it("edit 放回输入框时一并还原附件", () => {
    const { input, attachments, queue } = setup();
    queue.enqueue("看图", [att("a1", "图.png")]);
    queue.enqueue("b");
    const target = queue.queuedMessages.value[0];
    queue.edit(target.id);
    expect(queue.queuedMessages.value.map((item) => item.text)).toEqual(["b"]);
    expect(input.value).toBe("看图");
    expect(attachments.value.map((item) => item.name)).toEqual(["图.png"]);
  });

  it("clear 清空队列并取消续发", async () => {
    vi.useFakeTimers();
    const { send, queue } = setup();
    queue.enqueue("a");
    queue.scheduleDispatch();
    queue.clear();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).not.toHaveBeenCalled();
    expect(queue.queuedMessages.value).toHaveLength(0);
    vi.useRealTimers();
    await nextTick();
  });
});
