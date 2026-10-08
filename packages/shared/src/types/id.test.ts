import { describe, expect, it, vi } from "vitest";

import { uuidv7 } from "./id";

describe("uuidv7", () => {
  it("生成合法的 v7 格式 UUID", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("时间戳位可还原生成时刻（毫秒精度）", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("连续生成互不相同（唯一 key 前提）", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it("按时间有序（同毫秒内单调不减）", () => {
    let prev = "";
    for (let i = 0; i < 100; i += 1) {
      const id = uuidv7();
      expect(id >= prev).toBe(true);
      prev = id;
    }
  });

  it("同毫秒计数器溢出时推进时间戳（已知取舍：时钟被冻结时紧随其后的一枚会回退到真实时间戳）", () => {
    const base = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(base);
    try {
      const ids = Array.from({ length: 5000 }, () => uuidv7());
      // 覆盖 12bit 计数器回绕（最坏 4096 次内必溢出，取 5000 保证命中）
      const bumped = ids.filter((id) => {
        const ts = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
        return ts > base;
      });
      expect(bumped.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("crypto 不可用时抛出明确错误", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => uuidv7()).toThrow("crypto.getRandomValues 不可用");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
