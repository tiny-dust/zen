import { describe, expect, it, vi } from "vitest";

import {
  applyAskReply,
  buildAskPushText,
  buildSessionsReply,
  buildStatusReply,
  collectSessionSummaries,
  formatRelativeTime,
  isHandleableLarkEvent,
  LarkMessageDeduper,
  mapOptionAnswer,
  mapRunStateToLarkState,
  parseLarkCommand,
  parseLarkEventLine,
} from "./gateway";
import type { LarkEventRecord, LarkPendingAsk } from "./gateway";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const NOW = 1_700_000_000_000;

function sessionOf(overrides: Partial<SessionRecord> & Pick<SessionRecord, "id" | "title">): SessionRecord {
  return {
    workspaceId: null,
    draft: "",
    pinned: false,
    archived: false,
    createdAt: NOW - 100_000,
    updatedAt: NOW - 100_000,
    ...overrides,
  };
}

function groupOf(sessions: SessionRecord[]): WorkspaceGroup {
  return {
    id: "w1",
    name: "workspace",
    path: "/tmp/ws",
    kind: "workspace",
    pinned: false,
    archived: false,
    createdAt: NOW - 1_000_000,
    sessions,
  };
}

function eventOf(overrides: Partial<LarkEventRecord>): LarkEventRecord {
  return {
    messageId: "om_xxx",
    chatId: "oc_xxx",
    chatType: "p2p",
    messageType: "text",
    senderId: "ou_allowed",
    senderType: "user",
    content: "列表",
    ...overrides,
  };
}

function pendingOf(overrides: Partial<LarkPendingAsk> & Pick<LarkPendingAsk, "askId" | "seq">): LarkPendingAsk {
  return {
    sessionId: "s1",
    sessionTitle: "重构登录模块",
    question: {
      askId: overrides.askId,
      toolCallId: "tc1",
      question: "选择哪个方案？",
      options: [],
      allowFreeText: true,
    },
    ...overrides,
  } as LarkPendingAsk;
}

describe("指令解析与会话状态映射", () => {
  it("parseLarkCommand：全等匹配、去空白、大小写不敏感", () => {
    expect(parseLarkCommand("列表")).toBe("sessions");
    expect(parseLarkCommand(" 列表 ")).toBe("sessions");
    expect(parseLarkCommand("Sessions")).toBe("sessions");
    expect(parseLarkCommand("状态")).toBe("status");
    expect(parseLarkCommand("STATUS")).toBe("status");
    expect(parseLarkCommand("帮助")).toBe("help");
    expect(parseLarkCommand("Help")).toBe("help");
    expect(parseLarkCommand("列表一下")).toBeNull();
    expect(parseLarkCommand("")).toBeNull();
  });

  it("mapRunStateToLarkState：inserting→running，paused/审批/提问优先，无对象→空闲", () => {
    expect(mapRunStateToLarkState(null)).toBe("idle");
    expect(mapRunStateToLarkState({ runActive: true, paused: true, waitingApproval: false, waitingAskCount: 0, inserting: true })).toBe("running");
    expect(mapRunStateToLarkState({ runActive: true, paused: true, waitingApproval: false, waitingAskCount: 0, inserting: false })).toBe("paused");
    expect(mapRunStateToLarkState({ runActive: true, paused: false, waitingApproval: true, waitingAskCount: 0, inserting: false })).toBe("waiting-approval");
    expect(mapRunStateToLarkState({ runActive: true, paused: false, waitingApproval: false, waitingAskCount: 2, inserting: false })).toBe("waiting-ask");
    expect(mapRunStateToLarkState({ runActive: true, paused: false, waitingApproval: false, waitingAskCount: 0, inserting: false })).toBe("running");
    // run 已结束的残留会话对象按空闲展示（「状态」指令不列）
    expect(mapRunStateToLarkState({ runActive: false, paused: false, waitingApproval: false, waitingAskCount: 0, inserting: false })).toBe("idle");
  });

  it("collectSessionSummaries：拍平 + 过滤归档 + 倒序 + limit", () => {
    const groups = [
      groupOf([
        sessionOf({ id: "s1", title: "旧会话", updatedAt: NOW - 90_000 }),
        sessionOf({ id: "s2", title: "新会话", updatedAt: NOW - 10_000 }),
        sessionOf({ id: "s3", title: "已归档", archived: true, updatedAt: NOW - 1_000 }),
      ]),
      groupOf([sessionOf({ id: "s4", title: "另一工作区", updatedAt: NOW - 50_000 })]),
    ];
    const summaries = collectSessionSummaries(groups, () => "running", 2);
    expect(summaries.map((item) => item.id)).toEqual(["s2", "s4"]);
    expect(summaries[0]).toMatchObject({ title: "新会话", state: "running" });
  });

  it("formatRelativeTime：分钟/小时/天", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 3 * 60_000, NOW)).toBe("3 分钟前");
    expect(formatRelativeTime(NOW - 5 * 3_600_000, NOW)).toBe("5 小时前");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2 天前");
  });

  it("buildSessionsReply / buildStatusReply 文案", () => {
    const summaries = [
      { id: "s1", title: "会话 A", state: "running" as const, updatedAt: NOW - 60_000 },
      { id: "s2", title: "会话 B", state: "waiting-ask" as const, updatedAt: NOW - 3_600_000 },
      { id: "s3", title: "会话 C", state: "idle" as const, updatedAt: NOW - 86_400_000 },
    ];
    const list = buildSessionsReply(summaries, NOW);
    expect(list).toContain("会话 A · 运行中 · 1 分钟前");
    expect(list).toContain("会话 B · 等待回答 · 1 小时前");

    const status = buildStatusReply(summaries, (id) => (id === "s2" ? "选择哪个方案？" : null), NOW);
    expect(status).toContain("会话 B · 等待回答");
    expect(status).toContain("❓ 选择哪个方案？");
    // 空闲会话不进状态回复
    expect(status).not.toContain("会话 C");
    expect(buildStatusReply([], () => null, NOW)).toContain("没有运行中的会话");
  });
});

