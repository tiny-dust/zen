import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

import {
  applyAskReply,
  buildAskActionValue,
  buildAskPushCard,
  buildAskPushText,
  buildBranchesReply,
  buildHelpReply,
  buildMenuCard,
  buildProjectCandidatesReply,
  buildProjectCommandUsage,
  buildProjectsReply,
  buildSessionsReply,
  buildSessionDoneCard,
  buildStatusReply,
  collectSessionSummaries,
  extractCardAskAnswer,
  formatRelativeTime,
  isHandleableLarkEvent,
  LarkGateway,
  LarkMessageDeduper,
  mapOptionAnswer,
  mapRunStateToLarkState,
  matchProjectSummaries,
  parseAskActionValue,
  parseCardActionLine,
  parseLarkCommand,
  parseLarkEventLine,
  parseProjectCommand,
} from "./gateway";
import type {
  LarkCard2,
  LarkCardActionRecord,
  LarkEventRecord,
  LarkPendingAsk,
} from "./gateway";

import type { LarkProjectSummary, SessionRecord, WorkspaceGroup } from "@zen/shared";

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

// ---------- 项目/分支/提交指令 ----------

function projectOf(overrides: Partial<LarkProjectSummary> & Pick<LarkProjectSummary, "id" | "name" | "path">): LarkProjectSummary {
  return {
    lastActiveAt: NOW - 60_000,
    ...overrides,
  };
}

describe("项目/分支/提交指令解析与文案", () => {
  it("parseLarkCommand：项目/projects 全等匹配", () => {
    expect(parseLarkCommand("项目")).toBe("projects");
    expect(parseLarkCommand("Projects")).toBe("projects");
    expect(parseLarkCommand("项目 列表")).toBeNull();
  });

  it("parseProjectCommand：四种带参数指令与大小写不敏感", () => {
    expect(parseProjectCommand("对话 zen 修复登录 bug")).toEqual({
      kind: "chat",
      project: "zen",
      arg: "修复登录 bug",
    });
    expect(parseProjectCommand("Chat web 重构页面")).toEqual({
      kind: "chat",
      project: "web",
      arg: "重构页面",
    });
    expect(parseProjectCommand("分支 zen")).toEqual({ kind: "branches", project: "zen", arg: "" });
    expect(parseProjectCommand("分支 my project")).toEqual({
      kind: "branches",
      project: "my project",
      arg: "",
    });
    expect(parseProjectCommand("切换 zen feature/login")).toEqual({
      kind: "checkout",
      project: "zen",
      arg: "feature/login",
    });
    expect(parseProjectCommand("提交 zen 修复空指针")).toEqual({
      kind: "commit",
      project: "zen",
      arg: "修复空指针",
    });
    expect(parseProjectCommand("  对话   zen   消息内容 ")).toEqual({
      kind: "chat",
      project: "zen",
      arg: "消息内容",
    });
    // 非指令 / 裸指令词
    expect(parseProjectCommand("帮我看看这个报错")).toBeNull();
    expect(parseProjectCommand("普通句子 提交")).toBeNull();
  });

  it("parseProjectCommand：缺第二参数时 arg 为空字符串（由执行层回用法提示）", () => {
    expect(parseProjectCommand("对话")).toEqual({ kind: "chat", project: "", arg: "" });
    expect(parseProjectCommand("对话 zen")).toEqual({ kind: "chat", project: "zen", arg: "" });
    expect(parseProjectCommand("切换 zen")).toEqual({ kind: "checkout", project: "zen", arg: "" });
    expect(parseProjectCommand("提交")).toEqual({ kind: "commit", project: "", arg: "" });
  });

  it("matchProjectSummaries：名称与路径末段包含匹配、大小写不敏感", () => {
    const projects = [
      projectOf({ id: "w1", name: "zen", path: "/Users/r/Self/zen" }),
      projectOf({ id: "w2", name: "Web Console", path: "/Users/r/Company/zen-console" }),
    ];
    expect(matchProjectSummaries("zen", projects).map((p) => p.id)).toEqual(["w1", "w2"]);
    expect(matchProjectSummaries("web", projects).map((p) => p.id)).toEqual(["w2"]);
    expect(matchProjectSummaries("CONSOLE", projects).map((p) => p.id)).toEqual(["w2"]);
    expect(matchProjectSummaries("不存在", projects)).toHaveLength(0);
    expect(matchProjectSummaries("", projects)).toHaveLength(0);
  });

  it("buildProjectsReply / buildProjectCandidatesReply / buildBranchesReply 文案", () => {
    const projects = [
      projectOf({ id: "w1", name: "zen", path: "/Users/r/Self/zen", lastActiveAt: NOW - 60_000 }),
      projectOf({ id: "w2", name: "web", path: "/Users/r/Work/web", lastActiveAt: NOW - 2 * 86_400_000 }),
    ];
    const list = buildProjectsReply(projects, NOW);
    expect(list).toContain("📂 Zen 项目");
    expect(list).toContain("1. zen · /Users/r/Self/zen · 1 分钟前");
    expect(list).toContain("2. web · /Users/r/Work/web · 2 天前");
    expect(buildProjectsReply([], NOW)).toContain("暂无工作区");

    const candidates = buildProjectCandidatesReply("zen", projects, NOW);
    expect(candidates).toContain("有多个");
    expect(candidates).toContain("1. zen");
    expect(buildProjectCandidatesReply("zzz", [], NOW)).toContain("未找到");

    const branches = buildBranchesReply(projects[0]!, { current: "main", branches: ["main", "dev", "feature/x"] });
    expect(branches).toContain("🌿 zen 的本地分支");
    expect(branches).toContain("• main ← 当前");
    expect(branches).toContain("• feature/x");
    expect(buildBranchesReply(projects[0]!, { current: "", branches: [] })).toContain("没有本地分支");
  });

  it("buildProjectCommandUsage / buildHelpReply 覆盖新指令", () => {
    expect(buildProjectCommandUsage("chat")).toContain("对话 <项目名> <消息>");
    expect(buildProjectCommandUsage("branches")).toContain("分支 <项目名>");
    expect(buildProjectCommandUsage("checkout")).toContain("切换 <项目名> <分支名>");
    expect(buildProjectCommandUsage("commit")).toContain("提交 <项目名> <说明>");
    const help = buildHelpReply();
    expect(help).toContain("项目 / projects");
    expect(help).toContain("对话 <项目名> <消息> / chat");
    expect(help).toContain("分支 <项目名> / branches");
    expect(help).toContain("切换 <项目名> <分支名> / checkout");
    expect(help).toContain("提交 <项目名> <说明> / commit");
  });
});

