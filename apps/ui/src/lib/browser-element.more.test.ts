import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserElementRef } from "@zen/shared";

import {
  ELEMENT_TOKEN_RE,
  createElementMark,
  elementLabel,
  expandBrowserElementTokens,
  formatElementDetail,
  formatElementForPrompt,
  openAppLink,
} from "@/lib/browser-element";
import { useRightPanelStore } from "@/stores/right-panel";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn(async () => undefined) }));

vi.mock("@/stores/browser", () => ({
  useBrowserStore: () => ({ openUrl }),
}));

function refOf(partial: Partial<BrowserElementRef>): BrowserElementRef {
  return {
    selector: "#x",
    selectorCandidates: ["#x"],
    tag: "div",
    id: "",
    className: "",
    text: "",
    name: "",
    type: "",
    placeholder: "",
    ariaLabel: "",
    role: "",
    href: "",
    rect: { x: 1, y: 2, width: 3, height: 4 },
    pageUrl: "https://example.com/",
    pageTitle: "Example",
    ...partial,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  openUrl.mockClear();
});

describe("elementLabel 兜底", () => {
  it("文本过长截断，空文本依次回落 aria/placeholder/id/tag", () => {
    expect(elementLabel(refOf({ text: "0123456789abcdefghij" }))).toBe("0123456789abcdef…");
    expect(elementLabel(refOf({ ariaLabel: "搜索框" }))).toBe("搜索框");
    expect(elementLabel(refOf({ placeholder: "请输入" }))).toBe("请输入");
    expect(elementLabel(refOf({ id: "login" }))).toBe("#login");
    expect(elementLabel(refOf({ tag: "button" }))).toBe("button");
    expect(elementLabel(refOf({ tag: "" }))).toBe("元素");
    // 空白文本视为无
    expect(elementLabel(refOf({ text: "   ", id: "a" }))).toBe("#a");
  });

  it("createElementMark 对重名标签从 2 起递增", () => {
    const used = new Set(["登录", "登录2"]);
    const mark = createElementMark(refOf({ text: "登录" }), 3, used);
    expect(mark.token).toBe("$el:登录3");
    expect(mark.id).toBe("be_3");
  });
});

describe("formatElementForPrompt / formatElementDetail 可选字段", () => {
  it("字段缺失时省略对应段落", () => {
    const minimal = refOf({});
    const prompt = formatElementForPrompt(minimal);
    expect(prompt).toContain("selector=`#x`");
    expect(prompt).toContain("rect=3x4@(1,2)");
    expect(prompt).not.toContain("id=");
    expect(prompt).not.toContain("text=");
    expect(prompt).not.toContain("aria-label=");
    expect(prompt).not.toContain("placeholder=");
    expect(prompt).not.toContain("role=");

    const detail = formatElementDetail(minimal);
    expect(detail).toContain("选择器：#x");
    expect(detail).not.toContain("文本：");
    expect(detail).not.toContain("name：");
    expect(detail).toContain("位置：3×4 @ (1, 2)");
  });

  it("字段齐全时逐项输出", () => {
    const full = refOf({
      id: "a",
      text: "t",
      ariaLabel: "al",
      placeholder: "ph",
      name: "n",
      role: "r",
    });
    const prompt = formatElementForPrompt(full);
    for (const bit of ["id=a", 'text="t"', 'aria-label="al"', 'placeholder="ph"', "role=r"]) {
      expect(prompt).toContain(bit);
    }
    const detail = formatElementDetail(full);
    for (const line of ["文本：t", "aria-label：al", "placeholder：ph", "name：n", "role：r"]) {
      expect(detail).toContain(line);
    }
  });
});

describe("expandBrowserElementTokens / ELEMENT_TOKEN_RE", () => {
  it("无标注或正文不含 token 时原样返回", () => {
    const mark = createElementMark(refOf({ text: "登录" }), 1, new Set());
    expect(expandBrowserElementTokens("没有 token", [])).toBe("没有 token");
    expect(expandBrowserElementTokens("没有 token", [mark])).toBe("没有 token");
  });

  it("正则匹配 $el: token", () => {
    const found = "请点 $el:登录 和 $el:提交".match(ELEMENT_TOKEN_RE);
    expect(found).toEqual(["$el:登录", "$el:提交"]);
  });
});

describe("openAppLink", () => {
  it("打开右栏浏览器 tab 并导航", async () => {
    await openAppLink("https://example.com/next");
    const right = useRightPanelStore();
    expect(right.hasKind("browser")).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/next");
  });
});
