import { computed, ref } from "vue";

/**
 * 会话详细程度（对照 nomi 2.5.3 的 Transcript view）：
 * - minimal：不显示思考，工具行保持折叠；
 * - normal：不显示思考，工具按组折叠；
 * - thinking：显示思考合并块（默认折叠，进行中展开）；
 * - verbose：显示思考，工具步骤默认展开。
 *
 * 分两层：全局默认 + 会话级覆盖；只存本机 localStorage，不进会话数据库，
 * 与会话记录本身无关（换机器/清缓存不影响聊天内容）。
 */

export type TranscriptView = "minimal" | "normal" | "thinking" | "verbose";

export const TRANSCRIPT_VIEWS: readonly TranscriptView[] = ["minimal", "normal", "thinking", "verbose"];

export const DEFAULT_TRANSCRIPT_VIEW: TranscriptView = "thinking";

const STORAGE_KEY = "zen.transcriptView.v1";
/** 只保留最近这么多会话的覆盖，避免 localStorage 无限增长 */
const MAX_SESSIONS = 500;

export interface TranscriptViewState {
  global: TranscriptView;
  sessions: Record<string, TranscriptView>;
}

function isView(value: unknown): value is TranscriptView {
  return typeof value === "string" && (TRANSCRIPT_VIEWS as readonly string[]).includes(value);
}

export function parseTranscriptViewState(raw: string | null): TranscriptViewState {
  const fallback: TranscriptViewState = { global: DEFAULT_TRANSCRIPT_VIEW, sessions: {} };
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }
    const source = parsed as { global?: unknown; sessions?: unknown };
    const sessions: Record<string, TranscriptView> = {};
    if (source.sessions && typeof source.sessions === "object" && !Array.isArray(source.sessions)) {
      for (const [key, value] of Object.entries(source.sessions as Record<string, unknown>)) {
        if (key && isView(value)) {
          sessions[key] = value;
        }
      }
    }
    return { global: isView(source.global) ? source.global : DEFAULT_TRANSCRIPT_VIEW, sessions };
  } catch {
    return fallback;
  }
}

function readState(): TranscriptViewState {
  try {
    return parseTranscriptViewState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { global: DEFAULT_TRANSCRIPT_VIEW, sessions: {} };
  }
}

const initial = readState();
const globalView = ref<TranscriptView>(initial.global);
const sessionViews = ref<Record<string, TranscriptView>>(initial.sessions);

function persist(): void {
  const entries = Object.entries(sessionViews.value);
  if (entries.length > MAX_SESSIONS) {
    // 超量时丢最早插入的部分：对象键顺序即写入顺序
    sessionViews.value = Object.fromEntries(entries.slice(entries.length - MAX_SESSIONS));
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ global: globalView.value, sessions: sessionViews.value }),
    );
  } catch {
    // 存储满/被禁用时静默降级为仅内存生效，不影响聊天
  }
}

export function setGlobalView(view: TranscriptView): void {
  globalView.value = view;
  persist();
}

export function setSessionView(sessionKey: string, view: TranscriptView): void {
  if (!sessionKey) {
    return;
  }
  const next = { ...sessionViews.value };
  delete next[sessionKey];
  next[sessionKey] = view;
  sessionViews.value = next;
  persist();
}

/** 清掉该会话的覆盖，回到跟随全局 */
export function followGlobal(sessionKey: string): void {
  if (!sessionKey || !(sessionKey in sessionViews.value)) {
    return;
  }
  const next = { ...sessionViews.value };
  delete next[sessionKey];
  sessionViews.value = next;
  persist();
}

function viewFor(sessionKey: string | null | undefined): TranscriptView {
  if (sessionKey && sessionViews.value[sessionKey]) {
    return sessionViews.value[sessionKey];
  }
  return globalView.value;
}

/** 当前会话实际生效的档位（会话覆盖 > 全局默认） */
export function useTranscriptView(sessionKey: () => string | null | undefined) {
  const view = computed(() => viewFor(sessionKey()));
  const hasOverride = computed(() => {
    const key = sessionKey();
    return !!key && !!sessionViews.value[key];
  });
  return {
    view,
    globalView: computed(() => globalView.value),
    hasOverride,
    setView: (next: TranscriptView) => {
      const key = sessionKey();
      if (key) {
        setSessionView(key, next);
      } else {
        setGlobalView(next);
      }
    },
    followGlobal: () => followGlobal(sessionKey() ?? ""),
  };
}

/** 思考块是否显示（精简/极简不显示） */
export function showsReasoning(view: TranscriptView): boolean {
  return view === "thinking" || view === "verbose";
}

/** 工具步骤是否默认展开（仅详细） */
export function toolsExpandedByDefault(view: TranscriptView): boolean {
  return view === "verbose";
}

/** 测试用：回到默认状态 */
export function resetTranscriptViewForTests(): void {
  globalView.value = DEFAULT_TRANSCRIPT_VIEW;
  sessionViews.value = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
