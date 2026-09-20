export { ELEMENT_PICK_SCRIPT, ELEMENT_PICK_TEARDOWN, formatElementForPrompt } from "./selectors";

import type {
  BrowserConsoleEntry,
  BrowserExtractResult,
  BrowserPerformanceMetrics,
  BrowserSnapshot,
} from "@zen/shared";

export function createBrowserToolPlaceholder(): string {
  return "browser";
}

export function truncateBrowserText(text: string, limit = 6000): string {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, limit)}\n…[truncated]`;
}

export function formatConsoleForPrompt(entries: BrowserConsoleEntry[], limit = 40): string {
  const lines = entries.slice(-limit).map((entry) => {
    const where = entry.url ? ` (${entry.url}${entry.line != null ? `:${entry.line}` : ""})` : "";
    return `[${entry.level}] ${entry.text}${where}`;
  });
  return lines.length ? lines.join("\n") : "(console empty)";
}

export function formatPerformanceForPrompt(perf: BrowserPerformanceMetrics): string {
  const lines: string[] = [];
  const nav = perf.navigation;
  if (nav) {
    lines.push(`navigation: ${nav.type}`);
    lines.push(`durationMs=${Math.round(nav.durationMs)}`);
    lines.push(`domContentLoadedMs=${Math.round(nav.domContentLoadedMs)}`);
    lines.push(`loadMs=${Math.round(nav.loadMs)}`);
    if (nav.transferSize != null) {
      lines.push(`transferSize=${nav.transferSize}`);
    }
  }
  if (perf.paint?.firstContentfulPaintMs != null) {
    lines.push(`firstContentfulPaintMs=${Math.round(perf.paint.firstContentfulPaintMs)}`);
  }
  if (perf.paint?.firstPaintMs != null) {
    lines.push(`firstPaintMs=${Math.round(perf.paint.firstPaintMs)}`);
  }
  const keys = [
    "Timestamp",
    "Documents",
    "Frames",
    "JSEventListeners",
    "Nodes",
    "LayoutCount",
    "RecalcStyleCount",
    "LayoutDuration",
    "RecalcStyleDuration",
    "ScriptDuration",
    "TaskDuration",
    "JSHeapUsedSize",
    "JSHeapTotalSize",
  ];
  for (const key of keys) {
    const value = perf.metrics[key];
    if (typeof value === "number") {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join("\n") || "(no metrics)";
}

export function formatSnapshotForPrompt(snapshot: BrowserSnapshot): string {
  const parts = [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    "",
    "Outline:",
    snapshot.outline || "(empty)",
    "",
    "Visible text:",
    truncateBrowserText(snapshot.text, 4000),
  ];
  if (snapshot.links.length) {
    parts.push("", "Links:");
    for (const link of snapshot.links.slice(0, 30)) {
      parts.push(`- ${link.text} -> ${link.href}`);
    }
  }
  return parts.join("\n");
}

export function formatExtractForPrompt(result: BrowserExtractResult): string {
  const parts = [
    `URL: ${result.url}`,
    `Title: ${result.title}`,
    "",
    truncateBrowserText(result.text, 4000),
  ];
  if (result.buttons.length) {
    parts.push("", "Buttons:");
    for (const item of result.buttons.slice(0, 30)) {
      parts.push(`- ${item.selector} :: ${item.text}${item.disabled ? " (disabled)" : ""}`);
    }
  }
  if (result.inputs.length) {
    parts.push("", "Inputs:");
    for (const item of result.inputs.slice(0, 30)) {
      const label = item.label || item.placeholder || item.name || item.type;
      parts.push(`- ${item.selector} :: ${item.tag}${item.type ? `[${item.type}]` : ""} ${label}`);
    }
  }
  return parts.join("\n");
}