describe("问询回复解析", () => {
  it("mapOptionAnswer：纯数字/逗号顿号分隔命中选项 → 顿号拼接（镜像 UI 多选提交）", () => {
    const options = ["方案 A", "方案 B", "方案 C"];
    expect(mapOptionAnswer("2", options)).toBe("方案 B");
    expect(mapOptionAnswer("1,2", options)).toBe("方案 A、方案 B");
    expect(mapOptionAnswer("1、3", options)).toBe("方案 A、方案 C");
    expect(mapOptionAnswer("1，2", options)).toBe("方案 A、方案 B");
    expect(mapOptionAnswer("9", options)).toBeNull();
    expect(mapOptionAnswer("1、x", options)).toBeNull();
    expect(mapOptionAnswer("采用方案 A", options)).toBeNull();
    expect(mapOptionAnswer("2", [])).toBeNull();
  });

  it("无待答 → 提示没有待回答问询", () => {
    const resolveAsk = vi.fn(() => true);
    const result = applyAskReply("随便答", [], resolveAsk);
    expect(result.reply).toContain("没有待回答的问询");
    expect(result.resolvedAskIds).toHaveLength(0);
    expect(resolveAsk).not.toHaveBeenCalled();
  });

  it("单条待答 → 整段文本为答案", () => {
    const resolveAsk = vi.fn(() => true);
    const pending = [pendingOf({ askId: "a1", seq: 5 })];
    const result = applyAskReply("采用方案 A，尽快上线", pending, resolveAsk);
    expect(resolveAsk).toHaveBeenCalledWith("a1", "采用方案 A，尽快上线");
    expect(result.resolvedAskIds).toEqual(["a1"]);
    expect(result.reply).toContain("✅ 已回答");
  });

  it("单条待答 + 数字答案命中选项 → 换成选项文本", () => {
    const resolveAsk = vi.fn(() => true);
    const entry = pendingOf({ askId: "a1", seq: 1 });
    entry.question.options = ["方案 A", "方案 B"];
    const result = applyAskReply("2", [entry], resolveAsk);
    expect(resolveAsk).toHaveBeenCalledWith("a1", "方案 B");
    expect(result.resolvedAskIds).toEqual(["a1"]);
  });

  it("多条待答 → 无 #N 前缀时列出待答序号", () => {
    const resolveAsk = vi.fn(() => true);
    const pending = [
      pendingOf({ askId: "a1", seq: 3 }),
      pendingOf({
        askId: "a2",
        seq: 7,
        question: { askId: "a2", toolCallId: "t", question: "部署到哪个环境？", options: [], allowFreeText: true },
      }),
    ];
    const result = applyAskReply("staging", pending, resolveAsk);
    expect(result.reply).toContain("#3");
    expect(result.reply).toContain("#7");
    expect(result.reply).toContain("#序号");
    expect(resolveAsk).not.toHaveBeenCalled();
    expect(result.resolvedAskIds).toHaveLength(0);
  });

  it("多条待答 → #N 前缀路由到对应问询，前缀后的文本为答案", () => {
    const resolveAsk = vi.fn(() => true);
    const pending = [
      pendingOf({ askId: "a1", seq: 3 }),
      pendingOf({ askId: "a2", seq: 7 }),
    ];
    const result = applyAskReply("#7 部署到 staging", pending, resolveAsk);
    expect(resolveAsk).toHaveBeenCalledWith("a2", "部署到 staging");
    expect(result.resolvedAskIds).toEqual(["a2"]);
  });

  it("多条待答 → 未知序号提示且不写回", () => {
    const resolveAsk = vi.fn(() => true);
    const pending = [pendingOf({ askId: "a1", seq: 3 }), pendingOf({ askId: "a2", seq: 5 })];
    const result = applyAskReply("#9 hello", pending, resolveAsk);
    expect(result.reply).toContain("#9 不是当前待答问询");
    expect(resolveAsk).not.toHaveBeenCalled();
  });

  it("多条待答 → 裸 #N 等价于选项编号", () => {
    const resolveAsk = vi.fn(() => true);
    const entry = pendingOf({ askId: "a1", seq: 2 });
    entry.question.options = ["选项一", "选项二", "选项三"];
    const result = applyAskReply("#2", [entry, pendingOf({ askId: "a2", seq: 5 })], resolveAsk);
    expect(resolveAsk).toHaveBeenCalledWith("a1", "选项二");
    expect(result.resolvedAskIds).toEqual(["a1"]);
  });

  it("askId 失效（resolveAsk 返回 false）→ 进 invalidAskIds 且回复失效提示", () => {
    const resolveAsk = vi.fn(() => false);
    const pending = [pendingOf({ askId: "a1", seq: 1 })];
    const result = applyAskReply("答案", pending, resolveAsk);
    expect(result.resolvedAskIds).toHaveLength(0);
    expect(result.invalidAskIds).toEqual(["a1"]);
    expect(result.reply).toContain("失效");
  });
});

