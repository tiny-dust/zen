/** 工作区写/终端/浏览器互斥：串行化独占资源，降低多 Agent 写竞争 */
export class ResourceLock {
  private queue: Promise<void> = Promise.resolve();
  private holder: string | null = null;

  get currentHolder(): string | null {
    return this.holder;
  }

  async run<T>(ownerId: string, label: "write" | "terminal" | "browser", fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.holder = ownerId;
    this.lastLabel = label;
    this.onHold?.(ownerId, label);
    try {
      return await fn();
    } finally {
      this.holder = null;
      this.lastLabel = null;
      this.onHold?.(null, null);
      release();
    }
  }

  private lastLabel: "write" | "terminal" | "browser" | null = null;
  /** 资源占用变化回调（UI 可展示 busyResource） */
  onHold: ((ownerId: string | null, label: "write" | "terminal" | "browser" | null) => void) | null =
    null;
}
