// 会话 composer 草稿载荷：正文 + 附件 + 浏览器标注，随会话切换整体恢复。
// 持久化落在 chat_sessions.draft 列：空状态存 ""，否则存 v=1 的 JSON 信封；
// 旧版纯文本草稿与脏数据一律按纯文本正文恢复（见 parseSessionDraft）。
import type { ComposerElementMark } from "@/lib/browser-element";
import type { ComposerAttachment } from "@/stores/chat-types";

export interface SessionDraftState {
  text: string;
  attachments: ComposerAttachment[];
  elementMarks: ComposerElementMark[];
}

export function serializeSessionDraft(state: SessionDraftState): string {
  if (!state.text && !state.attachments.length && !state.elementMarks.length) {
    return "";
  }
  return JSON.stringify({
    v: 1,
    text: state.text,
    attachments: state.attachments,
    elementMarks: state.elementMarks,
  });
}

function isAttachment(value: unknown): value is ComposerAttachment {
  const item = value as ComposerAttachment | null;
  return !!item && typeof item === "object" && typeof item.name === "string";
}

function isElementMark(value: unknown): value is ComposerElementMark {
  const item = value as ComposerElementMark | null;
  return !!item && typeof item === "object" && typeof item.token === "string";
}

export function parseSessionDraft(raw: string | null | undefined): SessionDraftState {
  const source = raw ?? "";
  if (!source) {
    return { text: "", attachments: [], elementMarks: [] };
  }
  if (source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source) as {
        v?: number;
        text?: unknown;
        attachments?: unknown;
        elementMarks?: unknown;
      };
      if (parsed.v === 1 && typeof parsed.text === "string") {
        return {
          text: parsed.text,
          attachments: Array.isArray(parsed.attachments)
            ? parsed.attachments.filter(isAttachment)
            : [],
          elementMarks: Array.isArray(parsed.elementMarks)
            ? parsed.elementMarks.filter(isElementMark)
            : [],
        };
      }
    } catch {
      // 非 JSON 载荷：按旧版纯文本草稿处理
    }
  }
  return { text: source, attachments: [], elementMarks: [] };
}
