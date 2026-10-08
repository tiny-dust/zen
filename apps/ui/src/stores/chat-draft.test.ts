// 复现/回归：切换会话时 composer 草稿（正文 + 附件 + 浏览器标注）不能丢失。
// zen.session.setDraft 的内存镜像模拟 chat_sessions.draft 列；未持久化会话 UPDATE 0 行。
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserElementRef, SessionRecord } from "@zen/shared";

import { parseSessionDraft, serializeSessionDraft } from "@/lib/session-draft";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";

const elementRef: BrowserElementRef = {
  selector: "#login",
  selectorCandidates: ["#login"],
  tag: "button",
  id: "login",
  className: "btn",
  text: "登录",
  name: "",
  type: "submit",
  placeholder: "",
  ariaLabel: "",
  role: "button",
  href: "",
  rect: { x: 0, y: 0, width: 10, height: 10 },
  pageUrl: "https://example.com/",
  pageTitle: "Example",
};

const draftDb = new Map<string, string>();
const persistedIds = new Set<string>();

function recordOf(id: string, draft: string): SessionRecord {
  return {
    id,
    title: id === "s-b" ? "会话 B" : "会话 A",
    workspaceId: null,
    draft,
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 2,
  };
}

function stubZen() {
  vi.stubGlobal("zen", {
    app: { info: vi.fn().mockResolvedValue({}) },
    agent: {
      onEvent: vi.fn(() => () => undefined),
      run: vi.fn().mockResolvedValue({ ok: true }),
      getSettings: vi.fn().mockResolvedValue({}),
      promptPresets: vi.fn().mockResolvedValue([]),
      listSkills: vi.fn().mockResolvedValue([]),
      sandboxDir: vi.fn().mockResolvedValue(""),
    },
    session: {
      create: vi.fn(async (_workspaceId: string | null, id?: string) => {
        const target = id ?? "created";
        persistedIds.add(target);
        return recordOf(target, draftDb.get(target) ?? "");
      }),
      open: vi.fn(async (id: string) => ({
        session: recordOf(id, draftDb.get(id) ?? ""),
        messages: [],
      })),
      // 仅已存在会话行的 UPDATE 才生效：未持久化会话打到 0 行，草稿静默丢
      setDraft: vi.fn(async (id: string, draft: string) => {
        if (persistedIds.has(id)) {
          draftDb.set(id, draft);
        }
      }),
      rename: vi.fn(),
      setWorkspace: vi.fn(),
    },
    workspace: {
      list: vi.fn().mockResolvedValue([
        {
          id: "common",
          name: "公共区",
          kind: "common",
          path: null,
          archived: false,
          pinned: false,
          sessions: [],
        },
      ]),
    },
    git: {
      info: vi.fn().mockResolvedValue({ repo: "", branch: "" }),
      status: vi.fn().mockResolvedValue(null),
    },
  });
}

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  localStorage.clear();
  draftDb.clear();
  persistedIds.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  stubZen();
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
});

function fillComposer(chat: ReturnType<typeof useChatStore>) {
  chat.input = "草稿正文 $el:登录";
  chat.addAttachment(new File(["x"], "a.png", { type: "image/png" }), "/u/a.png");
  chat.insertBrowserElement(elementRef);
}

function composerSnapshot(chat: ReturnType<typeof useChatStore>) {
  return {
    text: chat.input,
    attachments: chat.attachments.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      size: item.size,
      isImage: item.isImage,
    })),
    elementMarks: chat.elementMarks.map((item) => ({
      id: item.id,
      label: item.label,
      token: item.token,
      ref: item.ref,
    })),
  };
}

