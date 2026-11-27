// 对话记忆契约（主进程层）：
// 1. 存储：episodes/facts/persona/settings 四个独立文件，原子写入，坏 JSON 读成空结构；
// 2. ingest：太短跳过、无模型报错、模型输出被截断时不落盘、同 session 合并、手改摘要不被覆盖；
// 3. 事实去重：归一化完全相同或字符级重合度 ≥ 0.85 都跳过；
// 4. 召回：本地词法打分（CJK 2-gram + 拉丁词），pinned 优先，注入文本 ≤ 1200 字；
// 5. clear 只清对话记忆，设备/习惯备注不动；autoSummarize 有节流。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dir: "",
  completeOnce: vi.fn(),
  getSelection: vi.fn(async (): Promise<{ providerId: string | null; modelId: string | null }> => ({
    providerId: "provider-1",
    modelId: "model-1",
  })),
}));

vi.mock("./zen-dir", () => ({ zenMemoryDir: () => state.dir }));
vi.mock("./model-api", () => ({ completeOnce: state.completeOnce }));
vi.mock("./model-db", () => ({ getSelection: state.getSelection }));

import {
  DEFAULT_CONVERSATION_MEMORY_SETTINGS,
  clearConversationMemory,
  ingestConversationMemory,
  listConversationMemory,
  maybeAutoIngest,
  readConversationMemoryState,
  readConversationSettings,
  recallConversationMemory,
  renderRecallBlock,
  resetConversationMemoryRuntimeState,
  setConversationMemorySettings,
  updateConversationEpisode,
  upsertConversationFact,
} from "./memory-conversations";

import type {
  ConversationMemorySettings,
  MemoryIngestMessage,
} from "@zen/shared";

function file(name: string): string {
  return join(state.dir, name);
}

function writeJson(name: string, data: unknown): void {
  writeFileSync(file(name), JSON.stringify(data, null, 2), "utf8");
}

function writeSettings(patch: Partial<ConversationMemorySettings>): void {
  writeJson("conversation-settings.json", {
    settings: { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS, ...patch },
    lastError: "",
  });
}

/** 一段够长的会话（默认 8 条、正文 > 400 字，满足自动摘要的消息数门槛） */
function conversation(turns = 4): MemoryIngestMessage[] {
  const messages: MemoryIngestMessage[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    messages.push({
      role: "user",
      content: `第${turn}轮：请帮我排查 ATS 调度平台的端口冲突，本地 dev 服务起不来。`.repeat(3),
    });
    messages.push({
      role: "assistant",
      content: `第${turn}轮：先确认 8080 被哪个进程占用，再看 dev profile 的配置是否指向正确的数据库。`.repeat(3),
    });
  }
  return messages;
}

function summaryJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "ATS 调度平台排障",
    summary: "排查了 ATS 调度平台本地 dev 服务端口冲突，确认 8080 被占用并改用 8081。",
    keywords: ["ATS", "端口冲突"],
    facts: [],
    ...overrides,
  });
}

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), "zen-memory-conv-"));
  state.completeOnce.mockReset();
  state.getSelection.mockReset();
  state.getSelection.mockResolvedValue({ providerId: "provider-1", modelId: "model-1" });
  resetConversationMemoryRuntimeState();
});

afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true });
});

