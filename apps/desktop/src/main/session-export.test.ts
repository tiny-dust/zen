import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@zen/shared";

import { escapeHtml, renderMarkdownLite, renderSessionHtml } from "./session-export";

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
  meta?: Record<string, unknown>,
): ChatMessage {
  return { id, role, content, createdAt: 1, ...(meta ? { meta } : {}) };
}

describe("escapeHtml", () => {
  it("转义五个危险字符", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("普通文本原样保留", () => {
    expect(escapeHtml("hello 世界 123")).toBe("hello 世界 123");
  });
});

describe("renderMarkdownLite", () => {
  it("围栏代码块渲染为 pre/code，剥掉语言标注行并转义内容", () => {
    const html = renderMarkdownLite("看下这段：\n```ts\nconst a = \"<b>\";\n```\n完成");
    expect(html).toContain("<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>");
    expect(html).not.toContain("```");
    expect(html).not.toContain("ts\n");
  });

  it("空行分段、段内换行转 br、行内 code 与 bold 生效", () => {
    const html = renderMarkdownLite("第一段**重点**\n第二行\n\n第二段 `inline`");
    expect(html).toContain("<p>第一段<strong>重点</strong><br>第二行</p>");
    expect(html).toContain("<p>第二段 <code>inline</code></p>");
  });

  it("未闭合围栏按普通文本处理", () => {
    const html = renderMarkdownLite("只有一个 ``` 开头");
    // 围栏符还原为普通文本，不进入 pre/code
    expect(html).toContain("<p>``` 开头</p>");
    expect(html).not.toContain("<pre>");
  });
});

describe("renderSessionHtml", () => {
  const session = {
    id: "s1",
    title: '导出 <测试> "会话"',
    workspaceId: null,
    draft: "",
    pinned: false,
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
  };

  it("渲染标题（转义）、时间与 user/assistant 气泡区分", () => {
    const html = renderSessionHtml({
      session,
      messages: [
        message("m1", "user", "你好 <script>alert(1)</script>"),
        message("m2", "assistant", "回答**要点**\n\n```js\nconsole.log(1);\n```"),
        message("m3", "tool", "工具消息不导出"),
        message("m4", "system", ""),
      ],
      exportedAt: 1_700_000_200_000,
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>导出 &lt;测试&gt; &quot;会话&quot;</title>");
    expect(html).toContain('class="msg user"');
    expect(html).toContain('class="msg assistant"');
    // user 内容转义，脚本不注入
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // assistant markdown 生效
    expect(html).toContain("<strong>要点</strong>");
    expect(html).toContain("<pre><code>console.log(1);</code></pre>");
    // tool/system 消息与计数不出现
    expect(html).not.toContain("工具消息不导出");
    expect(html).toContain("2 条消息");
    expect(html).toContain("<style>");
  });

  it("用户附件只渲染文件名提示", () => {
    const html = renderSessionHtml({
      session,
      messages: [
        message("m1", "user", "看这张图", {
          attachments: [{ name: "截图.png", path: "/tmp/a.png" }, { name: "logo.jpg" }],
        }),
      ],
    });
    expect(html).toContain("截图.png");
    expect(html).toContain("logo.jpg");
    expect(html).not.toContain("/tmp/a.png");
  });

  it("无消息时渲染空态占位", () => {
    const html = renderSessionHtml({ session, messages: [] });
    expect(html).toContain("（无消息）");
    expect(html).toContain("0 条消息");
  });
});
