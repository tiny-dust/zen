import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { createSessionBuckets } from "@/stores/session-buckets";

interface State {
  items: string[];
  flag: boolean;
}

function setup(initial?: (key: string) => State) {
  const items = ref<string[]>([]);
  const flag = ref(false);
  const buckets = createSessionBuckets<State>({
    initial: initial ?? (() => ({ items: [], flag: false })),
    capture: () => ({ items: items.value, flag: flag.value }),
    restore: (state) => {
      items.value = state.items;
      flag.value = state.flag;
    },
  });
  return { buckets, items, flag };
}

describe("createSessionBuckets switchTo", () => {
  it("未绑定时首次 switchTo：恢复 initial，不捕获任何桶", () => {
    const { buckets, items } = setup();
    expect(buckets.activeKey).toBe("");
    expect(buckets.switchTo("s1")).toBe(true);
    expect(buckets.activeKey).toBe("s1");
    expect(items.value).toEqual([]);
    expect(buckets.size).toBe(0);
  });

  it("切换：旧会话快照入桶，目标会话恢复自己的桶", () => {
    const { buckets, items, flag } = setup();
    buckets.switchTo("s1");
    items.value = ["a"];
    flag.value = true;

    buckets.switchTo("s2");
    expect(buckets.activeKey).toBe("s2");
    // 新会话无桶 → initial
    expect(items.value).toEqual([]);
    expect(flag.value).toBe(false);
    expect(buckets.size).toBe(1);

    // s2 里也有数据
    items.value = ["x"];

    buckets.switchTo("s1");
    expect(items.value).toEqual(["a"]);
    expect(flag.value).toBe(true);

    buckets.switchTo("s2");
    expect(items.value).toEqual(["x"]);
  });

  it("同 key 重复 switchTo 返回 false 且不动 refs", () => {
    const { buckets, items } = setup();
    buckets.switchTo("s1");
    items.value = ["a"];
    expect(buckets.switchTo("s1")).toBe(false);
    expect(items.value).toEqual(["a"]);
  });

  it("空 key 拒绝切换", () => {
    const { buckets } = setup();
    buckets.switchTo("s1");
    expect(buckets.switchTo("")).toBe(false);
    expect(buckets.activeKey).toBe("s1");
  });
});

describe("createSessionBuckets edit / editAll", () => {
  it("edit 修改非活跃会话桶，不影响活跃 refs；切回后可见", () => {
    const { buckets, items } = setup();
    buckets.switchTo("s1");
    buckets.switchTo("s2");

    buckets.edit("s1", (state) => {
      state.items.push("bg");
    });
    // 当前视图（s2）不受影响
    expect(items.value).toEqual([]);

    buckets.switchTo("s1");
    expect(items.value).toEqual(["bg"]);
  });

  it("edit 无桶会话时以 initial(key) 起稿", () => {
    const { buckets, items } = setup((key) => ({ items: [`seed:${key}`], flag: false }));
    buckets.switchTo("s1");
    buckets.edit("s9", (state) => {
      state.items.push("new");
    });
    buckets.switchTo("s9");
    expect(items.value).toEqual(["seed:s9", "new"]);
  });

  it("initial 按 key 提供默认状态", () => {
    const { buckets, items } = setup((key) => ({ items: [`seed:${key}`], flag: false }));
    buckets.switchTo("s1");
    buckets.switchTo("s9");
    expect(items.value).toEqual(["seed:s9"]);
  });

  it("edit 空串 key 直接忽略", () => {
    const { buckets } = setup();
    buckets.switchTo("s1");
    expect(() => buckets.edit("", () => undefined)).not.toThrow();
    expect(buckets.size).toBe(0);
  });

  it("editAll 遍历全部桶（含 edit 过程中新增的）", () => {
    const { buckets, items, flag } = setup();
    buckets.switchTo("s1");
    buckets.switchTo("s2");
    buckets.edit("s1", (state) => {
      state.items.push("a");
    });
    const seen: string[] = [];
    buckets.editAll((state, key) => {
      seen.push(key);
      state.flag = true;
    });
    expect(seen).toEqual(["s1"]);
    buckets.switchTo("s1");
    expect(flag.value).toBe(true);
    expect(items.value).toEqual(["a"]);
  });
});

describe("createSessionBuckets has / drop / reset", () => {
  it("has 反映桶存在性；drop 丢弃指定桶", () => {
    const { buckets, items } = setup();
    buckets.switchTo("s1");
    items.value = ["a"];
    buckets.switchTo("s2");
    expect(buckets.has("s1")).toBe(true);
    expect(buckets.has("s2")).toBe(false); // 活跃会话状态在 refs，不占桶

    buckets.drop("s1");
    expect(buckets.has("s1")).toBe(false);
    buckets.switchTo("s1");
    expect(items.value).toEqual([]); // 桶已丢弃 → initial
  });

  it("reset 清空全部桶并解除绑定", () => {
    const { buckets, items } = setup();
    buckets.switchTo("s1");
    items.value = ["a"];
    buckets.switchTo("s2");
    buckets.reset();
    expect(buckets.activeKey).toBe("");
    expect(buckets.size).toBe(0);
    buckets.switchTo("s1");
    expect(items.value).toEqual([]);
  });
});

describe("createSessionBuckets 快照隔离", () => {
  it("桶内是深拷贝：edit 后桶数据与外部对象无引用共享", () => {
    const { buckets, items } = setup();
    buckets.switchTo("s1");
    items.value = ["a"];
    buckets.switchTo("s2");
    // 改当前 refs 不影响已入桶的 s1
    items.value.push("b");
    buckets.switchTo("s1");
    expect(items.value).toEqual(["a"]);
  });

  it("支持 reactive Proxy 值（structuredClone 会抛 DataCloneError 的场景）", () => {
    const { buckets, items } = setup();
    buckets.switchTo("s1");
    items.value = ["a"];
    // ref 的值是 reactive Proxy：切换/入桶不能抛 DataCloneError
    expect(() => buckets.switchTo("s2")).not.toThrow();
    expect(() => buckets.edit("s1", (state) => state.items.push("bg"))).not.toThrow();
    buckets.switchTo("s1");
    expect(items.value).toEqual(["a", "bg"]);
  });
});
