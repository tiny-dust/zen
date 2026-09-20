import { describe, expect, it } from "vitest";

import {
  createElementMark,
  elementLabel,
  elementToken,
  expandBrowserElementTokens,
  formatElementDetail,
  formatElementForPrompt,
} from "@/lib/browser-element";

import type { BrowserElementRef } from "@zen/shared";

const ref: BrowserElementRef = {
  selector: "#login",
  selectorCandidates: ["#login"],
  tag: "button",
  id: "login",
  className: "btn primary",
  text: "登录",
  name: "",
  type: "submit",
  placeholder: "",
  ariaLabel: "登录按钮",
  role: "button",
  href: "",
  rect: { x: 10, y: 20, width: 80, height: 32 },
  pageUrl: "https://example.com/",
  pageTitle: "Example",
};

describe("browser element chips", () => {
  it("builds short label and token", () => {
    expect(elementLabel(ref)).toBe("登录");
    const mark = createElementMark(ref, 1, new Set());
    expect(mark.token).toBe("$el:登录");
    expect(elementToken(mark.label)).toBe(mark.token);
  });

  it("uniquifies duplicate labels", () => {
    const a = createElementMark(ref, 1, new Set());
    const used = new Set([a.label]);
    const b = createElementMark(ref, 2, used);
    expect(b.token).toBe("$el:登录2");
  });

  it("expands tokens for agent payload", () => {
    const mark = createElementMark(ref, 2, new Set());
    const text = `请点一下 ${mark.token} 谢谢`;
    const expanded = expandBrowserElementTokens(text, [mark]);
    expect(expanded).toContain("selector=`#login`");
    expect(expanded).toContain('text="登录"');
    expect(expanded).not.toContain(mark.token);
  });

  it("formats detail for tooltip", () => {
    const detail = formatElementDetail(ref);
    expect(detail).toContain("#login");
    expect(detail).toContain("https://example.com/");
    expect(formatElementForPrompt(ref)).toContain("[页面元素]");
  });
});
