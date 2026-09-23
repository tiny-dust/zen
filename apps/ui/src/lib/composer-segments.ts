// ComposerEditor 的源文本解析：把 markdown 源文本拆成装饰分段（纯函数，不依赖组件实例）。

import type { ComposerAttachment } from "@/stores/chat-types";
import type { ComposerElementMark } from "@/lib/browser-element";

export type SegmentKind = "text" | "bold" | "link" | "marker" | "token" | "skill";

export interface Segment {
  kind: SegmentKind;
  text: string;
  attachmentId?: string;
}

interface MarkedRange {
  start: number;
  end: number;
  segment: Segment;
}

function overlaps(marked: MarkedRange[], start: number, end: number): boolean {
  return marked.some((range) => start < range.end && end > range.start);
}

/** 提及是否呈路径形态：含 / 或带扩展名（README.md）；排除 "$5.00"、"@词" 一类非路径文本 */
function isPathLikeMention(token: string): boolean {
  const value = token.slice(1);
  return value.includes("/") || /\.[A-Za-z]\w{0,7}$/.test(value);
}

/** 把 source 解析成装饰分段：token（附件引用）> 行首清单标记 > 加粗 > 链接，其余为纯文本 */
export function parseSegments(
  source: string,
  attachments: ComposerAttachment[],
  elements: ComposerElementMark[] | undefined,
): Segment[] {
  const marked: MarkedRange[] = [];

  // 附件引用 token：`$文件名`（长名优先，避免同名前缀互相吞并）
  const sortedAttachments = [...attachments].sort((a, b) => b.name.length - a.name.length);
  for (const att of sortedAttachments) {
    const needle = `$${att.name}`;
    let from = 0;
    for (;;) {
      const index = source.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      const end = index + needle.length;
      if (!overlaps(marked, index, end)) {
        marked.push({
          start: index,
          end,
          segment: { kind: "token", text: needle, attachmentId: att.id },
        });
      }
      from = index + 1;
    }
  }

  // 技能 token：`/skill:名称`（从 / 弹窗选中后内联在正文里）
  const skillRe = /\/skill:[^\s/]+/g;
  for (;;) {
    const match = skillRe.exec(source);
    if (!match || !match[0]) {
      break;
    }
    if (!overlaps(marked, match.index, match.index + match[0].length)) {
      marked.push({
        start: match.index,
        end: match.index + match[0].length,
        segment: { kind: "skill", text: match[0] },
      });
    }
  }

  // 浏览器标注元素：`$el:id`（长 token 优先）
  const sortedElements = [...(elements ?? [])].sort((a, b) => b.token.length - a.token.length);
  for (const item of sortedElements) {
    const needle = item.token;
    let from = 0;
    for (;;) {
      const index = source.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      const end = index + needle.length;
      if (!overlaps(marked, index, end)) {
        marked.push({
          start: index,
          end,
          segment: { kind: "token", text: needle, attachmentId: item.id },
        });
      }
      from = index + 1;
    }
  }

  // 未注册为附件的 @/$ 路径提及（@ 文件补全插入的 `$路径` 或手输引用）：呈路径形态才装饰
  const mentionRe = /(?:^|\s)([@$][\w./-]+)/g;
  for (;;) {
    const match = mentionRe.exec(source);
    if (!match || !match[1]) {
      break;
    }
    const start = match.index + match[0].length - match[1].length;
    const end = start + match[1].length;
    if (isPathLikeMention(match[1]) && !overlaps(marked, start, end)) {
      marked.push({ start, end, segment: { kind: "token", text: match[1] } });
    }
  }

  scanMarkdown(source, marked);

  marked.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of marked) {
    if (range.start > cursor) {
      segments.push({ kind: "text", text: source.slice(cursor, range.start) });
    }
    segments.push(range.segment);
    cursor = range.end;
  }
  if (cursor < source.length) {
    segments.push({ kind: "text", text: source.slice(cursor) });
  }
  return segments;
}

/** 在源文本上扫描 markdown 装饰（与 token 区间重叠的丢弃） */
function scanMarkdown(source: string, marked: MarkedRange[]): void {
  const mark = (start: number, end: number, segment: Segment) => {
    if (!overlaps(marked, start, end)) {
      marked.push({ start, end, segment });
    }
  };

  // 清单标记：行首的 - / * / 1.（含缩进），只弱化标记符本身
  const markerRe = /^[ \t]*([-*+]|\d+\.)[ \t]/gm;
  for (;;) {
    const match = markerRe.exec(source);
    if (!match || !match[1]) {
      break;
    }
    const markerText = match[1];
    // match[0] = 缩进 + 标记符 + 一个空白；标记符起点从行尾往回推
    const start = match.index + match[0].length - markerText.length - 1;
    mark(start, start + markerText.length, { kind: "marker", text: markerText });
  }

  // 加粗：**文字**
  const boldRe = /\*\*([^*\n]+)\*\*/g;
  for (;;) {
    const match = boldRe.exec(source);
    if (!match) {
      break;
    }
    mark(match.index, match.index + match[0].length, { kind: "bold", text: match[0] });
  }

  // 链接：[文字](url)
  const linkRe = /\[([^\]\n]+)\]\(([^()\s]+)\)/g;
  for (;;) {
    const match = linkRe.exec(source);
    if (!match) {
      break;
    }
    mark(match.index, match.index + match[0].length, { kind: "link", text: match[0] });
  }
}

/** 把落在 token/skill 分段内部的偏移吸附到该分段边缘（edge 决定贴起点还是终点） */
export function snapToToken(
  segments: Segment[],
  offset: number,
  edge: "start" | "end" | "nearest",
): number {
  let start = 0;
  for (const segment of segments) {
    const end = start + segment.text.length;
    if ((segment.kind === "token" || segment.kind === "skill") && offset > start && offset < end) {
      return edge === "start" || (edge === "nearest" && offset - start <= end - offset) ? start : end;
    }
    start = end;
  }
  return offset;
}
