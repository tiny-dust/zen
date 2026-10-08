import { describe, expect, it } from "vitest";

import { ResourceLock } from "./resource-lock";

/**
 * 独占资源锁：
 * - 同一时刻只有一个持有者，任务串行执行
 * - 等锁阶段可被 abort 中断（抛错并放行队列），已持锁任务不受影响
 * - onHold 通知占用变化；currentHolder 反映持有者
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ResourceLock", () => {
  it("独占任务串行执行且 onHold 通知占用变化", async () => {
    const lock = new ResourceLock();
    const order: string[] = [];
    const holds: Array<string | null> = [];
    lock.onHold = (ownerId) => holds.push(ownerId);

    const first = lock.run("a", "write", async () => {
      order.push("a-start");
      expect(lock.currentHolder).toBe("a");
      await delay(20);
      order.push("a-end");
    });
    const second = lock.run("b", "terminal", async () => {
      order.push("b-start");
      expect(lock.currentHolder).toBe("b");
      order.push("b-end");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    expect(holds).toEqual(["a", null, "b", null]);
    expect(lock.currentHolder).toBeNull();
  });

  it("等锁阶段被 abort 时抛错放行，不执行排队任务", async () => {
    const lock = new ResourceLock();
    const controller = new AbortController();
    let ranQueued = false;

    const holder = lock.run("slow", "terminal", async () => {
      await delay(30);
      return "held";
    });
    const queued = lock.run(
      "waiting",
      "write",
      async () => {
        ranQueued = true;
        return "ran";
      },
      controller.signal,
    );

    await delay(5);
    controller.abort();

    await expect(queued).rejects.toThrow("已中断（暂停或取消）");
    expect(ranQueued).toBe(false);
    await expect(holder).resolves.toBe("held");
    // 队列槽位已放行，后续任务可继续
    await expect(lock.run("c", "write", async () => "ok")).resolves.toBe("ok");
  });

  it("signal 已中止时不执行任务直接抛错", async () => {
    const lock = new ResourceLock();
    const controller = new AbortController();
    controller.abort();

    await expect(
      lock.run("x", "browser", async () => "never", controller.signal),
    ).rejects.toThrow("已中断（暂停或取消）");
    expect(lock.currentHolder).toBeNull();
  });

  it("任务抛错也释放锁", async () => {
    const lock = new ResourceLock();
    await expect(
      lock.run("bad", "write", async () => {
        throw new Error("task failed");
      }),
    ).rejects.toThrow("task failed");
    expect(lock.currentHolder).toBeNull();
    await expect(lock.run("next", "write", async () => "ok")).resolves.toBe("ok");
  });
});
