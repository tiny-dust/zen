/** 工作区写/终端/浏览器互斥：串行化独占资源，降低多 Agent 写竞争 */
export class ResourceLock {
  private queue: Promise<void> = Promise.resolve();
  private holder: string | null = null;

  get currentHolder(): string | null {
    return this.holder;
  }

  /**
   * 排队执行独占任务。传入 signal 时，等待锁的阶段可被中断（暂停/取消）：
   * 否则卡死的持锁任务会让后续所有独占工具永远排队，会话假死且无法停止。
   * 中断时抛错并放行队列槽位，不执行 fn。
   */
  async run<T>(
    ownerId: string,
    label: "write" | "terminal" | "browser",
    fn: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      release();
    };
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    try {
      await previous;
      if (aborted) {
        throw new Error("已中断（暂停或取消），等待资源锁时被取消");
      }
      this.holder = ownerId;
      this.lastLabel = label;
      this.onHold?.(ownerId, label);
      return await fn(signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (this.holder === ownerId) {
        this.holder = null;
        this.lastLabel = null;
        this.onHold?.(null, null);
      }
      release();
    }
  }

  private lastLabel: "write" | "terminal" | "browser" | null = null;
  /** 资源占用变化回调（UI 可展示 busyResource） */
  onHold: ((ownerId: string | null, label: "write" | "terminal" | "browser" | null) => void) | null =
    null;
}
