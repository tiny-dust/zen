import { describe, expect, it } from "vitest";

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
});
