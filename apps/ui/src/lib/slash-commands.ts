/**
 * 斜杠命令登记表：只收录当前能真实执行的本地动作。
 * 没有实现支撑的命令不要登记，避免出现「点了没反应」的入口。
 */
export type SlashCommandId = "help" | "clear" | "status" | "diff" | "context" | "model" | "mode";

export interface SlashCommandDef {
  id: SlashCommandId;
  /** 输入的名字（不含斜杠），同时参与模糊匹配 */
  name: string;
  /** 展示名文案键（locales/modules/chat.ts → chat.slash.*） */
  labelKey: string;
  descKey: string;
  /** 额外搜索词：别名、中文叫法 */
  keywords: string[];
}

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { id: "help", name: "help", labelKey: "slash.help", descKey: "slash.helpDesc", keywords: ["说明", "命令", "?"] },
  { id: "clear", name: "clear", labelKey: "slash.clear", descKey: "slash.clearDesc", keywords: ["new", "reset", "新对话"] },
  { id: "status", name: "status", labelKey: "slash.status", descKey: "slash.statusDesc", keywords: ["信息", "会话", "info"] },
  { id: "diff", name: "diff", labelKey: "slash.diff", descKey: "slash.diffDesc", keywords: ["git", "变更", "改动", "changes"] },
  { id: "context", name: "context", labelKey: "slash.context", descKey: "slash.contextDesc", keywords: ["上下文", "用量", "token", "usage"] },
  { id: "model", name: "model", labelKey: "slash.model", descKey: "slash.modelDesc", keywords: ["模型", "切换", "switch"] },
  { id: "mode", name: "mode", labelKey: "slash.mode", descKey: "slash.modeDesc", keywords: ["权限", "模式", "permission"] },
];

/** 子序列匹配：`/cls` 能命中 `clear`，字符顺序必须一致 */
function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) {
      cursor += 1;
      if (cursor === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}

/** 空查询返回全部（保持登记顺序）；命中名字或任一关键词即保留 */
export function matchSlashCommands(
  query: string,
  commands: readonly SlashCommandDef[] = SLASH_COMMANDS,
): SlashCommandDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...commands];
  }
  return commands.filter((command) =>
    [command.name, ...command.keywords].some((word) => isSubsequence(needle, word.toLowerCase())),
  );
}

export function findSlashCommand(id: SlashCommandId): SlashCommandDef | undefined {
  return SLASH_COMMANDS.find((command) => command.id === id);
}
