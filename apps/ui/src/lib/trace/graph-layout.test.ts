import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatMessagePart } from "@zen/shared";

import { buildTraceDocument, type TraceDocument } from "./document";
import { GRAPH_METRICS, buildGraphLayout, type GraphLayout } from "./graph-layout";

function tool(id: string, toolName: string, path: string): ChatMessagePart {
  return { type: "tool", toolCallId: id, toolName, state: "ok", args: { path } };
}

function fixture(): ChatMessage[] {
  return [
    { id: "u1", role: "user", content: "看看这几个文件", createdAt: 1_000 },
    {
      id: "a1",
      role: "assistant",
      content: "都看完了",
      createdAt: 1_000,
      parts: [
        { type: "reasoning", text: "先并发读三个文件。", ms: 1_500 },
        tool("c1", "readFile", "src/a.ts"),
        tool("c2", "readFile", "src/b.ts"),
        tool("c3", "readFile", "src/c.ts"),
      ],
      meta: { run: { startedAt: 1_000, endedAt: 9_000, status: "idle" } },
    },
  ];
}

/** 三轮会话：用来验证多列排布 */
function threeTurnFixture(): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < 3; index += 1) {
    messages.push({
      id: `u${index}`,
      role: "user",
      content: `第 ${index + 1} 个问题`,
      createdAt: 1_000 + index * 10_000,
    });
    messages.push({
      id: `a${index}`,
      role: "assistant",
      content: `第 ${index + 1} 个回答`,
      createdAt: 1_000 + index * 10_000,
      parts: [tool(`t${index}`, "readFile", `src/${index}.ts`)],
      meta: {
        run: {
          startedAt: 1_000 + index * 10_000,
          endedAt: 4_000 + index * 10_000,
          status: "idle",
        },
      },
    });
  }
  return messages;
}

const baseOptions = {
  compactTools: false,
  collapsedTurns: new Set<string>(),
  expandedClusters: new Set<string>(),
};

