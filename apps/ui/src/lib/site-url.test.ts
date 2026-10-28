import { describe, expect, it } from "vitest";

import { siteHost, siteInitial, siteKey, siteOrigin } from "@/lib/site-url";

/**
 * 站点 URL 归一：浏览器历史与网络来源共用。
 * 关键行为是「同一页面的不同写法算一条，不同页面仍是两条」。
 */
describe("site-url", () => {
  it("siteHost：小写、去 www；坏 URL 回退原串", () => {
    expect(siteHost("https://www.GitHub.com/a/b")).toBe("github.com");
    expect(siteHost("http://10.88.50.149:8080/x")).toBe("10.88.50.149:8080");
    expect(siteHost("not a url")).toBe("not a url");
    expect(siteHost("")).toBe("");
  });

  it("siteInitial：取主机名第一个字母/汉字，没有给 ?", () => {
    expect(siteInitial("https://www.zhihu.com/question/1")).toBe("Z");
    expect(siteInitial("https://知乎.com")).toBe("知");
    expect(siteInitial("https://123.example.com")).toBe("1");
    expect(siteInitial("")).toBe("?");
  });

  it("siteOrigin：只认 http(s)，宿主小写", () => {
    expect(siteOrigin("https://WWW.Example.com/a?b=1")).toBe("https://www.example.com");
    expect(siteOrigin("http://10.0.0.2:8080/a")).toBe("http://10.0.0.2:8080");
    expect(siteOrigin("file:///tmp/a.html")).toBe("");
    expect(siteOrigin("about:blank")).toBe("");
    expect(siteOrigin("")).toBe("");
  });

  it("siteKey：hash / 尾斜杠 / 大小写 / http(s) / www / 跟踪参数归并为同一键", () => {
    const base = siteKey("https://example.com/a/b");
    expect(siteKey("https://example.com/a/b/")).toBe(base);
    expect(siteKey("https://example.com/a/b#section")).toBe(base);
    expect(siteKey("http://WWW.Example.com/a/b")).toBe(base);
    expect(siteKey("https://example.com/a/b?utm_source=x&utm_medium=y")).toBe(base);
    expect(siteKey("https://example.com/a/b?fbclid=abc")).toBe(base);
  });

  it("siteKey：不同路径 / 有意义的查询参数仍是不同条目（查询顺序不影响）", () => {
    expect(siteKey("https://example.com/a")).not.toBe(siteKey("https://example.com/b"));
    expect(siteKey("https://example.com/s?q=1&page=2")).toBe(
      siteKey("https://example.com/s?page=2&q=1"),
    );
    expect(siteKey("https://example.com/s?q=1")).not.toBe(siteKey("https://example.com/s?q=2"));
  });

  it("siteKey：非 http(s) 按原串小写（文件路径等不做路径归一）", () => {
    expect(siteKey("File:///tmp/A.txt")).toBe("file:///tmp/a.txt");
    expect(siteKey("")).toBe("");
  });
});
