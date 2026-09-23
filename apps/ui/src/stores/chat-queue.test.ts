import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { createMessageQueue } from "@/stores/chat-queue";

function setup() {
  const input = ref("");
  const isRunning = ref(false);
  const send = vi.fn(async () => {
    input.value = "";
  });
  const queue = createMessageQueue({
    input,
    isRunning: isRunning as never,
    send,
  });
  return { input, isRunning, send, queue };
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
