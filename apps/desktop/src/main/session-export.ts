import type { ChatMessage, SessionRecord } from "@zen/shared";

/**
 * 会话分享导出：把会话渲染成自包含单文件 HTML（内联 CSS，浏览器直接打开）。
 * 样式与 app 内消息列表完全一致：内嵌 styles.css `.dark` 的同一套 MiMo token，
 * DOM 结构与 ChatTimeline / MessageBubble 一一对应——860px 时间线列、16px 消息间距、
 * 用户右侧弱气泡（min(760px,85%) + 圆角 16px）、助手全宽 .md-content 排版、
 * 消息底部 11px 弱色时间行、附件链接色 chip。
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

/** 行内元素：转义后套行内 code 与粗体（与应用内 markdown 行内规则对齐） */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

const HR_RE = /^([-*_])\s*(?:\1\s*){2,}$/;
const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const UL_ITEM_RE = /^[-*]\s+(.*)$/;
const OL_ITEM_RE = /^\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;

/** GFM 表格分隔行：`| --- | :---: |`（至少含 - 与 |） */
function isTableDelimiter(line: string | undefined): boolean {
  if (!line) {
    return false;
  }
  const trimmed = line.trim();
  return (
    trimmed.includes("-") &&
    trimmed.includes("|") &&
    /^\|?[\s:|-]+\|?$/.test(trimmed)
  );
}

/** 按竖线切单元格；剥掉整行首尾因 `|` 包裹产生的空单元格 */
function splitTableRow(line: string): string[] {
  let cells = line.split("|").map((cell) => cell.trim());
  if (cells[0] === "") {
    cells = cells.slice(1);
  }
  if (cells.length > 0 && cells[cells.length - 1] === "") {
    cells = cells.slice(0, -1);
  }
  return cells;
}

/** 行首块元素判断：段落收集在这些行前停下（表格需结合下一行分隔行判定） */
function isBlockStart(line: string, nextLine: string | undefined): boolean {
  const trimmed = line.trim();
  if (
    HR_RE.test(trimmed) ||
    HEADING_RE.test(trimmed) ||
    UL_ITEM_RE.test(trimmed) ||
    OL_ITEM_RE.test(trimmed) ||
    QUOTE_RE.test(trimmed)
  ) {
    return true;
  }
  return trimmed.includes("|") && isTableDelimiter(nextLine);
}

