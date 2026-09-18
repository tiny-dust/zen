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

export function useComposerTriggers(options: {
  textarea: () => HTMLTextAreaElement | null;
  value: () => string;
  setValue: (next: string) => void;
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
      return agentStore.skills
        .filter((skill) => matchesQuery(skill.id + skill.name, query.value))
        .slice(0, 30)
        .map((skill) => ({
          insert: `/skill:${skill.name} `,
          label: skill.name,
          desc: skill.description || skill.dir,
          icon: "skill" as const,
          id: skill.id,
          dir: skill.dir,
          source: skill.source,
        }));
    }
    return BUILTIN_SKILLS.filter((item) => matchesQuery(item.id + item.label, query.value)).map(
      (item) => ({
        insert: `/${item.id} `,
        label: item.label,
        desc: item.description,
        icon: "skill" as const,
        id: item.id,
        source: "builtin" as const,
      }),
    );
  });

  const fileItems = computed<TriggerItem[]>(() => {
    return files.value
      .filter((item) => matchesQuery(item.path, query.value))
      .slice(0, 30)
      .map((item) => ({
        insert: `$${item.path} `,
        label: item.name,
        desc: item.path,
        icon: item.isDir ? "dir" : "file",
      }));
  });

  const items = computed<TriggerItem[]>(() =>
    kind.value === "skill" ? skillItems.value : fileItems.value,
  );

  const activeItem = computed(() => items.value[active.value] ?? null);

  function matchesQuery(haystack: string, q: string): boolean {
    return q ? haystack.toLowerCase().includes(q.toLowerCase()) : true;
  }

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

  /** 输入变化后检测光标前的触发 token（/ 或 $ + 查询词） */
  function evaluate(): void {
    const el = options.textarea();
    if (!el) {
      close();
      return;
    }
    const value = options.value();
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = /(?:^|\s)(\/|\/[\w-]*|[$][$\w./-]*)$/.exec(before);

    if (!match) {
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
      if (!files.value.length && !query.value) {
        close();
        return;
      }
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
    const el = options.textarea();
    if (!open.value || !target || !el) {
      return false;
    }
    const value = options.value();
    const cursor = el.selectionEnd ?? value.length;

    // 技能以 chip 挂在输入框上方：移除触发 token，不往正文插入文本
    if (options.onSelectSkill?.(target)) {
      options.setValue(value.slice(0, tokenStart.value) + value.slice(cursor));
      close();
      el.focus();
      el.setSelectionRange(tokenStart.value, tokenStart.value);
      return true;
    }

    const next = value.slice(0, tokenStart.value) + target.insert + value.slice(cursor);
    options.setValue(next);
    close();
    el.focus();
    const caret = tokenStart.value + target.insert.length;
    el.setSelectionRange(caret, caret);
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