describe("问询推送文案", () => {
  it("单条待答：标题 + agentName + 编号选项 + 直接回复尾注", () => {
    const entry = pendingOf({ askId: "a1", seq: 4 });
    entry.question.agentName = "主进程飞书桥接";
    entry.question.options = ["方案 A", "方案 B"];
    const text = buildAskPushText(entry, 1);
    expect(text).toContain("🔔 Zen 问询 · 重构登录模块");
    expect(text).toContain("来自 主进程飞书桥接");
    expect(text).toContain("1. 方案 A");
    expect(text).toContain("2. 方案 B");
    expect(text).toContain("直接回复文字或选项编号即可");
    expect(text).not.toContain("#4 <答案>");
  });

  it("multiSelect 注明编号组合；多条待答换成 #序号 尾注", () => {
    const entry = pendingOf({ askId: "a1", seq: 2 });
    entry.question.options = ["A", "B", "C"];
    entry.question.multiSelect = true;
    expect(buildAskPushText(entry, 1)).toContain("可多选");
    expect(buildAskPushText(entry, 3)).toContain("多个问询待回答：回复 #序号 开头，如 #2 <答案>");
  });
});

describe("NDJSON 行解析与过滤", () => {
  it("parseLarkEventLine：合法行 → 记录；坏行/空行/缺 message_id → null", () => {
    const line = JSON.stringify({
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "p2p",
      message_type: "text",
      sender_id: "ou_1",
      sender_type: "user",
      content: "状态",
      create_time: "1700000000000",
    });
    expect(parseLarkEventLine(line)).toMatchObject({ messageId: "om_1", content: "状态" });
    expect(parseLarkEventLine("  ")).toBeNull();
    expect(parseLarkEventLine("这不是 JSON")).toBeNull();
    expect(parseLarkEventLine("[1,2,3]")).toBeNull();
    expect(parseLarkEventLine(JSON.stringify({ chat_id: "oc_1" }))).toBeNull();
  });

  it("isHandleableLarkEvent：bot 消息 / 非 text / 非 p2p / 非白名单用户 / 未配置 open_id 全部拒绝", () => {
    const allowed = "ou_allowed";
    expect(isHandleableLarkEvent(eventOf({}), allowed)).toBe(true);
    expect(isHandleableLarkEvent(eventOf({ senderType: "bot" }), allowed)).toBe(false);
    expect(isHandleableLarkEvent(eventOf({ messageType: "image" }), allowed)).toBe(false);
    expect(isHandleableLarkEvent(eventOf({ chatType: "group" }), allowed)).toBe(false);
    expect(isHandleableLarkEvent(eventOf({ senderId: "ou_other" }), allowed)).toBe(false);
    expect(isHandleableLarkEvent(eventOf({}), null)).toBe(false);
  });

  it("LarkMessageDeduper：重复忽略，超 200 条 FIFO 淘汰最早记录", () => {
    const deduper = new LarkMessageDeduper(200);
    expect(deduper.firstSeen("m1")).toBe(true);
    expect(deduper.firstSeen("m1")).toBe(false);
    for (let i = 0; i < 200; i += 1) {
      deduper.firstSeen(`bulk-${i}`);
    }
    // m1 已被挤出窗口：再次出现按首次处理
    expect(deduper.firstSeen("m1")).toBe(true);
  });
});
