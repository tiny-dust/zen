import { describe, expect, it } from "vitest";

import {
  CONTEXT_OVERHEAD_TOKENS,
  buildHistory,
  compressHistory,
  estimateHistoryTokens,
  estimateTokens,
} from "./chat-types";
import type { BrowserElementRef, ChatMessage, ChatTurn } from "@zen/shared";

function turns(n: number): ChatTurn[] {
  const list: ChatTurn[] = [];
  for (let i = 0; i < n; i += 1) {
    list.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `第 ${i} 条消息内容，用于压缩测试。`,
    });
  }
  return list;
}

function elementRef(selector: string, text: string): BrowserElementRef {
  return {
    selector,
    selectorCandidates: [selector],
    tag: "button",
    id: "",
    className: "",
    text,
    name: "",
    type: "",
    placeholder: "",
    ariaLabel: "",
    role: "",
    href: "",
    rect: { x: 10, y: 20, width: 80, height: 32 },
    pageUrl: "https://example.com/login",
    pageTitle: "登录",
  };
}

function userMessage(content: string, meta?: Record<string, unknown>): ChatMessage {
  return { id: "m1", role: "user", content, createdAt: 1, meta };
}

describe("buildHistory", () => {
  it("user 正文里的 `$el:` token 按 meta.elementMarks 展开为完整元素描述", () => {
    const messages: ChatMessage[] = [
      userMessage("点击 $el:登录 按钮", {
        elementMarks: [{ token: "$el:登录", ref: elementRef("#login", "登录") }],
      }),
      { id: "m2", role: "assistant", content: "已点击", createdAt: 2 },
    ];
    const history = buildHistory(messages);
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe("user");
    // token 被替换成 [页面元素] 描述，Agent 不再看到裸 token
    expect(history[0]?.content).toContain("[页面元素]");
    expect(history[0]?.content).toContain("selector=`#login`");
    expect(history[0]?.content).not.toContain("$el:登录");
    expect(history[1]?.content).toBe("已点击");
  });

  it("无 meta / meta 脏数据 / 正文无 token 时原样返回", () => {
    const dirty: Array<{ token?: unknown; ref?: unknown } | null> = [
      null,
      { token: "$el:登录" },
      { ref: elementRef("#a", "a") },
    ];
    const history = buildHistory([
      userMessage("没有标注的正文 $el:登录"),
      userMessage("带脏数据 $el:登录", { elementMarks: dirty }),
      { id: "m3", role: "system", content: "系统消息不入历史", createdAt: 3 },
    ]);
    expect(history).toHaveLength(2);
    // 无 meta 与脏 meta 均展开不了 token，正文原样保留
    expect(history[0]?.content).toBe("没有标注的正文 $el:登录");
    expect(history[1]?.content).toBe("带脏数据 $el:登录");
  });
});

const baseOpts = {
  tasks: [],
  touchedFiles: [],
  uploads: [],
  force: false,
  overThreshold: false,
};

describe("estimateTokens", () => {
  it("空串为 0，中英混合按字种粗估", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBeGreaterThan(0);
    const cjk = estimateTokens("上下文压缩测试");
    const latin = estimateTokens("abcdefgh");
    expect(cjk).toBeGreaterThan(0);
    expect(latin).toBeGreaterThan(0);
  });

  it("estimateHistoryTokens 含固定系统/工具开销", () => {
    const empty = estimateHistoryTokens([]);
    expect(empty).toBe(CONTEXT_OVERHEAD_TOKENS);
    const withTurns = estimateHistoryTokens(turns(3));
    expect(withTurns).toBeGreaterThan(empty);
  });
});

describe("compressHistory", () => {
  it("短会话或未触发时原样返回", () => {
    const history = turns(4);
    expect(compressHistory(history, { ...baseOpts, force: true })).toMatchObject({
      compressed: false,
      turns: history,
      summary: "",
      compactedCount: 0,
    });
    expect(compressHistory(turns(10), baseOpts)).toMatchObject({ compressed: false });
  });

  it("force 或 overThreshold 触发：history 变短，摘要完整可读", () => {
    const history = turns(12);
    const byForce = compressHistory(history, { ...baseOpts, force: true });
    expect(byForce.compressed).toBe(true);
    expect(byForce.compactedCount).toBe(6);
    // 摘要 + 最近 6 条，远短于 12
    expect(byForce.turns).toHaveLength(7);
    expect(byForce.turns.length).toBeLessThan(history.length);
    // 摘要走 system 轮，不与真实用户消息混淆
    expect(byForce.turns[0]?.role).toBe("system");
    expect(byForce.summary).toContain("会话摘要");
    expect(byForce.summary).toContain("目标：");
    expect(byForce.summary).toContain("用户此前的要求：");
    expect(byForce.summary).toContain("第 0 条消息内容");
    expect(byForce.turns[0]?.content).toBe(byForce.summary);

    const byThreshold = compressHistory(history, { ...baseOpts, overThreshold: true });
    expect(byThreshold.compressed).toBe(true);
    expect(byThreshold.turns).toHaveLength(7);
  });

  it("摘要含任务进度与读写文件，便于恢复上下文", () => {
    const history = turns(10);
    const result = compressHistory(history, {
      tasks: [{ label: "修统计", done: true }],
      touchedFiles: ["apps/ui/src/stores/chat.ts"],
      uploads: ["spec.md"],
      force: true,
      overThreshold: false,
    });
    expect(result.summary).toContain("任务进度：");
    expect(result.summary).toContain("- [x] 修统计");
    expect(result.summary).toContain("apps/ui/src/stores/chat.ts");
    expect(result.summary).toContain("spec.md");
    // 最近 6 条原文保留
    const recent = result.turns.slice(1);
    expect(recent).toEqual(history.slice(-6));
  });

  it("focus 非空时摘要正文后追加压缩焦点段", () => {
    const result = compressHistory(turns(12), {
      ...baseOpts,
      force: true,
      focus: "  保留统计口径的实现细节  ",
    });
    expect(result.summary).toContain("[压缩焦点] 保留统计口径的实现细节");
    expect(result.summary).toContain("此后任务重点围绕该方向推进，相关上下文优先保留。");
    // 焦点段在结尾标记之前，不打断「摘要结束」语义
    expect(result.summary.indexOf("[压缩焦点]")).toBeLessThan(result.summary.indexOf("（摘要结束"));
  });

  it("未传或空 focus 时摘要不含压缩焦点段", () => {
    const without = compressHistory(turns(12), { ...baseOpts, force: true });
    expect(without.summary).not.toContain("[压缩焦点]");
    const empty = compressHistory(turns(12), { ...baseOpts, force: true, focus: "   " });
    expect(empty.summary).not.toContain("[压缩焦点]");
  });
});