/** 普通文本段 → 块级 markdown（标题/列表/引用/表格/分隔线/段落），样式交给 .md-content */
function renderTextSegment(segment: string): string {
  const lines = segment.split(/\r?\n/);
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (HR_RE.test(trimmed)) {
      out.push("<hr>");
      index += 1;
      continue;
    }
    const heading = HEADING_RE.exec(trimmed);
    if (heading?.[1] && heading[2] !== undefined) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }
    if (trimmed.includes("|") && isTableDelimiter(lines[index + 1])) {
      const header = splitTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const row = (lines[index] ?? "").trim();
        if (!row || !row.includes("|")) {
          break;
        }
        rows.push(splitTableRow(row));
        index += 1;
      }
      const thead = `<thead><tr>${header
        .map((cell) => `<th>${renderInline(cell)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody>`
        : "";
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    if (UL_ITEM_RE.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = UL_ITEM_RE.exec((lines[index] ?? "").trim());
        if (!match) {
          break;
        }
        items.push(`<li>${renderInline(match[1] ?? "")}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (OL_ITEM_RE.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = OL_ITEM_RE.exec((lines[index] ?? "").trim());
        if (!match) {
          break;
        }
        items.push(`<li>${renderInline(match[1] ?? "")}</li>`);
        index += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (QUOTE_RE.test(trimmed)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE_RE.exec((lines[index] ?? "").trim());
        if (!match) {
          break;
        }
        quoted.push(renderInline(match[1] ?? ""));
        index += 1;
      }
      out.push(`<blockquote>${quoted.join("<br>")}</blockquote>`);
      continue;
    }
    // 段落：收集到空行或块元素起点；段内换行转 <br>
    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] ?? "").trim();
      if (!next || isBlockStart(next, (lines[index + 1] ?? "").trim())) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    out.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/**
 * Markdown-lite 渲染（导出用，不求全量语法）：
 * - ``` 围栏代码块 → <pre><code>（保留原样，只转义）；
 * - 标题 / 无序有序列表 / 引用 / 表格 / 分隔线 / 段落；
 * - 行内 `code` 与 **bold**；
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
    out.push(renderTextSegment(segment));
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

/** 消息时间行：与应用内 MessageBubble.formatTime 同规则——同一天只显示时分，更早的带月日 */
function formatMessageTime(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return date.toDateString() === new Date(now).toDateString()
    ? hm
    : `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

interface ExportMessage {
  role: "user" | "assistant";
  /** user：转义原文（气泡内 pre-wrap 原样展示）；assistant：markdown 渲染结果 */
  body: string;
  createdAt: number;
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
      body: message.role === "assistant" ? renderMarkdownLite(content) : escapeHtml(content),
      createdAt: message.createdAt,
      ...(attachments?.length ? { attachments } : {}),
    });
  }
  return out;
}

/** 附件 chip：与应用内气泡附件行同构（12px 链接色、12px 列间距） */
function attachmentHtml(names: string[]): string {
  return `<div class="att">${names
    .map((name) => `<span class="att-item">📎 ${escapeHtml(name)}</span>`)
    .join("")}</div>`;
}

/**
 * 导出样式：与应用 styles.css 的 `.dark` token 和消息列表规则一一对应。
 * 消息列 860px、间距 16px；用户气泡 = MessageBubble（min(760px,85%)、
 * 圆角 16px、--color-side-sel 底）；助手正文 = .md-content 全套排版。
 */
const EXPORT_CSS = [
  ":root{color-scheme:dark;",
  "--color-main-bg:#181818;--color-txt:#f4f4f5;--color-txt-strong:#fff;--color-mut:#b8b8b8;--color-dim:#8a8a8a;",
  "--color-line:#2e2e2e;--color-line-strong:#2e2e2e;--color-side-sel:#ffffff1f;--color-chip-bg:#ffffff14;",
  "--color-link:#3295fb;--color-code-bg:#2e2e2e;--color-code-fg:#e6e6e6;--color-selection:#33518a;",
  "--color-scrollbar-thumb:#ffffff2e;--color-scrollbar-thumb-hover:#ffffff4d;",
  '--font-sans:"MiSans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Micro Hei",Inter,sans-serif;',
  '--font-mono:"Maple Mono","SF Mono",ui-monospace,Menlo,"Cascadia Mono",Consolas,"DejaVu Sans Mono","Noto Sans Mono","Liberation Mono","PingFang SC","Microsoft YaHei","Noto Sans Mono CJK SC",monospace}',
  "html,body{margin:0;padding:0}",
  "body{background:var(--color-main-bg);color:var(--color-txt);font:14px/1.5 var(--font-sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}",
  "::selection{background:var(--color-selection)}",
  "*::-webkit-scrollbar{width:10px;height:10px}",
  "*::-webkit-scrollbar-thumb{background:var(--color-scrollbar-thumb);border-radius:999px;border:2px solid transparent;background-clip:content-box}",
  "*::-webkit-scrollbar-thumb:hover{background:var(--color-scrollbar-thumb-hover);background-clip:content-box}",
  "*::-webkit-scrollbar-track{background:transparent}",
  ".wrap{max-width:860px;margin:0 auto;padding:24px 16px 64px}",
  ".head{padding:0 4px 16px;border-bottom:1px solid var(--color-line);margin-bottom:16px}",
  ".head h1{margin:0 0 8px;font-size:16px;font-weight:600;line-height:1.4;color:var(--color-txt-strong)}",
  ".head .meta{font-size:12px;color:var(--color-mut)}",
  ".timeline{display:flex;flex-direction:column;gap:16px}",
  ".msg{min-width:0}",
  ".msg-body{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%}",
  ".msg.user .msg-body{align-items:flex-end}",
  ".msg.assistant .msg-body{align-items:flex-start}",
  ".bubble{max-width:min(760px,85%);border:1px solid var(--color-line);background:var(--color-side-sel);border-radius:16px;padding:8px 14px;color:var(--color-txt-strong)}",
  ".bubble-text{margin:0;white-space:pre-wrap;overflow-wrap:break-word}",
  ".att{display:flex;flex-wrap:wrap;column-gap:12px;row-gap:4px;margin:8px 0 0;font-size:12px}",
  ".att-item{display:inline-flex;min-width:0;align-items:center;gap:4px;color:var(--color-link);overflow-wrap:anywhere}",
  ".msg-meta{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--color-dim)}",
  ".msg.user .msg-meta{padding-right:4px}",
  ".md-content{font-size:14px;line-height:1.8;font-weight:450;color:var(--color-txt-strong)}",
  ".md-content p{margin:0 0 8px}",
  ".md-content p:last-child{margin-bottom:0}",
  ".md-content strong{font-weight:650;color:var(--color-txt-strong)}",
  ".md-content h1,.md-content h2,.md-content h3,.md-content h4{margin:16px 0 8px;font-weight:650;line-height:1.35;color:var(--color-txt-strong)}",
  ".md-content h1{font-size:19px;font-weight:700}",
  ".md-content h2{font-size:18px;font-weight:700}",
  ".md-content h3{font-size:16px}",
  ".md-content h4{font-size:14px;color:var(--color-mut)}",
  ".md-content li::marker{color:var(--color-dim)}",
  ".md-content ul{list-style:disc;margin:8px 0;padding-left:20px}",
  ".md-content ol{list-style:decimal;margin:8px 0;padding-left:20px}",
  ".md-content li{margin:3px 0}",
  ".md-content hr{margin:14px 0;border:0;border-top:1px solid var(--color-line)}",
  ".md-content code{font-family:var(--font-mono);font-size:12px;background:var(--color-code-bg);color:var(--color-code-fg);border-radius:6px;padding:1.5px 5px;overflow-wrap:anywhere}",
  ".md-content pre{margin:10px 0;padding:10px 12px;border:1px solid var(--color-line);border-radius:8px;background:var(--color-code-bg);color:var(--color-code-fg);overflow:auto}",
  ".md-content pre code{background:transparent;padding:0;white-space:pre}",
  ".md-content blockquote{margin:10px 0;padding:4px 12px;border-left:1px solid var(--color-line-strong);color:var(--color-mut)}",
  ".md-content table{border-collapse:collapse;margin:10px 0;font-size:12px;display:block;max-width:100%;overflow-x:auto}",
  ".md-content th,.md-content td{border:1px solid var(--color-line);padding:6px 10px}",
  ".md-content th{background:var(--color-chip-bg);color:var(--color-txt-strong);font-weight:600;text-align:left}",
  ".empty{margin:0;color:var(--color-mut)}",
  ".footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--color-line);font-size:11px;color:var(--color-dim);text-align:center}",
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
      const inner =
        message.role === "user"
          ? `<div class="bubble"><div class="bubble-text">${message.body}</div>${
              message.attachments?.length ? attachmentHtml(message.attachments) : ""
            }</div>`
          : `<div class="md-content">${message.body}</div>`;
      const time = formatMessageTime(message.createdAt, exportedAt);
      return [
        `<div class="msg ${message.role}">`,
        `  <div class="msg-body">`,
        `    ${inner}`,
        `    <div class="msg-meta"><time datetime="${new Date(message.createdAt).toISOString()}">${time}</time></div>`,
        `  </div>`,
        `</div>`,
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
  <main class="timeline">
${body || `<p class="empty">（无消息）</p>`}
  </main>
  <footer class="footer">导出于 ${formatExportTime(exportedAt)}</footer>
</div>
</body>
</html>
`;
}

