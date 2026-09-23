import { describe, expect, it, vi } from "vitest";

import {
  applyAskReply,
  buildAskPushText,
  buildBranchesReply,
  buildHelpReply,
  buildProjectCandidatesReply,
  buildProjectCommandUsage,
  buildProjectsReply,
  buildSessionsReply,
  buildStatusReply,
  collectSessionSummaries,
  formatRelativeTime,
  isHandleableLarkEvent,
  LarkGateway,
  LarkMessageDeduper,
  mapOptionAnswer,
  mapRunStateToLarkState,
  matchProjectSummaries,
  parseLarkCommand,
  parseLarkEventLine,
  parseProjectCommand,
} from "./gateway";
import type { LarkEventRecord, LarkPendingAsk } from "./gateway";

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

describe("带参数指令执行（mock deps）", () => {
  /** 构造带 mock 发送通道的网关：绕过真实 lark-cli，捕获 sendMarkdown 输出 */
  function gatewayOf(deps: Partial<ConstructorParameters<typeof LarkGateway>[0]> = {}) {
    const sent: string[] = [];
    const gateway = new LarkGateway({
      listSessions: () => [],
      resolveAsk: () => false,
      onStateChange: () => undefined,
      sendMessage: async (_cli, _openId, markdown) => {
        sent.push(markdown);
      },
      ...deps,
    });
    // sendMarkdown 需要 cliPath + allowedOpenId 才会走 deps.sendMessage
    (gateway as unknown as { cliPath: string }).cliPath = "lark-cli-stub";
    (gateway as unknown as { allowedOpenId: string }).allowedOpenId = "ou_allowed";
    return { gateway, sent };
  }

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
