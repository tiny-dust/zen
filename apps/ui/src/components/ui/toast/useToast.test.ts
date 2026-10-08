import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast, useToasts } from "@/components/ui/toast/useToast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // 清空全局单例，避免跨用例串扰
  const { toasts, dismiss } = useToasts();
  for (const item of [...toasts.value]) {
    dismiss(item.id);
  }
});

describe("toast", () => {
  it("默认 info，追加到全局列表", () => {
    const { toasts } = useToasts();
    const id = toast("保存成功");
    expect(toasts.value.at(-1)).toMatchObject({ id, kind: "info", message: "保存成功" });
  });

  it("ok / err / info 便捷方法指定 kind", () => {
    const { toasts } = useToasts();
    toast.ok("ok 了");
    toast.err("出错了");
    toast.info("提示一下");
    expect(toasts.value.map((item) => item.kind)).toEqual(["ok", "err", "info"]);
  });

  it("ttl 到点自动消失", () => {
    const { toasts } = useToasts();
    const id = toast("自动消失", "ok", 2600);
    expect(toasts.value.some((item) => item.id === id)).toBe(true);
    vi.advanceTimersByTime(2599);
    expect(toasts.value.some((item) => item.id === id)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toasts.value.some((item) => item.id === id)).toBe(false);
  });

  it("ttl=0 常驻直到手动 dismiss", () => {
    const { toasts, dismiss } = useToasts();
    const id = toast("常驻", "err", 0);
    vi.advanceTimersByTime(60_000);
    expect(toasts.value.some((item) => item.id === id)).toBe(true);
    dismiss(id);
    expect(toasts.value.some((item) => item.id === id)).toBe(false);
  });

  it("dismiss 清理定时器，之后不再自动消失（不误伤后来者）", () => {
    const { toasts, dismiss } = useToasts();
    const first = toast("第一条", "ok", 2600);
    const second = toast("第二条", "ok", 2600);
    dismiss(first);
    vi.advanceTimersByTime(2600);
    expect(toasts.value.some((item) => item.id === first)).toBe(false);
    expect(toasts.value.some((item) => item.id === second)).toBe(false);
  });

  it("dismiss 不存在的 id 是无操作", () => {
    const { toasts, dismiss } = useToasts();
    const before = toasts.value.length;
    dismiss(999_999);
    expect(toasts.value).toHaveLength(before);
  });
});