/**
 * 渲染 Markdown 导出（与 HTML 导出同口径：只收 user/assistant 非空消息，附件以列表行附在正文后）。
 * 正文原样保留 Markdown（助手回复本就是 Markdown；用户输入也按原文呈现，不做二次转义）。
 */
export function renderSessionMarkdown(input: {
  session: Pick<SessionRecord, "title" | "createdAt" | "updatedAt">;
  messages: ChatMessage[];
  /** 导出时间戳，缺省取调用时刻；测试可注入固定值 */
  exportedAt?: number;
}): string {
  const exportedAt = input.exportedAt ?? Date.now();
  const title = input.session.title?.trim() || "未命名会话";
  const items: Array<{ role: "user" | "assistant"; content: string; createdAt: number; attachments: string[] }> = [];
  for (const message of input.messages) {
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
      : [];
    items.push({ role: message.role, content, createdAt: message.createdAt, attachments });
  }
  const timeRange =
    items.length && input.session.updatedAt
      ? `${formatExportTime(input.session.createdAt)} — ${formatExportTime(input.session.updatedAt)}`
      : formatExportTime(input.session.createdAt);
  const body = items
    .map((item) => {
      const heading = `## ${item.role === "user" ? "用户" : "助手"} · ${formatExportTime(item.createdAt)}`;
      const lines = [heading, "", item.content];
      if (item.attachments.length) {
        lines.push("", `附件：${item.attachments.map((name) => `\`${name}\``).join("、")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
  return [
    `# ${title}`,
    "",
    `> ${timeRange} · ${items.length} 条消息 · 由 Zen 导出`,
    `> 导出于 ${formatExportTime(exportedAt)}`,
    "",
    "---",
    "",
    body || "（无消息）",
    "",
  ].join("\n");
}
