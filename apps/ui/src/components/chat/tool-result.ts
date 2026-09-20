import type { ToolPart } from "./tool-part";

export type ToolResult =
  | { kind: "terminal"; text: string; exitCode?: number; error?: string }
  | { kind: "code"; text: string; note?: string }
  | { kind: "diff"; before: string; after: string }
  | { kind: "replacement"; before: string; after: string; replacements: number }
  | { kind: "text"; text: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function outputText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  const output = record(value);
  if (typeof output?.content === "string") return output.content;
  if (typeof output?.output === "string") return output.output;
  if (value == null) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function executionText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  const output = record(value);
  if (typeof output?.output === "string") return output.output;
  if (typeof output?.message === "string") return output.message;
  return undefined;
}

function isOutputSummary(summary: string | undefined, text: string | undefined): boolean {
  if (!summary || !text) return false;
  return summary === text || (summary.endsWith("…") && text.startsWith(summary.slice(0, -1)));
}

/** Older terminal records marked the tool invocation successful even for a nonzero exit. */
export function toolResultState(part: ToolPart): ToolPart["state"] {
  const output = record(part.output);
  if (part.toolName === "runTerminal" && part.state === "ok"
    && (output?.ok === false || (typeof output?.exitCode === "number" && output.exitCode !== 0))) {
    return "error";
  }
  return part.state;
}

/** Only execution results belong in the timeline; arguments are not a result fallback. */
export function toolResult(part: ToolPart): ToolResult | null {
  const output = record(part.output);
  const state = toolResultState(part);
  const failed = ["error", "denied", "cancelled", "interrupted"].includes(state);
  const error = failed ? part.error || part.summary : undefined;
  if (part.toolName === "runTerminal") {
    const text = executionText(part.output);
    const exitCode = typeof output?.exitCode === "number" && Number.isFinite(output.exitCode)
      ? output.exitCode : undefined;
    if (text === undefined && !error && state !== "ok") return null;
    return {
      kind: "terminal",
      text: text === "(no output)" ? "" : text ?? "",
      exitCode,
      error: isOutputSummary(error, text) ? undefined : error,
    };
  }
  if (failed) {
    const text = executionText(part.output);
    const reason = isOutputSummary(error, text) ? undefined : error;
    return { kind: "text", text: [reason, text].filter(Boolean).join("\n\n") || "未完成" };
  }
  if (part.toolName === "readFile" && (typeof part.output === "string" || typeof output?.content === "string")) {
    return { kind: "code", text: outputText(part.output) ?? "" };
  }
  if (state === "ok" && (part.toolName === "writeFile" || part.toolName === "editFile")) {
    if ((typeof output?.before === "string" || output?.before === null) && typeof output?.after === "string") {
      return { kind: "diff", before: output.before ?? "", after: output.after };
    }
    // Historical edits only retained replacement text, not file snapshots or line positions.
    const args = record(part.args);
    if (part.toolName === "editFile" && typeof output?.replacements === "number" && output.replacements > 0
      && typeof args?.oldString === "string" && typeof args?.newString === "string") {
      return { kind: "replacement", before: args.oldString, after: args.newString, replacements: output.replacements };
    }
    if (part.toolName === "writeFile" && (typeof part.output === "string" || typeof output?.content === "string")) {
      return { kind: "code", text: outputText(part.output) ?? "", note: "写入内容（历史记录未保存修改前内容）" };
    }
  }
  const text = outputText(part.output) ?? (state === "ok" ? part.summary : undefined);
  return text !== undefined ? { kind: "text", text } : null;
}

export function codeLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}
