import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import type { BrowserElementRef } from "@zen/shared";

import { useSessionDraft } from "@/composables/useSessionDraft";
import { parseSessionDraft } from "@/lib/session-draft";
import type { ComposerAttachment } from "@/stores/chat-types";

const setDraft = vi.fn(async (_id: string, _draft: string) => undefined);

beforeEach(() => {
  vi.useFakeTimers();
  setDraft.mockClear();
  vi.stubGlobal("zen", { session: { setDraft } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const elementRef = {
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
} as BrowserElementRef;

function setup(sessionIdValue = "s1") {
  const input = ref("");
  const attachments = ref<ComposerAttachment[]>([]);
  const elementMarks = ref<never[]>([]);
  const sessionId = ref(sessionIdValue);
  const { flushDraft } = useSessionDraft({ input, attachments, elementMarks }, sessionId);
  return { input, attachments, elementMarks, sessionId, flushDraft };
}

/** 断言落库载荷：解析 v=1 信封后与期望状态比对 */
function expectPersisted(payload: unknown, expected: { text: string; attachmentNames: string[]; markTokens: string[] }) {
  const parsed = parseSessionDraft(String(payload));
  expect(parsed.text).toBe(expected.text);
  expect(parsed.attachments.map((item) => item.name)).toEqual(expected.attachmentNames);
  expect(parsed.elementMarks.map((item) => item.token)).toEqual(expected.markTokens);
}

describe("useSessionDraft", () => {
  it("输入防抖 400ms 后落库", async () => {
    const { input } = setup();
    input.value = "草稿内容";
    await nextTick();
    vi.advanceTimersByTime(399);
    expect(setDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setDraft).toHaveBeenCalledTimes(1);
    expect(setDraft).toHaveBeenCalledWith("s1", expect.any(String));
    expectPersisted(setDraft.mock.calls[0][1], {
      text: "草稿内容",
      attachmentNames: [],
      markTokens: [],
    });
  });

  it("连续输入只落库最后一次（防抖合并）", async () => {
    const { input } = setup();
    input.value = "a";
    await nextTick();
    vi.advanceTimersByTime(200);
    input.value = "abc";
    await nextTick();
    vi.advanceTimersByTime(400);
    expect(setDraft).toHaveBeenCalledTimes(1);
    expectPersisted(setDraft.mock.calls[0][1], {
      text: "abc",
      attachmentNames: [],
      markTokens: [],
    });
  });

  it("载荷含附件与标注（不只是正文）", async () => {
    const { input, attachments, elementMarks, flushDraft } = setup();
    input.value = "正文 $a.png $el:登录";
    attachments.value = [
      { id: "a1", name: "a.png", path: "/u/a.png", size: 3, isImage: true },
    ];
    elementMarks.value = [
      { id: "be_1", label: "登录", token: "$el:登录", ref: elementRef },
    ] as never;
    flushDraft();
    expect(setDraft).toHaveBeenCalledTimes(1);
    expectPersisted(setDraft.mock.calls[0][1], {
      text: "正文 $a.png $el:登录",
      attachmentNames: ["a.png"],
      markTokens: ["$el:登录"],
    });
  });

  it("附件/标注变化也触发防抖落库", async () => {
    const { attachments } = setup();
    attachments.value.push({ id: "a1", name: "a.png", path: "/u/a.png", size: 3, isImage: true });
    await nextTick();
    vi.advanceTimersByTime(400);
    expect(setDraft).toHaveBeenCalledTimes(1);
    expectPersisted(setDraft.mock.calls[0][1], {
      text: "",
      attachmentNames: ["a.png"],
      markTokens: [],
    });
  });

  it("flushDraft 立即落库并取消待触发的定时器", async () => {
    const { input, flushDraft } = setup();
    input.value = "马上切会话";
    await nextTick();
    flushDraft();
    expect(setDraft).toHaveBeenCalledWith("s1", expect.any(String));
    vi.advanceTimersByTime(1000);
    // 定时器已取消，不会重复落库
    expect(setDraft).toHaveBeenCalledTimes(1);
  });

  it("flushDraft 无待落库时也会保存当前输入", () => {
    const { input, flushDraft } = setup();
    input.value = "直接保存";
    flushDraft();
    expect(setDraft).toHaveBeenCalledTimes(1);
    expectPersisted(setDraft.mock.calls[0][1], {
      text: "直接保存",
      attachmentNames: [],
      markTokens: [],
    });
  });

  it("空状态落空串（清掉旧草稿）", () => {
    const { flushDraft } = setup();
    flushDraft();
    expect(setDraft).toHaveBeenCalledWith("s1", "");
  });

  it("无 sessionId 不落库", async () => {
    const { input, flushDraft } = setup("");
    input.value = "孤儿草稿";
    await nextTick();
    vi.advanceTimersByTime(1000);
    flushDraft();
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("window.zen 缺失时不抛错", async () => {
    vi.unstubAllGlobals();
    const { input, flushDraft } = setup();
    input.value = "无桥";
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(() => flushDraft()).not.toThrow();
    expect(setDraft).not.toHaveBeenCalled();
  });
});