describe("存储与默认设置", () => {
  it("缺省设置全关（enabled/autoSummarize/autoExtractFacts/recall），topK=3，model=null", async () => {
    const settings = await readConversationSettings();
    expect(settings).toEqual(DEFAULT_CONVERSATION_MEMORY_SETTINGS);
    expect(settings.enabled).toBe(false);
    expect(settings.model).toBeNull();
  });

  it("坏 JSON 读成空结构，不抛错", async () => {
    writeFileSync(file("episodes.json"), "{ not json", "utf8");
    writeFileSync(file("facts.json"), "null", "utf8");
    const list = await listConversationMemory();
    expect(list).toEqual({ episodes: [], facts: [] });
  });

  it("setSettings 只接受白名单字段，topK 夹到 1–8", async () => {
    const next = await setConversationMemorySettings({ enabled: true, topK: 99, bogus: "x" });
    expect(next.settings.enabled).toBe(true);
    expect(next.settings.topK).toBe(8);
    expect(Object.keys(next.settings)).not.toContain("bogus");

    const low = await setConversationMemorySettings({ topK: -3 });
    expect(low.settings.topK).toBe(1);
  });

  it("updateEpisode 非法入参返回当前列表、不落盘", async () => {
    writeJson("episodes.json", [
      {
        id: "e1",
        sessionId: "s1",
        workspaceId: "w1",
        title: "标题",
        summary: "摘要",
        keywords: [],
        messageCount: 2,
        pinned: false,
        edited: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    await updateConversationEpisode(123, { title: "x" });
    await updateConversationEpisode("e1", { summary: 42 });
    const list = await listConversationMemory();
    expect(list.episodes[0]?.title).toBe("标题");
    expect(list.episodes[0]?.summary).toBe("摘要");
  });
});

describe("ingest 门槛与失败处理", () => {
  it("太短（<4 条或 <400 字）直接跳过，不调模型", async () => {
    const result = await ingestConversationMemory("s1", [
      { role: "user", content: "排查端口" },
      { role: "assistant", content: "好" },
    ]);
    expect(result).toEqual({ ok: false, skipped: "too-short", factsAdded: 0 });
    expect(state.completeOnce).not.toHaveBeenCalled();
    expect(existsSync(file("episodes.json"))).toBe(false);
  });

  it("过滤空消息与 error 消息", async () => {
    const messages = [
      { role: "user", content: "   " },
      { role: "assistant", content: "错误：连接超时" },
    ];
    const result = await ingestConversationMemory("s1", messages);
    expect(result.skipped).toBe("too-short");
    expect(state.completeOnce).not.toHaveBeenCalled();
  });

  it("没有可用模型时报错，且不用默认模型硬跑", async () => {
    state.getSelection.mockResolvedValue({ providerId: null, modelId: null });
    const result = await ingestConversationMemory("s1", conversation());
    expect(result).toEqual({ ok: false, error: "请先在记忆设置里选择模型", factsAdded: 0 });
    expect(state.completeOnce).not.toHaveBeenCalled();
  });

  it("模型输出被截断：返回 {ok:false} 且不写任何文件", async () => {
    state.completeOnce.mockResolvedValue('{"title":"ATS","summary":"排查了端口冲');
    const result = await ingestConversationMemory("s1", conversation());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("JSON");
    expect(existsSync(file("episodes.json"))).toBe(false);
    expect(existsSync(file("facts.json"))).toBe(false);
  });

  it("模型调用抛错同样不落盘", async () => {
    state.completeOnce.mockRejectedValue(new Error("网络超时"));
    const result = await ingestConversationMemory("s1", conversation());
    expect(result).toEqual({ ok: false, error: "网络超时", factsAdded: 0 });
    expect(existsSync(file("episodes.json"))).toBe(false);
  });

  it("模型没给出内容时按 no-content 跳过", async () => {
    state.completeOnce.mockResolvedValue(JSON.stringify({ title: "", summary: "", facts: [] }));
    const result = await ingestConversationMemory("s1", conversation());
    expect(result).toEqual({ ok: true, episode: null, factsAdded: 0, skipped: "no-content" });
    expect(existsSync(file("episodes.json"))).toBe(false);
  });
});

describe("同 session 合并与手改保护", () => {
  it("同一 session 第二次 ingest 更新同一条 episode（摘要用新的）", async () => {
    state.completeOnce.mockResolvedValueOnce(summaryJson());
    const first = await ingestConversationMemory("s1", conversation(), { workspaceId: "w1" });
    expect(first.ok).toBe(true);
    expect(first.episode?.summary).toContain("8081");

    state.completeOnce.mockResolvedValueOnce(
      summaryJson({ title: "ATS 排障（续）", summary: "补充确认 dev profile 指向 8081 并跑通。" }),
    );
    const second = await ingestConversationMemory("s1", conversation(), { workspaceId: "w1" });
    const list = await listConversationMemory();
    expect(list.episodes).toHaveLength(1);
    expect(list.episodes[0]?.id).toBe(first.episode?.id);
    expect(list.episodes[0]?.title).toBe("ATS 排障（续）");
    expect(list.episodes[0]?.summary).toContain("跑通");
    expect(second.episode?.workspaceId).toBe("w1");
  });

  it("用户手改过摘要（edited）后，再次 ingest 不覆盖摘要", async () => {
    state.completeOnce.mockResolvedValueOnce(summaryJson());
    const first = await ingestConversationMemory("s1", conversation());
    await updateConversationEpisode(first.episode?.id, { summary: "我自己的摘要，不要动" });

    state.completeOnce.mockResolvedValueOnce(
      summaryJson({ title: "模型新标题", summary: "模型新摘要" }),
    );
    await ingestConversationMemory("s1", conversation());
    const list = await listConversationMemory();
    expect(list.episodes).toHaveLength(1);
    expect(list.episodes[0]?.summary).toBe("我自己的摘要，不要动");
    expect(list.episodes[0]?.edited).toBe(true);
  });
});

describe("事实提取与去重", () => {
  it("autoExtractFacts 关闭时只写摘要，factsAdded = 0", async () => {
    state.completeOnce.mockResolvedValue(
      summaryJson({ facts: [{ kind: "preference", text: "用户偏好 pnpm" }] }),
    );
    const result = await ingestConversationMemory("s1", conversation());
    expect(result.factsAdded).toBe(0);
    expect((await listConversationMemory()).facts).toEqual([]);
  });

  it("force（用户手动总结）时允许写 facts", async () => {
    state.completeOnce.mockResolvedValue(
      summaryJson({ facts: [{ kind: "project", text: "用户在开发 ATS 调度平台" }] }),
    );
    const result = await ingestConversationMemory("s1", conversation(), { force: true });
    expect(result.factsAdded).toBe(1);
    const facts = (await listConversationMemory()).facts;
    expect(facts[0]?.source).toBe("auto");
  });

  it("归一化完全相同与高度重合的事实都被跳过", async () => {
    writeSettings({ autoExtractFacts: true });
    writeJson("facts.json", [
      {
        id: "f1",
        kind: "preference",
        text: "用户偏好使用 pnpm 安装全局依赖",
        source: "user",
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    state.completeOnce.mockResolvedValue(
      summaryJson({
        facts: [
          // 仅标点不同：归一化后完全相同 → 跳过
          { kind: "preference", text: "用户偏好使用 pnpm 安装全局依赖。" },
          // 只多一个尾字：字符级重合度 ≥ 0.85 → 跳过
          { kind: "preference", text: "用户偏好使用 pnpm 安装全局依赖包" },
          // 全新信息 → 保留
          { kind: "project", text: "用户在开发 ATS 调度平台" },
        ],
      }),
    );
    const result = await ingestConversationMemory("s1", conversation());
    expect(result.factsAdded).toBe(1);
    const facts = (await listConversationMemory()).facts;
    expect(facts.map((item) => item.text)).toContain("用户在开发 ATS 调度平台");
    expect(facts).toHaveLength(2);
  });
});

describe("召回打分与提示词注入", () => {
  const episodes = [
    {
      id: "e-plain",
      sessionId: "s1",
      workspaceId: "w1",
      title: "ATS 调度排障",
      summary: "ATS 调度排障记录",
      keywords: [],
      messageCount: 4,
      pinned: false,
      edited: false,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "e-pinned",
      sessionId: "s2",
      workspaceId: "w1",
      title: "ATS 调度",
      summary: "ATS 调度",
      keywords: [],
      messageCount: 4,
      pinned: true,
      edited: false,
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: "e-unrelated",
      sessionId: "s3",
      workspaceId: "w1",
      title: "周报整理",
      summary: "整理本周工作周报",
      keywords: [],
      messageCount: 4,
      pinned: false,
      edited: false,
      createdAt: 3,
      updatedAt: 3,
    },
  ];

  const facts = [
    {
      id: "f-ats",
      kind: "project",
      text: "ATS 调度平台",
      source: "user",
      pinned: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  beforeEach(() => {
    writeJson("episodes.json", episodes);
    writeJson("facts.json", facts);
  });

  it("既有相关命中，也有 pinned 优先，且不相关内容不召回", async () => {
    const hits = await recallConversationMemory("ATS 调度", 3);
    expect(hits.map((hit) => hit.id)).not.toContain("e-unrelated");
    expect(hits[0]?.id).toBe("e-pinned");
    expect(hits.map((hit) => hit.id)).toContain("f-ats");
  });

  it("recall 关闭时 renderRecallBlock 返回 undefined", async () => {
    const block = await renderRecallBlock(
      { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS, enabled: true, recall: false },
      "ATS 调度",
    );
    expect(block).toBeUndefined();
  });

  it("无命中返回 undefined", async () => {
    const block = await renderRecallBlock(
      { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS, enabled: true, recall: true },
      "量子计算",
    );
    expect(block).toBeUndefined();
  });

  it("注入文本按 [- [对话记忆] / - [关于用户] 渲染，超长时截到 1200 字以内", async () => {
    const settings = { ...DEFAULT_CONVERSATION_MEMORY_SETTINGS, enabled: true, recall: true, topK: 3 };

    // 正常长度：对话记忆与关于用户两类都在
    const short = await renderRecallBlock(settings, "ATS 调度");
    expect(short).toContain("- [对话记忆]");
    expect(short).toContain("- [关于用户] ATS 调度平台");

    // 超长摘要：整块截断到上限，不会被整段塞进提示词
    writeJson("facts.json", []);
    writeJson("episodes.json", [
      { ...episodes[0], summary: "ATS 调度平台端口冲突排查。".repeat(120) },
    ]);
    const long = await renderRecallBlock(settings, "ATS 调度");
    expect(long).toBeTruthy();
    expect(long!.length).toBeLessThanOrEqual(1200);
    expect(long!).toContain("- [对话记忆]");
  });
});

describe("清空与自动摘要节流", () => {
  it("clear 只清 episodes/facts，device.json 与 user.json 保持原样", async () => {
    writeJson("device.json", { collectedAt: 1, notes: [{ id: "n1", text: "本机内存 36G" }] });
    writeJson("user.json", { notes: [{ id: "n2", text: "偏好中文回复" }] });
    writeJson("episodes.json", [
      {
        id: "e1",
        sessionId: "s1",
        workspaceId: "w1",
        title: "t",
        summary: "s",
        keywords: [],
        messageCount: 1,
        pinned: false,
        edited: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    writeJson("facts.json", [
      { id: "f1", kind: "note", text: "一条事实", source: "user", pinned: false, createdAt: 1, updatedAt: 1 },
    ]);
    const deviceBefore = readFileSync(file("device.json"), "utf8");
    const userBefore = readFileSync(file("user.json"), "utf8");

    const list = await clearConversationMemory();

    expect(list).toEqual({ episodes: [], facts: [] });
    expect(readFileSync(file("device.json"), "utf8")).toBe(deviceBefore);
    expect(readFileSync(file("user.json"), "utf8")).toBe(userBefore);
    expect(JSON.parse(readFileSync(file("episodes.json"), "utf8"))).toEqual([]);
  });

  it("autoSummarize 关闭时不触发，开启后 5 分钟内同一会话只跑一次", async () => {
    state.completeOnce.mockResolvedValue(summaryJson());
    const messages = conversation();

    // 默认关闭 → 不调用模型
    await maybeAutoIngest("s1", "w1", messages);
    expect(state.completeOnce).not.toHaveBeenCalled();

    writeSettings({ enabled: true, autoSummarize: true, model: { providerId: "p", modelId: "m" } });
    await maybeAutoIngest("s1", "w1", messages);
    await maybeAutoIngest("s1", "w1", messages);
    expect(state.completeOnce).toHaveBeenCalledTimes(1);

    // 另一个会话不受影响
    await maybeAutoIngest("s2", "w1", messages);
    expect(state.completeOnce).toHaveBeenCalledTimes(2);
  });

  it("消息数不足 8 条时自动摘要跳过", async () => {
    writeSettings({ enabled: true, autoSummarize: true });
    await maybeAutoIngest("s1", "w1", conversation().slice(0, 6));
    expect(state.completeOnce).not.toHaveBeenCalled();
  });

  it("自动摘要失败写 lastError 并广播（state 可见）", async () => {
    writeSettings({ enabled: true, autoSummarize: true, model: { providerId: "p", modelId: "m" } });
    state.completeOnce.mockRejectedValue(new Error("模型不可用"));
    await maybeAutoIngest("s1", "w1", conversation());
    const stateAfter = await readConversationMemoryState();
    expect(stateAfter.lastError).toBe("模型不可用");
  });

  it("upsertFact 手写事实标记 source=user 并支持 pin", async () => {
    const list = await upsertConversationFact({ text: "用户偏好中文回复", kind: "preference", pinned: true });
    expect(list.facts).toHaveLength(1);
    expect(list.facts[0]?.source).toBe("user");
    expect(list.facts[0]?.pinned).toBe(true);

    // 非法 kind 不写入
    const after = await upsertConversationFact({ text: "非法", kind: "unknown" });
    expect(after.facts).toHaveLength(1);
  });
});
