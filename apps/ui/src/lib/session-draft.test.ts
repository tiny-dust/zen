import { describe, expect, it } from "vitest";

import type { BrowserElementRef } from "@zen/shared";

import { parseSessionDraft, serializeSessionDraft } from "@/lib/session-draft";

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

const fullState = () => ({
  text: "草稿正文",
  attachments: [{ id: "a1", name: "a.png", path: "/u/a.png", size: 3, isImage: true }],
  elementMarks: [{ id: "be_1", label: "登录", token: "$el:登录", ref: elementRef }],
});

describe("serializeSessionDraft / parseSessionDraft", () => {
  it("空状态序列化为空串", () => {
    expect(serializeSessionDraft({ text: "", attachments: [], elementMarks: [] })).toBe("");
  });

  it("完整状态（正文+附件+标注）往返一致", () => {
    const state = fullState();
    const restored = parseSessionDraft(serializeSessionDraft(state));
    expect(restored).toEqual(state);
  });

  it("空状态解析为空草稿", () => {
    expect(parseSessionDraft("")).toEqual({ text: "", attachments: [], elementMarks: [] });
    expect(parseSessionDraft(null)).toEqual({ text: "", attachments: [], elementMarks: [] });
    expect(parseSessionDraft(undefined)).toEqual({ text: "", attachments: [], elementMarks: [] });
  });

  it("旧版纯文本 draft 恢复成正文（旧数据兼容）", () => {
    expect(parseSessionDraft("旧的纯文本草稿")).toEqual({
      text: "旧的纯文本草稿",
      attachments: [],
      elementMarks: [],
    });
  });

  it("损坏的 JSON draft 按纯文本恢复，不抛错", () => {
    expect(parseSessionDraft('{"v":1,"text":"坏数据"')).toEqual({
      text: '{"v":1,"text":"坏数据"',
      attachments: [],
      elementMarks: [],
    });
  });

  it("非信封 JSON 与脏数组条目安全降级", () => {
    expect(parseSessionDraft('{"foo":1}')).toEqual({
      text: '{"foo":1}',
      attachments: [],
      elementMarks: [],
    });
    const restored = parseSessionDraft(
      JSON.stringify({
        v: 1,
        text: "正文",
        attachments: [null, 1, { name: "ok.txt", path: "/u/ok.txt", id: "a", size: 1, isImage: false }],
        elementMarks: [null, "x", { token: "$el:t", label: "t", id: "be_1", ref: elementRef }],
      }),
    );
    expect(restored.text).toBe("正文");
    expect(restored.attachments.map((item) => item.name)).toEqual(["ok.txt"]);
    expect(restored.elementMarks.map((item) => item.token)).toEqual(["$el:t"]);
  });
});
