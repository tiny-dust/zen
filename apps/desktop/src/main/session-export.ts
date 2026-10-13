import type { ChatMessage, SessionRecord } from "@zen/shared";

/**
 * 会话分享导出：把会话渲染成自包含单文件 HTML（内联 CSS、深色 MiMo 风格）。
 * 纯函数模块——不碰 Electron / fs，模板与转义逻辑可单测；IPC 层只负责取数与落盘。
 */

/** HTML 转义：文本内容与属性值共用（引号一并转义） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Markdown-lite 渲染（导出用，不求全量语法）：
 * - ``` 围栏代码块 → <pre><code>（保留原样，只转义）；
 * - 行内 `code` → <code>；
 * - **bold** → <strong>；
 * - 空行分段，段内换行转 <br>；
 * - 链接不解析（避免导出文件外连追踪）。
 */
export function renderMarkdownLite(markdown: string): string {
  const segments = markdown.split(/```/);
  const out: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    let segment = segments[index] ?? "";
    // 围栏必须成对：未闭合的最后一个 ``` 之后按普通文本处理（还原分隔符本身）
    const isCode = index % 2 === 1 && index < segments.length - 1;
    if (index % 2 === 1 && !isCode) {
      segment = `\`\`\`${segment}`;
    }
    if (isCode) {
      // 代码段：剥掉围栏后首行的语言标注行（```ts → ts 单独一行）
      const lines = segment.replace(/^\r?\n/, "").split(/\r?\n/);
      const body =
        /^[A-Za-z0-9_+-]*$/.test(lines[0]?.trim() ?? " ") && lines.length > 1
          ? lines.slice(1).join("\n")
          : lines.join("\n");
      out.push(`<pre><code>${escapeHtml(body.replace(/\n$/, ""))}</code></pre>`);
      continue;
    }
    for (const paragraph of segment.split(/\r?\n\s*\r?\n/)) {
      const text = paragraph.trim();
      if (!text) {
        continue;
      }
      let html = escapeHtml(text)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/\r?\n/g, "<br>");
      out.push(`<p>${html}</p>`);
    }
  }
  return out.join("\n");
}

/** 时间戳 → 本地可读时间（供标题区与导出信息行） */
export function formatExportTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

interface ExportMessage {
  role: "user" | "assistant";
  html: string;
  attachments?: string[];
}

/** 消息筛选与归一：只导出 user / assistant 的有效内容；附件只留文件名提示 */
function toExportMessages(messages: ChatMessage[]): ExportMessage[] {
  const out: ExportMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const content = message.content?.trim();
    if (!content) {
      continue;
    }
    const meta = message.meta as { attachments?: Array<{ name?: string }> } | undefined;
    const attachments = Array.isArray(meta?.attachments)
      ? meta.attachments.map((item) => item?.name).filter((name): name is string => !!name)
      : undefined;
    out.push({
      role: message.role,
      html:
        message.role === "assistant"
          ? renderMarkdownLite(content)
          : escapeHtml(content).replace(/\r?\n/g, "<br>"),
      ...(attachments?.length ? { attachments } : {}),
    });
  }
  return out;
}

const EXPORT_CSS = [
  ":root{color-scheme:dark}",
  "body{margin:0;background:#141414;color:#d6d6d3;font:14px/1.7 -apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif}",
  ".wrap{max-width:860px;margin:0 auto;padding:40px 20px 64px}",
  ".head{padding:0 12px 20px;border-bottom:1px solid #262626;margin-bottom:24px}",
  ".head h1{margin:0 0 8px;font-size:20px;font-weight:600;color:#f2f2f0}",
  ".head .meta{font-size:12px;color:#8a8a87}",
  ".msg{display:flex;flex-direction:column;margin:18px 0}",
  ".msg .bubble{max-width:86%;padding:10px 14px;border-radius:12px;white-space:pre-wrap;word-break:break-word}",
  ".msg.user{align-items:flex-end}",
  ".msg.user .bubble{background:#2a2a2a;color:#f2f2f0}",
  ".msg.assistant .bubble{background:transparent;padding:2px 0;color:#d6d6d3;white-space:normal}",
  ".bubble p{margin:0 0 10px}.bubble p:last-child{margin-bottom:0}",
  ".bubble pre{background:#1d1d1d;border:1px solid #2a2a2a;border-radius:8px;padding:12px;overflow-x:auto;font:12.5px/1.6 ui-monospace,'SF Mono',Menlo,Consolas,monospace;white-space:pre}",
  ".bubble code{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:12.5px;background:#1d1d1d;border-radius:4px;padding:1px 5px}",
  ".bubble pre code{background:transparent;padding:0}",
  ".att{font-size:12px;color:#8a8a87;margin-top:6px}",
  ".footer{margin-top:48px;padding-top:16px;border-top:1px solid #262626;font-size:11px;color:#6a6a67;text-align:center}",
].join("");

/** 渲染整份导出 HTML（含 <!doctype>；自包含，浏览器直接打开） */
export function renderSessionHtml(input: {
  session: Pick<SessionRecord, "title" | "createdAt" | "updatedAt">;
  messages: ChatMessage[];
  /** 导出时间戳，缺省取调用时刻；测试可注入固定值 */
  exportedAt?: number;
}): string {
  const exportedAt = input.exportedAt ?? Date.now();
  const title = input.session.title?.trim() || "未命名会话";
  const exportMessages = toExportMessages(input.messages);
  const timeRange =
    exportMessages.length && input.session.updatedAt
      ? `${formatExportTime(input.session.createdAt)} — ${formatExportTime(input.session.updatedAt)}`
      : formatExportTime(input.session.createdAt);
  const body = exportMessages
    .map((message) => {
      const attachments = message.attachments?.length
        ? `<div class="att">${message.attachments
            .map((name) => `📎 ${escapeHtml(name)}`)
            .join("<br>")}</div>`
        : "";
      return [
        `<div class="msg ${message.role}">`,
        `  <div class="bubble">${message.html}</div>`,
        attachments,
        "</div>",
      ].join("\n");
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Zen">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${escapeHtml(timeRange)} · ${exportMessages.length} 条消息 · 由 Zen 导出</div>
  </header>
  <main>
${body || `<p class="bubble">（无消息）</p>`}
  </main>
  <footer class="footer">导出于 ${formatExportTime(exportedAt)}</footer>
</div>
</body>
</html>
`;
}
