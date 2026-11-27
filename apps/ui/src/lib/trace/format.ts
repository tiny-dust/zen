/**
 * 运行轨迹的格式化纯函数：时长 / Token / 相对时间 / JSON 美化 / 标题截断。
 * 数值规则照抄 Nomi 的 utils/toolTrace.formatDuration 与 UsagePanel.formatTokens。
 */

/** 1000ms 以下显示毫秒，1 分钟内保留 1 位小数（>10s 取整），更长用 `m ss` */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) {
    return "";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** token 数：1k 以下原样，之后 1 位小数（万级取整） */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 相对轨迹起点的偏移标签：+0.42s / −1.20s */
export function offsetLabel(at: number, from: number): string {
  const d = (at - from) / 1000;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}s`;
}

/** 美化 JSON 文本；不是 JSON 时原样返回 */
export function prettyJson(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** 折叠空白（换行/多空格 → 单空格） */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 折叠空白后按字符数截断，超长追加省略号 */
export function compactPreview(text: string | undefined, max: number): string {
  if (!text) {
    return "";
  }
  const flat = collapse(text);
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

const LINE_PREFIX = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/;
const INLINE_MARK = /[*`_~]/g;
const SENTENCE = /[^。！？.!?]+[。！？.!?]?/g;

/** 从思考正文提炼一行标题：去掉 markdown 前缀与行内标记，取首行首句 */
export function thoughtTitle(text: string, max = 72): string {
  const lines = text
    .split("\n")
    .map((line) => line.replace(LINE_PREFIX, "").replace(INLINE_MARK, "").trim())
    .filter(Boolean);
  const line = lines[0];
  if (!line) {
    return "";
  }
  const sentence = (line.match(SENTENCE) ?? [line]).map((item) => item.trim()).filter(Boolean)[0] ?? line;
  return sentence.length > max ? `${sentence.slice(0, max).trimEnd()}…` : sentence;
}
