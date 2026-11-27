/** 可作为会话底座的外部 CLI（本机已安装才能选中） */
export type CliRuntimeId = "claude" | "codex";

export const CLI_RUNTIME_IDS: readonly CliRuntimeId[] = ["claude", "codex"];

export function isCliRuntimeId(value: unknown): value is CliRuntimeId {
  return value === "claude" || value === "codex";
}
