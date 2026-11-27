import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@zen/shared";

import { buildTraceDocument } from "./document";

function fixture(): ChatMessage[] {
  return [
    { id: "u1", role: "user", content: "看看 a.ts", createdAt: 1_000 },
    {
      id: "a1",
      role: "assistant",
      content: "看完了",
      createdAt: 1_000,
      parts: [{ type: "reasoning", text: "先读文件。", ms: 500 }],
      meta: { run: { startedAt: 1_000, endedAt: 9_000, status: "idle" } },
    },
    { id: "u2", role: "user", content: "再看 b.ts", createdAt: 10_000 },
    {
      id: "a2",
      role: "assistant",
      content: "也看完了",
      createdAt: 10_000,
      parts: [{ type: "reasoning", text: "读 b。", ms: 300 }],
      meta: { run: { startedAt: 10_000, endedAt: 12_000, status: "idle" } },
    },
  ];
}

describe("buildTraceDocument 缓存与稳定 id", () => {
  it("重复构建结果一致，节点 id 不随重建漂移", () => {
    const messages = fixture();
    const first = buildTraceDocument(messages);
    const second = buildTraceDocument(messages);

    expect(second.orderedNodeIds).toEqual(first.orderedNodeIds);
    expect(second.stats).toEqual(first.stats);
    expect(first.turns).toHaveLength(2);
  });

  it("流式追加分段后旧节点 id 不变、新节点追加在末尾（选中项不会串位）", () => {
    const messages = fixture();
    const before = buildTraceDocument(messages);
    const last = messages[messages.length - 1]!;

    // 追加一段思考：真实流式就是原地改最后一条消息
    last.parts = [...(last.parts ?? []), { type: "reasoning", text: "第二轮思考", ms: 200 }];
    const after = buildTraceDocument(messages);

    const beforeIds = before.orderedNodeIds;
    const afterIds = after.orderedNodeIds;
    // 老节点 id 全部保留（选中项不会串到别的节点），本轮多出一个思考节点
    expect(afterIds.filter((id) => beforeIds.includes(id))).toEqual(beforeIds);
    expect(afterIds.length).toBe(beforeIds.length + 1);
    // 新节点在本轮回复之前（回复始终是收尾节点）
    expect(afterIds.indexOf("nt:a2:1")).toBeLessThan(afterIds.indexOf("nr:a2"));
    // 轮次 id 也稳定
    expect(after.rootTurnIds).toEqual(before.rootTurnIds);
  });

  it("计时与状态变化会反映到结果里（缓存不是只认对象身份）", () => {
    const messages = fixture();
    buildTraceDocument(messages);
    const last = messages[messages.length - 1]!;
    last.meta = { run: { startedAt: 10_000, endedAt: 15_000, status: "error", error: "boom" } };

    const after = buildTraceDocument(messages);
    expect(after.to).toBe(15_000);
    expect(after.turns[1]?.status).toBe("error");
  });
});
