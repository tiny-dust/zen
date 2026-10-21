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

  it("标题渲染为 h1-h4", () => {
    const html = renderMarkdownLite("# 一级\n\n## 二级\n\n### 三级\n\n#### 四级");
    expect(html).toContain("<h1>一级</h1>");
    expect(html).toContain("<h2>二级</h2>");
    expect(html).toContain("<h3>三级</h3>");
    expect(html).toContain("<h4>四级</h4>");
  });

  it("无序与有序列表渲染为 ul/ol", () => {
    const html = renderMarkdownLite("- 甲\n- 乙\n\n1. 第一\n2. 第二");
    expect(html).toContain("<ul><li>甲</li><li>乙</li></ul>");
    expect(html).toContain("<ol><li>第一</li><li>第二</li></ol>");
  });

  it("引用块连续行合并为 blockquote，段内换行转 br", () => {
    const html = renderMarkdownLite("> 引用一\n> 引用二\n\n正文");
    expect(html).toContain("<blockquote>引用一<br>引用二</blockquote>");
    expect(html).toContain("<p>正文</p>");
  });

  it("表格渲染为 thead/tbody，首尾包裹竖线剥掉", () => {
    const html = renderMarkdownLite("| 项 | 值 |\n| --- | --- |\n| 甲 | **1** |\n| 乙 | 2 |");
    expect(html).toContain("<thead><tr><th>项</th><th>值</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>甲</td><td><strong>1</strong></td></tr><tr><td>乙</td><td>2</td></tr></tbody>");
  });

  it("分隔线渲染为 hr", () => {
    const html = renderMarkdownLite("上文\n\n---\n\n下文");
    expect(html).toContain("<hr>");
    expect(html).toContain("<p>上文</p>");
    expect(html).toContain("<p>下文</p>");
  });

  it("普通竖线文本不误判为表格", () => {
    const html = renderMarkdownLite("a | b 没有 | 分隔行");
    expect(html).toContain("<p>a | b 没有 | 分隔行</p>");
    expect(html).not.toContain("<table>");
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

  it("样式内嵌与应用消息列表一致的 MiMo 暗色 token", () => {
    const html = renderSessionHtml({ session, messages: [] });
    // 与 styles.css .dark 同值的关键 token
    expect(html).toContain("--color-main-bg:#181818");
    expect(html).toContain("--color-txt-strong:#fff");
    expect(html).toContain("--color-side-sel:#ffffff1f");
    expect(html).toContain("--color-code-bg:#2e2e2e");
    // 消息列与气泡几何
    expect(html).toContain("max-width:860px");
    expect(html).toContain("max-width:min(760px,85%)");
    expect(html).toContain("border-radius:16px");
    // 助手正文走 .md-content
    expect(html).toContain(".md-content{font-size:14px;line-height:1.8");
  });

  it("消息底部渲染与应用同规则的时间行：同一天只显示时分，更早的带月日", () => {
    const html = renderSessionHtml({
      session,
      messages: [
        { ...message("m1", "user", "今天"), createdAt: 1_700_000_100_000 },
        { ...message("m2", "assistant", "回复"), createdAt: 1_700_000_140_000 },
        { ...message("m3", "user", "更早"), createdAt: 1_690_000_000_000 },
      ],
      exportedAt: 1_700_000_200_000,
    });
    expect(html).toContain('class="msg-meta"');
    // 同日：仅时分（2023-11-15 06:16 前后，本地时区下与导出时刻同日）
    const today = new Date(1_700_000_100_000);
    const hm = `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;
    expect(html).toContain(`<time datetime="${new Date(1_700_000_100_000).toISOString()}">${hm}</time>`);
    // 更早：带月日
    const older = new Date(1_690_000_000_000);
    expect(html).toContain(
      `${older.getMonth() + 1}月${older.getDate()}日 ${String(older.getHours()).padStart(2, "0")}:${String(older.getMinutes()).padStart(2, "0")}`,
    );
  });

  it("用户附件只渲染文件名 chip，不落盘路径", () => {
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
    // 附件 chip 在气泡内、链接色样式
    expect(html).toContain('class="att-item"');
    expect(html).toContain("--color-link");
  });

  it("无消息时渲染空态占位", () => {
    const html = renderSessionHtml({ session, messages: [] });
    expect(html).toContain("（无消息）");
    expect(html).toContain("0 条消息");
  });
});