function overlaps(a: GraphLayout["nodes"][number], b: GraphLayout["nodes"][number]): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("buildGraphLayout", () => {
  it("同一文档产出完全相同的布局（确定性）", () => {
    const doc: TraceDocument = buildTraceDocument(fixture());
    const first = buildGraphLayout(doc, { ...baseOptions });
    const second = buildGraphLayout(doc, { ...baseOptions });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.width).toBeGreaterThan(GRAPH_METRICS.NODE_W);
    expect(first.height).toBeGreaterThan(0);
  });

  it("节点卡片互不重叠，且连线是三次贝塞尔", () => {
    const doc = buildTraceDocument(fixture());
    const layout = buildGraphLayout(doc, { ...baseOptions });

    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        expect(overlaps(layout.nodes[i]!, layout.nodes[j]!)).toBe(false);
      }
    }
    expect(layout.edges.length).toBeGreaterThan(0);
    for (const edge of layout.edges) {
      expect(edge.d.startsWith("M ")).toBe(true);
      expect(edge.d).toContain(" C ");
    }
  });

  it("智能紧凑把连续 3 个同类无错工具折成一张聚簇卡，展开后还原", () => {
    const doc = buildTraceDocument(fixture());
    const compact = buildGraphLayout(doc, { ...baseOptions, compactTools: true });

    const clusters = compact.nodes.filter((node) => node.kind === "cluster");
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.cluster?.nodeIds).toHaveLength(3);
    expect(clusters[0]?.height).toBe(GRAPH_METRICS.CLUSTER_H);
    // 折叠状态下这 3 个调用不再单独成卡
    expect(compact.nodes.filter((node) => node.kind === "node")).toHaveLength(3);

    const expanded = buildGraphLayout(doc, {
      ...baseOptions,
      compactTools: true,
      expandedClusters: new Set([clusters[0]?.cluster?.id ?? ""]),
    });
    expect(expanded.nodes.filter((node) => node.kind === "cluster")).toHaveLength(0);
    expect(expanded.nodes.filter((node) => node.kind === "node")).toHaveLength(6);
  });

  it("折叠轮次只保留 38px 的轮次头，不再排节点", () => {
    const doc = buildTraceDocument(fixture());
    const layout = buildGraphLayout(doc, {
      ...baseOptions,
      collapsedTurns: new Set(doc.rootTurnIds),
    });

    expect(layout.nodes).toHaveLength(0);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]?.collapsed).toBe(true);
    expect(layout.groups[0]?.height).toBe(GRAPH_METRICS.HEADER_H);
  });

  it("按命中轮次过滤时只排可见轮次", () => {
    const doc = buildTraceDocument(fixture());
    const layout = buildGraphLayout(doc, { ...baseOptions, visibleTurnIds: new Set<string>() });
    expect(layout.nodes).toHaveLength(0);
    expect(layout.groups).toHaveLength(0);
    expect(layout.width).toBe(400);
    expect(layout.height).toBe(240);
  });

  it("多列：轮次按时间顺序从左到右排，同一行的卡片顶边对齐且互不重叠", () => {
    const doc = buildTraceDocument(threeTurnFixture());
    const layout = buildGraphLayout(doc, { ...baseOptions, columns: 3 });

    expect(layout.groups).toHaveLength(3);
    const [first, second, third] = layout.groups;
    // 从左到右：x 递增，y 相同（同一行）
    expect(first!.x).toBeLessThan(second!.x);
    expect(second!.x).toBeLessThan(third!.x);
    expect(first!.y).toBe(second!.y);
    expect(second!.y).toBe(third!.y);

    // 三张卡片互不重叠
    for (let i = 0; i < layout.groups.length; i += 1) {
      for (let j = i + 1; j < layout.groups.length; j += 1) {
        const a = layout.groups[i]!;
        const b = layout.groups[j]!;
        expect(
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
        ).toBe(false);
      }
    }
    // 行内相邻轮次有横向连线，且不是竖向贝塞尔（控制点走 x）
    const horizontal = layout.edges.filter((edge) => edge.id.startsWith("e-turn-h-"));
    expect(horizontal).toHaveLength(2);
    expect(horizontal[0]!.d).toContain(" C ");
  });

  it("多列：列数不够时换行，第二行从第一列重新开始", () => {
    const doc = buildTraceDocument(threeTurnFixture());
    const layout = buildGraphLayout(doc, { ...baseOptions, columns: 2 });

    const [first, second, third] = layout.groups;
    expect(first!.y).toBe(second!.y);
    expect(third!.y).toBeGreaterThan(first!.y);
    expect(third!.x).toBe(first!.x);
    // 换行处不画横穿卡片的连线
    expect(layout.edges.filter((edge) => edge.id.includes(third!.id))).toHaveLength(0);
  });

  it("列数回落：columns=1 时仍是单列纵向流", () => {
    const doc = buildTraceDocument(threeTurnFixture());
    const single = buildGraphLayout(doc, { ...baseOptions, columns: 1 });
    const ys = single.groups.map((group) => group.y);
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
    expect(single.groups.every((group) => group.x === single.groups[0]!.x)).toBe(true);
  });

  it("多列下折叠轮次仍是 38px 头，不影响其它卡片位置", () => {
    const doc = buildTraceDocument(threeTurnFixture());
    const layout = buildGraphLayout(doc, {
      ...baseOptions,
      columns: 3,
      collapsedTurns: new Set([doc.rootTurnIds[1] ?? ""]),
    });
    const collapsed = layout.groups.find((group) => group.collapsed);
    expect(collapsed?.height).toBe(GRAPH_METRICS.HEADER_H);
    expect(layout.groups).toHaveLength(3);
  });

  it("思考节点使用 THINK_H 高度", () => {
    const doc = buildTraceDocument(fixture());
    const layout = buildGraphLayout(doc, { ...baseOptions });
    const thinking = layout.nodes.find((node) => node.node?.kind === "thinking");
    expect(thinking?.height).toBe(GRAPH_METRICS.THINK_H);
  });
});