/** 构造带 mock 发送通道的网关：绕过真实 lark-cli，捕获出站 markdown/卡片/接收者 */
function gatewayOf(deps: Partial<ConstructorParameters<typeof LarkGateway>[0]> = {}) {
  const sent: string[] = [];
  const cards: Array<Record<string, unknown>> = [];
  const recipients: string[] = [];
  const gateway = new LarkGateway({
    listSessions: () => [],
    resolveAsk: () => false,
    onStateChange: () => undefined,
    sendMessage: async (_cli, openId, markdown, cardJson) => {
      sent.push(markdown);
      recipients.push(openId);
      if (cardJson) {
        cards.push(JSON.parse(cardJson) as Record<string, unknown>);
      }
    },
    ...deps,
  });
  // sendMarkdown 需要 cliPath + allowedOpenId 才会走 deps.sendMessage
  (gateway as unknown as { cliPath: string }).cliPath = "lark-cli-stub";
  (gateway as unknown as { allowedOpenId: string }).allowedOpenId = "ou_allowed";
  // pushAsk/onSessionDone 等推送仅在非 off 态生效：默认置 ready（真实路径由 start() 拉起）
  (gateway as unknown as { state: string }).state = "ready";
  return { gateway, sent, cards, recipients };
}

describe("带参数指令执行（mock deps）", () => {
  it("项目指令 → 输出项目清单", async () => {
    const { gateway, sent } = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
    });
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText("项目");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("📂 Zen 项目");
    expect(sent[0]).toContain("zen · /tmp/zen");
  });

  it("对话指令：唯一命中 → 先回「已开始」再启动；启动失败补失败提示", async () => {
    const startChat = vi.fn(async () => ({ ok: false, error: "session not found" }));
    const { gateway, sent } = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
      startChat,
    });
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "对话 zen 修复登录 bug",
    );
    expect(startChat).toHaveBeenCalledWith("/tmp/zen", "修复登录 bug");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("已在「zen」开始新会话");
    expect(sent[0]).toContain("修复登录 bug");
    expect(sent[1]).toContain("会话启动失败");
  });

  it("对话指令：项目名歧义 → 列候选且不启动；未命中 → 未找到提示", async () => {
    const startChat = vi.fn();
    const projects = () => [
      projectOf({ id: "w1", name: "zen", path: "/tmp/zen" }),
      projectOf({ id: "w2", name: "zen-demo", path: "/tmp/zen-demo" }),
    ];
    const ambiguous = gatewayOf({ listProjects: projects, startChat });
    await (ambiguous.gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "对话 zen 你好",
    );
    expect(startChat).not.toHaveBeenCalled();
    expect(ambiguous.sent[0]).toContain("有多个");
    expect(ambiguous.sent[0]).toContain("zen-demo");

    const missing = gatewayOf({ listProjects: () => [], startChat });
    await (missing.gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "对话 zen 你好",
    );
    expect(missing.sent[0]).toContain("未找到匹配「zen」的项目");
  });

  it("对话/切换/提交缺参数 → 用法提示", async () => {
    const cases: Array<[string, string]> = [
      ["对话", "对话 <项目名> <消息>"],
      ["切换 zen", "切换 <项目名> <分支名>"],
      ["提交", "提交 <项目名> <说明>"],
      ["分支", "分支 <项目名>"],
    ];
    for (const [text, usage] of cases) {
      const { gateway, sent } = gatewayOf();
      await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText(text);
      expect(sent[0]).toContain(usage);
    }
  });

  it("分支指令 → 列本地分支并标当前；切换脏工作区 → 拒绝并提示先提交", async () => {
    const listBranches = vi.fn(async () => ({ current: "main", branches: ["main", "dev"] }));
    const { gateway, sent } = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
      listBranches,
    });
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText("分支 zen");
    expect(listBranches).toHaveBeenCalledWith("/tmp/zen");
    expect(sent[0]).toContain("• main ← 当前");

    const checkoutBranch = vi.fn(async () => ({
      ok: false,
      dirty: true,
      error: "工作区有未提交变更：\n M src/a.ts",
    }));
    const dirty = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
      checkoutBranch,
    });
    await (dirty.gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "切换 zen dev",
    );
    expect(checkoutBranch).toHaveBeenCalledWith("/tmp/zen", "dev");
    expect(dirty.sent[0]).toContain("有未提交变更，已拒绝切换分支");
    expect(dirty.sent[0]).toContain("提交 zen <说明>");
  });

  it("提交指令：成功回执摘要；无变更提示；缺省说明用默认文案", async () => {
    const commitProject = vi.fn(async (_path: string, message: string) => {
      expect(message).toBe("修复空指针");
      return { ok: true, summary: "abc1234 修复空指针\n 1 file changed" };
    });
    const { gateway, sent } = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
      commitProject,
    });
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "提交 zen 修复空指针",
    );
    expect(sent[0]).toContain("已提交（zen）");
    expect(sent[0]).toContain("abc1234 修复空指针");

    const clean = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
      commitProject: vi.fn(async () => ({ ok: false, clean: true, error: "没有可提交的变更" })),
    });
    await (clean.gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "提交 zen 无所谓",
    );
    expect(clean.sent[0]).toContain("没有可提交的变更");

    const defaulted = gatewayOf({
      listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
      commitProject: vi.fn(async (_path: string, message: string) => {
        expect(message).toBe("Zen 飞书提交");
        return { ok: true, summary: "ok" };
      }),
    });
    await (defaulted.gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "提交 zen",
    );
  });

  it("对话启动的会话 done → 微任务里推送最终助手回复摘要", async () => {
    vi.useFakeTimers();
    try {
      const finalAssistantReply = vi.fn(() => "已修复登录 bug，改动见 src/auth.ts");
      const { gateway, sent } = gatewayOf({
        listProjects: () => [projectOf({ id: "w1", name: "zen", path: "/tmp/zen" })],
        startChat: async () => ({ ok: true, sessionId: "s9", title: "修复登录 bug" }),
        finalAssistantReply,
      });
      await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
        "对话 zen 修复登录 bug",
      );
      gateway.trackSession("s9", "修复登录 bug");
      gateway.onSessionDone("s9");
      // emitTo 同步落库后微任务推送
      await Promise.resolve();
      await Promise.resolve();
      expect(finalAssistantReply).toHaveBeenCalledWith("s9");
      const last = sent[sent.length - 1] ?? "";
      expect(last).toContain("修复登录 bug 已完成");
      expect(last).toContain("已修复登录 bug，改动见 src/auth.ts");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- 卡片推送（interactive card）与降级 ----------

describe("卡片构建（纯函数）", () => {
  it("buildAskPushCard：header 标题=会话名，正文含 agentName/问题/选项，note 为回复指引", () => {
    const entry = pendingOf({ askId: "a1", seq: 4 });
    entry.question.agentName = "主进程飞书桥接";
    entry.question.options = ["方案 A", "方案 B"];
    const card = buildAskPushCard(entry, 1);
    expect(card.header?.title.content).toContain("🔔 Zen 问询 · 重构登录模块");
    expect(card.header?.title.content).toContain("重构登录模块");
    const body = JSON.stringify(card);
    expect(body).toContain("**来自** 主进程飞书桥接");
    expect(body).toContain("选择哪个方案？");
    expect(body).toContain("1. 方案 A");
    expect(body).toContain("直接回复文字或选项编号即可");
  });

  it("buildAskPushCard：多条待答 note 换成 #序号 指引", () => {
    const card = buildAskPushCard(pendingOf({ askId: "a1", seq: 4 }), 3);
    expect(JSON.stringify(card)).toContain("回复 #序号 开头，如 #4 <答案>");
  });

  it("buildSessionDoneCard：标题=会话名+已完成，正文=摘要，note 引导查询", () => {
    const card = buildSessionDoneCard("重构登录模块", "已修复登录 bug");
    expect(card.header?.title.content).toBe("✅ 重构登录模块 已完成");
    expect(JSON.stringify(card)).toContain("已修复登录 bug");
    expect(JSON.stringify(card)).toContain("「状态」");
  });

  it("buildMenuCard：列出现有指令 + 直接对话说明", () => {
    const card = buildMenuCard();
    expect(card.header?.title.content).toContain("📖 Zen 指令菜单");
    const body = JSON.stringify(card);
    for (const cmd of ["列表", "状态", "项目", "对话 <项目名> <消息>", "分支", "切换", "提交", "菜单"]) {
      expect(body).toContain(cmd);
    }
    expect(body).toContain("公共区新建会话");
  });
});

describe("出站卡片推送与鉴权（mock deps）", () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  /** 直接走事件行入口（私有方法），模拟 lark-cli NDJSON 输出 */
  async function feedLine(
    gateway: LarkGateway,
    line: string,
  ): Promise<void> {
    (gateway as unknown as { handleEventLine(line: string): void }).handleEventLine(line);
    await flush();
  }

  it("pushAsk → 发送 interactive 卡片（markdown 降级文案 + cardJson 同时带上）", async () => {
    const { gateway, sent, cards } = gatewayOf();
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: ["方案 A", "方案 B"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    expect(sent).toHaveLength(1);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.header).toMatchObject({
      title: { tag: "plain_text", content: "🔔 Zen 问询 · 重构登录模块" },
      template: "orange",
    });
  });

  it("卡片 JSON 超长 → 降级纯文本（无 cardJson，markdown 被截断）", async () => {
    const { gateway, sent, cards } = gatewayOf();
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "长文本 ".repeat(2000).trim(),
        options: [],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    expect(cards).toHaveLength(0);
    expect(sent).toHaveLength(1);
    // clampSendText：截断到 MAX_SEND_LENGTH-6 再补「已截断」尾注（长度 4001，沿用既有口径）
    expect(sent[0]!.length).toBeLessThanOrEqual(4001);
    expect(sent[0]).toContain("已截断");
  });

  it("会话 done → 推送完成卡片（green 模板 + 摘要正文）", async () => {
    const { gateway, sent, cards } = gatewayOf({
      finalAssistantReply: () => "已修复登录 bug，改动见 src/auth.ts",
    });
    gateway.trackSession("s9", "修复登录 bug");
    gateway.onSessionDone("s9");
    await flush();
    expect(sent[sent.length - 1]).toContain("修复登录 bug 已完成");
    expect(cards[cards.length - 1]?.header).toMatchObject({
      title: { tag: "plain_text", content: "✅ 修复登录 bug 已完成" },
      template: "green",
    });
  });

  it("操作鉴权：非绑定 open_id 的 p2p 文本 → 指令被忽略且回一句无权限（发给发送者）", async () => {
    const { gateway, sent, cards, recipients } = gatewayOf();
    await feedLine(
      gateway,
      JSON.stringify({
        message_id: "om_stranger",
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "text",
        sender_id: "ou_stranger",
        sender_type: "user",
        content: "列表",
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("无权限");
    expect(recipients[0]).toBe("ou_stranger");
    // 无权限提示是纯文本，不带卡片
    expect(cards).toHaveLength(0);
  });

  it("操作鉴权：同一 message_id 重投只回一次；群聊/未配置操控者时静默", async () => {
    const { gateway, sent } = gatewayOf();
    const strangerLine = JSON.stringify({
      message_id: "om_stranger",
      chat_id: "oc_1",
      chat_type: "p2p",
      message_type: "text",
      sender_id: "ou_stranger",
      sender_type: "user",
      content: "列表",
    });
    await feedLine(gateway, strangerLine);
    await feedLine(gateway, strangerLine);
    expect(sent).toHaveLength(1);

    const group = gatewayOf();
    await feedLine(
      group.gateway,
      JSON.stringify({
        message_id: "om_group",
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "text",
        sender_id: "ou_stranger",
        sender_type: "user",
        content: "列表",
      }),
    );
    expect(group.sent).toHaveLength(0);

    const unconfigured = gatewayOf();
    (unconfigured.gateway as unknown as { allowedOpenId: string | null }).allowedOpenId = null;
    await feedLine(
      unconfigured.gateway,
      JSON.stringify({
        message_id: "om_stranger",
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "text",
        sender_id: "ou_stranger",
        sender_type: "user",
        content: "列表",
      }),
    );
    expect(unconfigured.sent).toHaveLength(0);
  });

  it("菜单/帮助指令 → 发送菜单卡片；帮助降级文案含直接对话说明", async () => {
    const { gateway, sent, cards } = gatewayOf();
    const handleText = (gateway as unknown as { handleText(text: string): Promise<void> })
      .handleText
      .bind(gateway);
    await handleText("菜单");
    expect(sent[0]).toContain("📖 Zen 指令");
    expect(cards[0]?.header).toMatchObject({
      title: { tag: "plain_text", content: "📖 Zen 指令菜单" },
      template: "blue",
    });
    await handleText("帮助");
    expect(sent[1]).toContain("公共区新建会话");
    expect(cards).toHaveLength(2);
  });

  it("非指令普通文本 → startChat(null, 消息) 在公共区建会话并先回执", async () => {
    const startChat = vi.fn(async () => ({ ok: true, sessionId: "s5", title: "帮我写个快排" }));
    const { gateway, sent } = gatewayOf({ startChat });
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "帮我写个快排",
    );
    expect(startChat).toHaveBeenCalledWith(null, "帮我写个快排");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("已在公共区开始新会话");
    expect(sent[0]).toContain("帮我写个快排");
  });

  it("非指令文本启动失败 → 补失败提示", async () => {
    const startChat = vi.fn(async () => ({ ok: false, error: "session not found" }));
    const { gateway, sent } = gatewayOf({ startChat });
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText("随便聊聊");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("会话启动失败");
  });

  it("有待答问询时普通文本仍走问询回答，不新建会话", async () => {
    const startChat = vi.fn();
    const resolveAsk = vi.fn(() => true);
    const { gateway, sent } = gatewayOf({ startChat, resolveAsk });
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: [],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    await (gateway as unknown as { handleText(text: string): Promise<void> }).handleText(
      "采用方案 A",
    );
    expect(resolveAsk).toHaveBeenCalledWith("a1", "采用方案 A");
    expect(startChat).not.toHaveBeenCalled();
    expect(sent[sent.length - 1]).toContain("✅ 已回答");
  });

  it("parseLarkCommand：菜单/menu 归入 help", () => {
    expect(parseLarkCommand("菜单")).toBe("help");
    expect(parseLarkCommand("Menu")).toBe("help");
  });
});

// ---------- 卡片 2.0 构建（交互问询） ----------

function elementsOf(card: LarkCard2): Array<Record<string, any>> {
  return card.body.elements as Array<Record<string, any>>;
}

function actionRecordOf(
  overrides: Partial<LarkCardActionRecord> & Pick<LarkCardActionRecord, "eventId">,
): LarkCardActionRecord {
  return {
    operatorId: "ou_allowed",
    messageId: "om_card",
    chatId: "oc_1",
    actionTag: "button",
    actionValue: "",
    option: "",
    options: "",
    formValue: "",
    ...overrides,
  };
}

describe("卡片 2.0 构建（纯函数）", () => {
  it("buildAskPushCard：schema 2.0 骨架 + 单选 ≤4 → 按钮排（首钮 primary），value JSON 可 round-trip", () => {
    const entry = pendingOf({ askId: "a1", seq: 4 });
    entry.question.options = ["方案 A", "方案 B"];
    const card = buildAskPushCard(entry, 1);
    expect(card.schema).toBe("2.0");
    expect(card.config).toEqual({ update_multi: true, width_mode: "default" });
    const buttons = elementsOf(card).filter((el) => el.tag === "button");
    expect(buttons).toHaveLength(2);
    const btn0 = buttons[0]!;
    const btn1 = buttons[1]!;
    expect(btn0.type).toBe("primary_filled");
    expect(btn1.type).toBe("default");
    expect(btn0.text.content).toBe("方案 A");
    const btn0Behavior = btn0.behaviors[0]!;
    expect(parseAskActionValue(btn0Behavior.value)).toEqual({
      k: "ask",
      askId: "a1",
      seq: 4,
      a: "方案 A",
    });
    expect(buildAskActionValue("a1", 4, "方案 A")).toBe(btn0Behavior.value);
  });

  it("buildAskPushCard：单选 >4 → select_static（value 为 JSON 字符串）", () => {
    const entry = pendingOf({ askId: "a2", seq: 1 });
    entry.question.options = ["A", "B", "C", "D", "E"];
    const card = buildAskPushCard(entry, 1);
    const selects = elementsOf(card).filter((el) => el.tag === "select_static");
    expect(selects).toHaveLength(1);
    expect(elementsOf(card).some((el) => el.tag === "button")).toBe(false);
    const options = selects[0]!.options as Array<Record<string, any>>;
    expect(options).toHaveLength(5);
    const optionC = options[2]!;
    expect(optionC.text).toEqual({ tag: "plain_text", content: "C" });
    expect(parseAskActionValue(optionC.value)).toMatchObject({ askId: "a2", a: "C" });
  });

  it("buildAskPushCard：多选 → form + multi_select_static + 提交按钮（form_action_type=submit）", () => {
    const entry = pendingOf({ askId: "a3", seq: 2 });
    entry.question.options = ["A", "B", "C"];
    entry.question.multiSelect = true;
    const card = buildAskPushCard(entry, 1);
    const forms = elementsOf(card).filter((el) => el.tag === "form");
    expect(forms).toHaveLength(1);
    const form = forms[0]!;
    expect(form.name).toBe("form_ask");
    const inner = form.elements as Array<Record<string, any>>;
    const selector = inner[0]!;
    const submitBtn = inner[1]!;
    expect(selector.tag).toBe("multi_select_static");
    expect(selector.name).toBe("answer");
    expect(selector.options).toHaveLength(3);
    expect(submitBtn.tag).toBe("button");
    expect(submitBtn.form_action_type).toBe("submit");
    expect(parseAskActionValue(submitBtn.behaviors[0]!.value)).toMatchObject({
      askId: "a3",
      seq: 2,
      a: "",
    });
  });

  it("buildAskPushCard：无选项保持纯文本引导（无交互元素）", () => {
    const card = buildAskPushCard(pendingOf({ askId: "a1", seq: 1 }), 1);
    const tags = elementsOf(card).map((el) => el.tag);
    expect(tags).not.toContain("button");
    expect(tags).not.toContain("select_static");
    expect(tags).not.toContain("form");
    expect(JSON.stringify(card)).toContain("选择哪个方案？");
  });
});

describe("卡片回调解析（纯函数）", () => {
  it("parseCardActionLine：合法行 → 记录；坏行/缺 event_id → null", () => {
    const line = JSON.stringify({
      event_id: "e1",
      operator_id: "ou_allowed",
      message_id: "om_1",
      chat_id: "oc_1",
      action_tag: "button",
      action_value: "{}",
    });
    expect(parseCardActionLine(line)).toMatchObject({
      eventId: "e1",
      operatorId: "ou_allowed",
      actionTag: "button",
    });
    expect(parseCardActionLine("  ")).toBeNull();
    expect(parseCardActionLine("not json")).toBeNull();
    expect(parseCardActionLine("[1,2]")).toBeNull();
    expect(parseCardActionLine(JSON.stringify({ operator_id: "ou_x" }))).toBeNull();
  });

  it("parseAskActionValue：round-trip 与非法输入", () => {
    expect(parseAskActionValue(buildAskActionValue("a1", 3, "选项 X"))).toEqual({
      k: "ask",
      askId: "a1",
      seq: 3,
      a: "选项 X",
    });
    expect(parseAskActionValue("not json")).toBeNull();
    expect(parseAskActionValue('{"k":"other","askId":"a1","seq":1,"a":"x"}')).toBeNull();
    expect(parseAskActionValue('{"k":"ask","askId":"","seq":1,"a":"x"}')).toBeNull();
    expect(parseAskActionValue('{"k":"ask","askId":"a1","seq":"1","a":"x"}')).toBeNull();
  });

  it("extractCardAskAnswer：button + action_value → 直接取答案", () => {
    const answer = extractCardAskAnswer(
      actionRecordOf({
        eventId: "e1",
        actionValue: buildAskActionValue("a1", 4, "方案 B"),
      }),
    );
    expect(answer).toEqual({ askId: "a1", seq: 4, answer: "方案 B" });
  });

  it("extractCardAskAnswer：select_static + option → 取 option value JSON", () => {
    const answer = extractCardAskAnswer(
      actionRecordOf({
        eventId: "e2",
        actionTag: "select_static",
        option: buildAskActionValue("a2", 1, "选项 C"),
      }),
    );
    expect(answer).toEqual({ askId: "a2", seq: 1, answer: "选项 C" });
  });

  it("extractCardAskAnswer：button + form_value.answer 数组形态 → 顿号拼接", () => {
    const values = [
      buildAskActionValue("a3", 2, "方案 A"),
      buildAskActionValue("a3", 2, "方案 C"),
    ];
    const answer = extractCardAskAnswer(
      actionRecordOf({
        eventId: "e3",
        actionValue: buildAskActionValue("a3", 2, ""),
        formValue: JSON.stringify({ answer: values }),
      }),
    );
    expect(answer).toEqual({ askId: "a3", seq: 2, answer: "方案 A、方案 C" });
  });

  it("extractCardAskAnswer：form_value.answer 逗号连接的 value JSON 串 → 顿号拼接（无 action_value 时 askId 取自首个 value）", () => {
    const values = [
      buildAskActionValue("a3", 2, "方案 A"),
      buildAskActionValue("a3", 2, "方案 B"),
    ];
    const answer = extractCardAskAnswer(
      actionRecordOf({
        eventId: "e4",
        formValue: JSON.stringify({ answer: values.join(",") }),
      }),
    );
    expect(answer).toEqual({ askId: "a3", seq: 2, answer: "方案 A、方案 B" });
  });

  it("extractCardAskAnswer：form_value.answer 纯文本逗号串 → 顿号拼接", () => {
    const answer = extractCardAskAnswer(
      actionRecordOf({
        eventId: "e5",
        formValue: JSON.stringify({ answer: "方案 A,方案 B" }),
      }),
    );
    expect(answer).toEqual({ askId: "", seq: 0, answer: "方案 A、方案 B" });
  });

  it("extractCardAskAnswer：其他 tag / 空字段 / 坏 form_value → null", () => {
    expect(
      extractCardAskAnswer(actionRecordOf({ eventId: "e6", actionTag: "multi_select_static" })),
    ).toBeNull();
    expect(extractCardAskAnswer(actionRecordOf({ eventId: "e7", actionTag: "button" }))).toBeNull();
    expect(
      extractCardAskAnswer(
        actionRecordOf({ eventId: "e8", actionTag: "select_static", option: "not json" }),
      ),
    ).toBeNull();
    expect(
      extractCardAskAnswer(
        actionRecordOf({ eventId: "e9", actionTag: "button", formValue: "not json" }),
      ),
    ).toBeNull();
    expect(
      extractCardAskAnswer(
        actionRecordOf({ eventId: "e10", actionTag: "button", formValue: JSON.stringify({}) }),
      ),
    ).toBeNull();
  });
});

describe("卡片回调写回（mock deps）", () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function feedCardAction(gateway: LarkGateway, line: string): Promise<void> {
    (gateway as unknown as { handleCardActionLine(line: string): void }).handleCardActionLine(line);
    await flush();
  }

  it("按钮回调写回成功 → 回执「✅ 已回答」，askId 移入 selfResolved 并从 pendingAsks 删除", async () => {
    const resolveAsk = vi.fn(() => true);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: ["方案 A", "方案 B"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    await feedCardAction(
      gateway,
      JSON.stringify({
        event_id: "e1",
        operator_id: "ou_allowed",
        action_tag: "button",
        action_value: buildAskActionValue("a1", 1, "方案 B"),
      }),
    );
    expect(resolveAsk).toHaveBeenCalledWith("a1", "方案 B");
    expect(sent[sent.length - 1]).toContain("✅ 已回答：选择哪个方案？");
    const internals = gateway as unknown as {
      pendingAsks: Map<string, unknown>;
      selfResolved: Set<string>;
    };
    expect(internals.pendingAsks.has("a1")).toBe(false);
    expect(internals.selfResolved.has("a1")).toBe(true);
  });

  it("多选 form 提交（数组形态）→ 顿号拼接写回", async () => {
    const resolveAsk = vi.fn(() => true);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    gateway.pushAsk(
      {
        askId: "a2",
        toolCallId: "tc1",
        question: "选哪些？",
        options: ["A", "B", "C"],
        allowFreeText: true,
        multiSelect: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    await feedCardAction(
      gateway,
      JSON.stringify({
        event_id: "e2",
        operator_id: "ou_allowed",
        action_tag: "button",
        action_value: buildAskActionValue("a2", 1, ""),
        form_value: JSON.stringify({
          answer: [buildAskActionValue("a2", 1, "A"), buildAskActionValue("a2", 1, "C")],
        }),
      }),
    );
    expect(resolveAsk).toHaveBeenCalledWith("a2", "A、C");
    expect(sent[sent.length - 1]).toContain("✅ 已回答：选哪些？");
  });

  it("select_static 回调 → option value 写回", async () => {
    const resolveAsk = vi.fn(() => true);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    gateway.pushAsk(
      {
        askId: "a3",
        toolCallId: "tc1",
        question: "部署到哪个环境？",
        options: ["dev", "staging", "prod", "canary", "sandbox"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    await feedCardAction(
      gateway,
      JSON.stringify({
        event_id: "e3",
        operator_id: "ou_allowed",
        action_tag: "select_static",
        option: buildAskActionValue("a3", 1, "staging"),
      }),
    );
    expect(resolveAsk).toHaveBeenCalledWith("a3", "staging");
    expect(sent[sent.length - 1]).toContain("✅ 已回答：部署到哪个环境？");
  });

  it("非白名单 operator → 静默忽略（不写回不回消息）", async () => {
    const resolveAsk = vi.fn(() => true);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: ["方案 A", "方案 B"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    await feedCardAction(
      gateway,
      JSON.stringify({
        event_id: "e4",
        operator_id: "ou_stranger",
        action_tag: "button",
        action_value: buildAskActionValue("a1", 1, "方案 B"),
      }),
    );
    expect(resolveAsk).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1); // 仅 pushAsk 那一条
  });

  it("同一 event_id 重投 → 只写回一次", async () => {
    const resolveAsk = vi.fn(() => true);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: ["方案 A", "方案 B"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    const line = JSON.stringify({
      event_id: "e5",
      operator_id: "ou_allowed",
      action_tag: "button",
      action_value: buildAskActionValue("a1", 1, "方案 B"),
    });
    await feedCardAction(gateway, line);
    await feedCardAction(gateway, line);
    expect(resolveAsk).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
  });

  it("askId 已失效（resolveAsk false）→ 回「该问询已失效」并清 pendingAsks", async () => {
    const resolveAsk = vi.fn(() => false);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: ["方案 A", "方案 B"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    await feedCardAction(
      gateway,
      JSON.stringify({
        event_id: "e6",
        operator_id: "ou_allowed",
        action_tag: "button",
        action_value: buildAskActionValue("a1", 1, "方案 B"),
      }),
    );
    expect(sent[sent.length - 1]).toContain("该问询已失效");
    expect((gateway as unknown as { pendingAsks: Map<string, unknown> }).pendingAsks.has("a1")).toBe(
      false,
    );
  });

  it("askId 不在待答表（网关重启等）→ 仍尝试 resolveAsk，失败回失效提示", async () => {
    const resolveAsk = vi.fn(() => false);
    const { gateway, sent } = gatewayOf({ resolveAsk });
    await feedCardAction(
      gateway,
      JSON.stringify({
        event_id: "e7",
        operator_id: "ou_allowed",
        action_tag: "button",
        action_value: buildAskActionValue("a9", 1, "方案 B"),
      }),
    );
    expect(resolveAsk).toHaveBeenCalledWith("a9", "方案 B");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("该问询已失效");
  });
});

// ---------- 双消费通道（messages + card.action.trigger） ----------

type FakeChild = EventEmitter & {
  stdout: EventEmitter & { setEncoding(encoding: string): void };
  stderr: EventEmitter & { setEncoding(encoding: string): void };
  kill: ReturnType<typeof vi.fn>;
  exitCode: null;
  signalCode: null;
};

function fakeChild(): FakeChild {
  const makeStream = (): EventEmitter & { setEncoding(encoding: string): void } => {
    const stream = new EventEmitter() as EventEmitter & { setEncoding(encoding: string): void };
    stream.setEncoding = (encoding: string) => {
      expect(encoding).toBe("utf8");
    };
    return stream;
  };
  const child = new EventEmitter() as FakeChild;
  child.stdout = makeStream();
  child.stderr = makeStream();
  child.kill = vi.fn();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe("双消费通道（messages + card.action.trigger）", () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  function channelGateway() {
    const spawned: Array<{ eventKey: string; child: FakeChild }> = [];
    const spawnEvents = vi.fn((_cli: string, eventKey: string) => {
      const child = fakeChild();
      spawned.push({ eventKey, child });
      return child as unknown as import("node:child_process").ChildProcess;
    });
    const { gateway } = gatewayOf({ spawnEvents });
    return { gateway, spawned, spawnEvents };
  }

  const childOfChannel = (
    spawned: Array<{ eventKey: string; child: FakeChild }>,
    eventKey: string,
  ): FakeChild => spawned.filter((item) => item.eventKey === eventKey).pop()!.child;

  it("happy path：spawn 两个通道，各自 ready marker（自带 event_key）后转 ready", () => {
    const { gateway, spawned } = channelGateway();
    (gateway as unknown as { spawnAll(): void }).spawnAll();
    expect(spawned.map((item) => item.eventKey)).toEqual([
      "im.message.receive_v1",
      "card.action.trigger",
    ]);
    expect(gateway.snapshot().state).toBe("starting");

    childOfChannel(spawned, "im.message.receive_v1").stderr.emit(
      "data",
      "[event] ready event_key=im.message.receive_v1\n",
    );
    expect(gateway.snapshot().state).toBe("ready");

    childOfChannel(spawned, "card.action.trigger").stderr.emit(
      "data",
      "[event] ready event_key=card.action.trigger\n",
    );
    expect(gateway.snapshot().state).toBe("ready");
  });

  it("单通道异常退出 → 只重启该通道（5s 退避），另一通道不动", async () => {
    vi.useFakeTimers();
    try {
      const { gateway, spawned, spawnEvents } = channelGateway();
      (gateway as unknown as { spawnAll(): void }).spawnAll();
      childOfChannel(spawned, "card.action.trigger").emit("close", 1, null);
      expect(gateway.snapshot().state).toBe("starting");
      expect(gateway.snapshot().gatewayError).toContain("5s 后重试");
      expect(spawnEvents).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(spawnEvents).toHaveBeenCalledTimes(3);
      expect(spawnEvents.mock.calls[2]?.[1]).toBe("card.action.trigger");
      // messages 通道未被 kill
      expect(childOfChannel(spawned, "im.message.receive_v1").kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("连续 5 次失败 → 转 error 态并停止重启", async () => {
    vi.useFakeTimers();
    try {
      const { gateway, spawned, spawnEvents } = channelGateway();
      (gateway as unknown as { spawnAll(): void }).spawnAll();
      for (let i = 0; i < 5; i += 1) {
        childOfChannel(spawned, "card.action.trigger").emit("close", 1, null);
        if (i < 4) {
          await vi.advanceTimersByTimeAsync(5_000);
        }
      }
      expect(gateway.snapshot().state).toBe("error");
      expect(gateway.snapshot().gatewayError).toContain("连续 5 次");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(spawnEvents).toHaveBeenCalledTimes(2 + 4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop：同时停两个通道并清重启定时器", async () => {
    vi.useFakeTimers();
    try {
      const { gateway, spawned, spawnEvents } = channelGateway();
      (gateway as unknown as { spawnAll(): void }).spawnAll();
      gateway.stop();
      expect(gateway.snapshot().state).toBe("off");
      expect(childOfChannel(spawned, "im.message.receive_v1").kill).toHaveBeenCalledWith("SIGTERM");
      expect(childOfChannel(spawned, "card.action.trigger").kill).toHaveBeenCalledWith("SIGTERM");
      // stopping 后 close 事件不再触发重启
      childOfChannel(spawned, "im.message.receive_v1").emit("close", 0, null);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(spawnEvents).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("card 通道 stdout → 卡片回调写回（端到端走真实通道入口）", async () => {
    const resolveAsk = vi.fn(() => true);
    const children: FakeChild[] = [];
    const spawnEvents = vi.fn((_cli: string, _eventKey: string) => {
      const child = fakeChild();
      children.push(child);
      return child as unknown as import("node:child_process").ChildProcess;
    });
    const { gateway } = gatewayOf({ spawnEvents, resolveAsk });
    (gateway as unknown as { spawnAll(): void }).spawnAll();
    gateway.pushAsk(
      {
        askId: "a1",
        toolCallId: "tc1",
        question: "选择哪个方案？",
        options: ["方案 A", "方案 B"],
        allowFreeText: true,
      },
      "s1",
      "重构登录模块",
    );
    await flush();
    children[1]!.stdout.emit(
      "data",
      `${JSON.stringify({
        event_id: "e1",
        operator_id: "ou_allowed",
        action_tag: "button",
        action_value: buildAskActionValue("a1", 1, "方案 B"),
      })}\n`,
    );
    await flush();
    expect(resolveAsk).toHaveBeenCalledWith("a1", "方案 B");
  });
});

