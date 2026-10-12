/**
 * 会话级状态分桶：右侧/底部面板内容按 chat sessionId 隔离。
 *
 * 活跃会话的状态仍存放在各 store 的响应式 refs（组件无感知）；
 * 切走会话时 capture() 深拷贝入桶，切回时 restore() 把对应桶写回 refs。
 * 桶内是独立快照（深拷贝），与活跃 refs 引用隔离，
 * 因此对非活跃会话桶的修改不会串到当前视图，反之亦然。
 */
export interface SessionBuckets<T> {
  /** 当前绑定的会话 key；空串 = 尚未绑定任何会话 */
  readonly activeKey: string;
  /** 已暂存的会话桶数量（活跃会话状态在 refs 里，不计入） */
  readonly size: number;
  /** 切换会话：旧会话快照入桶，目标会话快照恢复（无桶用 initial）；未变化返回 false */
  switchTo(key: string): boolean;
  /** 修改非活跃会话的桶（后台事件落桶；活跃会话请直接改 refs） */
  edit(key: string, mutate: (state: T) => void): void;
  /** 对全部桶执行修改（如清理已退出的终端） */
  editAll(mutate: (state: T, key: string) => void): void;
  /** 指定会话是否已有桶 */
  has(key: string): boolean;
  /** 丢弃指定会话桶 */
  drop(key: string): void;
  /** 全量重置（清桶并解除绑定） */
  reset(): void;
}

/**
 * 深拷贝（走 Proxy 陷阱读取）：Vue reactive refs 的值是 Proxy，
 * structuredClone 会对其抛 DataCloneError，这里用属性访问逐层复制。
 */
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[key] = deepClone(source[key]);
    }
    return out as unknown as T;
  }
  return value;
}

export function createSessionBuckets<T>(options: {
  /** 新会话（无桶）的默认状态；key 为目标会话 id（如按会话读持久化数据） */
  initial: (key: string) => T;
  /** 从活跃 refs 抓取快照 */
  capture: () => T;
  /** 把快照写回活跃 refs */
  restore: (state: T) => void;
}): SessionBuckets<T> {
  const buckets = new Map<string, T>();
  let activeKey = "";

  function edit(key: string, mutate: (state: T) => void): void {
    if (!key) {
      return;
    }
    const state = deepClone(buckets.get(key) ?? options.initial(key));
    mutate(state);
    buckets.set(key, deepClone(state));
  }

  function editAll(mutate: (state: T, key: string) => void): void {
    for (const key of [...buckets.keys()]) {
      edit(key, (state) => mutate(state, key));
    }
  }

  return {
    get activeKey() {
      return activeKey;
    },
    get size() {
      return buckets.size;
    },
    switchTo(key: string): boolean {
      if (!key || key === activeKey) {
        return false;
      }
      if (activeKey) {
        buckets.set(activeKey, deepClone(options.capture()));
      }
      activeKey = key;
      options.restore(deepClone(buckets.get(key) ?? options.initial(key)));
      return true;
    },
    edit,
    editAll,
    has(key: string): boolean {
      return buckets.has(key);
    },
    drop(key: string): void {
      buckets.delete(key);
    },
    reset(): void {
      buckets.clear();
      activeKey = "";
    },
  };
}
