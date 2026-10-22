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

  it("route / domPath / sourceFiles 出现在 prompt 与 tooltip 明细", () => {
    const full: BrowserElementRef = {
      ...ref,
      route: "/login#form",
      domPath: "body > div.app > button.btn.primary",
      sourceFiles: ["src/views/Login.vue", "src/components/LoginCard.vue"],
    };
    const prompt = formatElementForPrompt(full);
    expect(prompt).toContain("route=/login#form");
    expect(prompt).toContain("domPath=`body > div.app > button.btn.primary`");
    expect(prompt).toContain("file=src/views/Login.vue,src/components/LoginCard.vue");
    expect(prompt).toContain("selector失效时可用domPath兜底");
    expect(prompt).toContain("file为工作区源码文件可直接打开");
    const detail = formatElementDetail(full);
    expect(detail).toContain("路由：/login#form");
    expect(detail).toContain("DOM 层级：body > div.app > button.btn.primary");
    expect(detail).toContain("源码文件：src/views/Login.vue，src/components/LoginCard.vue");
    // 旧 ref（无新字段）不输出对应段落与扩展提示
    const legacy = formatElementForPrompt(ref);
    expect(legacy).not.toContain("route=");
    expect(legacy).not.toContain("domPath=");
    expect(legacy).not.toContain("file=");
    expect(legacy).not.toContain("domPath兜底");
    expect(legacy).not.toContain("源码文件");
  });
});
