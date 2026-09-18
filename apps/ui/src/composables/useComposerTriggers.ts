import { computed, ref } from "vue";

import type { WorkspaceFile } from "@zen/shared";
import { BUILTIN_SKILLS } from "@zen/shared";
import { useAgentStore } from "@/stores/agent";

export interface TriggerItem {
  insert: string;
  label: string;
  desc: string;
  icon: "skill" | "file" | "dir";
  /** 技能条目附加信息（供 chip 悬浮展示；文件类无） */
  id?: string;
  dir?: string;
  source?: "builtin" | "user";
}

export type TriggerKind = "skill" | "file";

const MAX_FILES = 200;

/**
 * 模糊匹配打分：query 以子序列命中 haystack；
 * 连续命中与词边界（开头、/ - _ . 空白之后）加分，haystack 越长略微降分。
 * 返回 null 表示不匹配。
 */
function fuzzyScore(haystack: string, query: string): number | null {
  if (!query) {
    return 0;
  }
  const lower = haystack.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  let prevIndex = -1;
  let score = 0;
  for (const ch of needle) {
    const index = lower.indexOf(ch, from);
    if (index < 0) {
      return null;
    }
    score += 1;
    if (index === prevIndex + 1) {
      score += 2;
    }
    const prevChar = index > 0 ? (lower[index - 1] ?? "") : "";
    if (index === 0 || /[/_.\s-]/.test(prevChar)) {
      score += 3;
    }
    prevIndex = index;
    from = index + 1;
  }
  return score - haystack.length * 0.01;
}

/** 按 query 模糊打分排序（不匹配的剔除），保持条目原样返回 */
function rankByQuery<T>(entries: Array<{ haystack: string; value: T }>, query: string): T[] {
  return entries
    .flatMap((entry) => {
      const score = fuzzyScore(entry.haystack, query);
      return score === null ? [] : [{ value: entry.value, score }];
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.value);
}

export function useComposerTriggers(options: {
  /** 光标在源文本中的偏移（由编辑器提供） */
  caret: () => number;
  value: () => string;
  setValue: (next: string) => void;
  /** 光标落点：由编辑器保证在重渲染后设置 */
  setCaret: (offset: number) => void;
  focus: () => void;
  /** @ 文件补全的根目录；不传则用 main 的默认目录 */
  rootPath?: () => string | undefined;
  /** 技能选中回调：返回 true 表示已按 chip 消费，不再往正文插入文本 */
  onSelectSkill?: (item: TriggerItem) => boolean;
}) {
  const open = ref(false);
  const kind = ref<TriggerKind>("skill");
  const query = ref("");
  const active = ref(0);
  const files = ref<WorkspaceFile[]>([]);
  let filesFetchedAt = 0;

  const tokenStart = ref(0);

  const agentStore = useAgentStore();

  const skillItems = computed<TriggerItem[]>(() => {
    // 扫描到的真实技能优先；无扫描结果时回退到内置占位
    if (agentStore.skills.length) {
      return rankByQuery(
        agentStore.skills.map((skill) => ({
          haystack: `${skill.id} ${skill.name}`,
          value: {
            insert: `/skill:${skill.name} `,
            label: skill.name,
            desc: skill.description || skill.dir,
            icon: "skill" as const,
            id: skill.id,
            dir: skill.dir,
            source: skill.source,
          },
        })),
        query.value,
      ).slice(0, 30);
    }
    return rankByQuery(
      BUILTIN_SKILLS.map((item) => ({
        haystack: `${item.id} ${item.label}`,
        value: {
          insert: `/${item.id} `,
          label: item.label,
          desc: item.description,
          icon: "skill" as const,
          id: item.id,
          source: "builtin" as const,
        },
      })),
      query.value,
    ).slice(0, 30);
  });

  const fileItems = computed<TriggerItem[]>(() => {
    return rankByQuery(
      files.value.slice(0, MAX_FILES).map((file) => ({
        // 文件名在前：文件名命中排在纯路径命中之前
        haystack: `${file.name} ${file.path}`,
        value: {
          insert: `$${file.path} `,
          label: file.name,
          desc: file.path,
          icon: file.isDir ? ("dir" as const) : ("file" as const),
        },
      })),
      query.value,
    ).slice(0, 30);
  });

  const items = computed<TriggerItem[]>(() =>
    kind.value === "skill" ? skillItems.value : fileItems.value,
  );

  const activeItem = computed(() => items.value[active.value] ?? null);

  async function ensureFiles() {
    if (Date.now() - filesFetchedAt < 30_000 && files.value.length) {
      return;
    }
    const zen = window.zen;
    if (!zen) {
      return;
    }
    try {
      files.value = await zen.workspace.listFiles(options.rootPath?.());
      filesFetchedAt = Date.now();
    } catch {
      files.value = [];
    }
  }

  /** 输入变化后检测光标前的触发 token（/ 技能；@ 或 $ 文件引用） */
  function evaluate(): void {
    const value = options.value();
    const cursor = Math.min(Math.max(options.caret(), 0), value.length);
    const before = value.slice(0, cursor);
    // / 唤起技能；@/$ 唤起文件引用（@ 前不能是字母数字等，避免邮箱误触）
    const skillMatch = /(?:^|\s)(\/[\w-]*)$/.exec(before);
    const fileMatch = /(?:^|[^\w.@$/])([@$][\w./-]*)$/.exec(before);
    const match = skillMatch ?? fileMatch;

    if (!match || !match[1]) {
      close();
      return;
    }

    const token = match[1];
    tokenStart.value = cursor - token.length;
    kind.value = token.startsWith("/") ? "skill" : "file";
    query.value = token.slice(1);
    active.value = 0;

    if (kind.value === "file") {
      void ensureFiles();
    }
    open.value = true;
  }

  function close(): void {
    open.value = false;
    query.value = "";
    active.value = 0;
  }

  function move(delta: number): void {
    if (!items.value.length) {
      return;
    }
    active.value = (active.value + delta + items.value.length) % items.value.length;
  }

  function apply(item: TriggerItem | null): boolean {
    const target = item ?? activeItem.value;
    if (!open.value || !target) {
      return false;
    }
    const value = options.value();
    const cursor = Math.min(Math.max(options.caret(), 0), value.length);

    // 技能以 chip 挂在输入框上方：移除触发 token，不往正文插入文本
    if (options.onSelectSkill?.(target)) {
      options.setValue(value.slice(0, tokenStart.value) + value.slice(cursor));
      close();
      options.focus();
      options.setCaret(tokenStart.value);
      return true;
    }

    const next = value.slice(0, tokenStart.value) + target.insert + value.slice(cursor);
    options.setValue(next);
    close();
    options.focus();
    options.setCaret(tokenStart.value + target.insert.length);
    return true;
  }

  /** 返回 true 表示按键已消费（弹窗打开时拦截方向键/回车/Esc） */
  function onKeydown(event: KeyboardEvent): boolean {
    if (!open.value) {
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (apply(null)) {
        event.preventDefault();
        return true;
      }
      close();
      return false;
    }
    return false;
  }

  return {
    open,
    kind,
    items,
    active,
    activeItem,
    evaluate,
    close,
    move,
    apply,
    onKeydown,
  };
}
