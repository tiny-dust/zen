import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useSessionStatusStore } from "@/stores/session-status";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useSessionStatusStore", () => {
  it("get 缺省 idle，set 记录运行态", () => {
    const store = useSessionStatusStore();
    expect(store.get("s1")).toBe("idle");
    store.set("s1", "running");
    expect(store.get("s1")).toBe("running");
    store.set("s1", "needs_action");
    expect(store.get("s1")).toBe("needs_action");
  });

  it("空 id 忽略", () => {
    const store = useSessionStatusStore();
    store.set("", "running");
    expect(store.byId).toEqual({});
  });

  it("done / error 标记未读结果，markSeen 清除", () => {
    const store = useSessionStatusStore();
    store.set("s1", "done");
    expect(store.hasUnseenResult("s1")).toBe(true);
    store.markSeen("s1");
    expect(store.hasUnseenResult("s1")).toBe(false);

    store.set("s2", "error");
    expect(store.hasUnseenResult("s2")).toBe(true);
  });

  it("结果后回到运行态撤销未读标记", () => {
    const store = useSessionStatusStore();
    store.set("s1", "done");
    store.set("s1", "running");
    expect(store.hasUnseenResult("s1")).toBe(false);
  });

  it("markSeen 对无未读的会话是无操作", () => {
    const store = useSessionStatusStore();
    const before = store.snapshot;
    store.markSeen("nope");
    expect(store.snapshot).toBe(before);
  });

  it("clear 清掉状态与未读，不存在时无操作", () => {
    const store = useSessionStatusStore();
    store.set("s1", "done");
    store.clear("s1");
    expect(store.get("s1")).toBe("idle");
    expect(store.hasUnseenResult("s1")).toBe(false);

    const before = store.snapshot;
    store.clear("never");
    expect(store.snapshot).toBe(before);
  });

  it("clear 兼有状态无未读 / 有未读无状态两种残留", () => {
    const store = useSessionStatusStore();
    store.set("s1", "running");
    store.clear("s1");
    expect(store.get("s1")).toBe("idle");

    store.set("s2", "done");
    store.set("s2", "running");
    store.clear("s2");
    expect(store.hasUnseenResult("s2")).toBe(false);
  });
});
