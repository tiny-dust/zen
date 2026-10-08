import { describe, expect, it } from "vitest";

import { createSessionPlaceholder } from "./index";

/**
 * session 包当前只是占位出口：冒烟确认导出可用，
 * 后续接入 better-sqlite3 落库时在此扩展。
 */

describe("@zen/session 出口", () => {
  it("createSessionPlaceholder 返回稳定占位串", () => {
    expect(createSessionPlaceholder()).toBe("session");
    expect(createSessionPlaceholder()).toBe(createSessionPlaceholder());
  });
});