describe("切换会话的 composer 草稿恢复", () => {
  it("已持久化会话：正文 + 附件 + 浏览器标注切走切回完整恢复", async () => {
    const chat = useChatStore();
    const s0 = chat.sessionId;
    persistedIds.add(s0);
    fillComposer(chat);
    const before = composerSnapshot(chat);

    await chat.loadSession(recordOf("s-b", ""));
    // 切到 B 不带 A 的任何 composer 状态（防串台）
    expect(chat.input).toBe("");
    expect(chat.attachments).toEqual([]);
    expect(chat.elementMarks).toEqual([]);

    await chat.loadSession(recordOf(s0, draftDb.get(s0) ?? ""));
    // 切回 A：三项状态完整恢复
    expect(composerSnapshot(chat)).toEqual(before);
  });

  it("落库载荷携带附件与标注（不只是正文）", async () => {
    const chat = useChatStore();
    const s0 = chat.sessionId;
    persistedIds.add(s0);
    fillComposer(chat);

    await chat.loadSession(recordOf("s-b", ""));
    const setDraft = vi.mocked(window.zen!.session.setDraft!);
    const saved = setDraft.mock.calls.filter(([id]) => id === s0);
    expect(saved.length).toBeGreaterThan(0);
    const parsed = parseSessionDraft(String(saved[saved.length - 1][1]));
    expect(parsed.text).toContain("草稿正文");
    expect(parsed.attachments.map((item) => item.name)).toEqual(["a.png"]);
    expect(parsed.elementMarks.map((item) => item.token)).toEqual(["$el:登录"]);
  });

  it("未持久化会话：内存暂存兜底，切走切回草稿不丢", async () => {
    const chat = useChatStore();
    const s0 = chat.sessionId;
    // 不 add 到 persistedIds：setDraft 打到 UPDATE 0 行
    fillComposer(chat);
    const before = composerSnapshot(chat);

    await chat.loadSession(recordOf("s-b", ""));
    expect(chat.input).toBe("");

    await chat.loadSession(recordOf(s0, ""));
    expect(composerSnapshot(chat)).toEqual(before);
  });

  it("发送后清空的语义不变：切走切回仍为空", async () => {
    const chat = useChatStore();
    const s0 = chat.sessionId;
    persistedIds.add(s0);
    useModelsStore().selection = { providerId: "p", modelId: "m" };
    fillComposer(chat);

    await chat.send();
    expect(chat.input).toBe("");
    expect(chat.attachments).toEqual([]);
    expect(chat.elementMarks).toEqual([]);

    await chat.loadSession(recordOf("s-b", ""));
    await chat.loadSession(recordOf(s0, draftDb.get(s0) ?? ""));
    expect(chat.input).toBe("");
    expect(chat.attachments).toEqual([]);
    expect(chat.elementMarks).toEqual([]);
  });

  it("newTask 切走：composer 清空（含标注）且旧会话草稿可恢复", async () => {
    const chat = useChatStore();
    const s0 = chat.sessionId;
    persistedIds.add(s0);
    fillComposer(chat);
    const before = composerSnapshot(chat);

    await chat.newTask();
    expect(chat.input).toBe("");
    expect(chat.attachments).toEqual([]);
    expect(chat.elementMarks).toEqual([]);

    await chat.loadSession(recordOf(s0, draftDb.get(s0) ?? ""));
    expect(composerSnapshot(chat)).toEqual(before);
  });

  it("快速连续切换不写串：旧内容只写到旧会话 id，最终停在后点的会话", async () => {
    const chat = useChatStore();
    const s0 = chat.sessionId;
    chat.input = "内容X";
    // B 的库内草稿（open 从 draftDb 读列值）
    draftDb.set("s-b", serializeSessionDraft({ text: "B 的草稿", attachments: [], elementMarks: [] }));

    void chat.loadSession(recordOf("s-a", ""));
    await chat.loadSession(recordOf("s-b", draftDb.get("s-b") ?? ""));

    expect(chat.sessionId).toBe("s-b");
    expect(chat.input).toBe("B 的草稿");
    const setDraft = vi.mocked(window.zen!.session.setDraft!);
    for (const [id, payload] of setDraft.mock.calls as Array<[string, string]>) {
      if (typeof payload === "string" && payload.includes("内容X")) {
        expect(id).toBe(s0);
      }
    }
  });
});
