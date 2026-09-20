import { describe, expect, it } from "vitest";

import { toolFileDiff } from "./tool-file-diff";
import { codeLines, toolResult, toolResultState } from "./tool-result";
import type { ToolPart } from "./tool-part";

function part(toolName: string, extra: Partial<ToolPart> = {}): ToolPart {
  return { type: "tool", toolCallId: "test", toolName, state: "ok", ...extra };
}

describe("toolResult", () => {
  it("extracts terminal output and exit status without arguments or summaries", () => {
    expect(toolResult(part("runTerminal", {
      args: { command: "pnpm test", timeoutMs: 1000 },
      summary: "工具执行完成", message: "正在调用工具",
      output: { ok: true, exitCode: 0, output: "all passed\n" },
    }))).toEqual({ kind: "terminal", text: "all passed\n", exitCode: 0, error: undefined });
  });

  it("corrects historical nonzero terminal status but preserves cancellation", () => {
    const failed = part("runTerminal", { output: { ok: false, exitCode: 2, output: "not found" } });
    expect(toolResultState(failed)).toBe("error");
    expect(toolResultState({ ...failed, state: "cancelled" })).toBe("cancelled");
    expect(toolResult(failed)).toMatchObject({ kind: "terminal", text: "not found", exitCode: 2 });
  });

  it("preserves read content and blank lines beyond the old display limit", () => {
    const content = `  ${"a".repeat(4500)}\n\nlast\n`;
    expect(toolResult(part("readFile", { output: content }))).toEqual({ kind: "code", text: content });
    expect(codeLines("a\n\n")).toEqual(["a", ""]);
    expect(codeLines("")).toEqual([]);
    expect(toolResult(part("readFile", { output: "" }))).toEqual({ kind: "code", text: "" });
  });

  it("uses actual snapshots for both writes and edits", () => {
    for (const toolName of ["writeFile", "editFile"]) {
      expect(toolResult(part(toolName, {
        args: { oldString: "not actual", newString: "not actual" },
        output: { path: "src/a.ts", before: "old\n", after: "new\n" },
      }))).toEqual({ kind: "diff", before: "old\n", after: "new\n" });
    }
    expect(toolResult(part("writeFile", { output: { before: null, after: "new" } })))
      .toEqual({ kind: "diff", before: "", after: "new" });
  });

  it("does not present attempted edits as completed changes", () => {
    const args = { oldString: "old", newString: "new" };
    expect(toolResult(part("editFile", { args, state: "running" }))).toBeNull();
    expect(toolResult(part("editFile", { args, state: "denied", error: "用户拒绝" })))
      .toEqual({ kind: "text", text: "用户拒绝" });
  });

  it("labels incomplete historical change records without inventing line numbers", () => {
    expect(toolResult(part("editFile", {
      args: { oldString: "old", newString: "new" }, output: { replacements: 3 },
    }))).toEqual({ kind: "replacement", before: "old", after: "new", replacements: 3 });
    expect(toolResult(part("writeFile", { output: "new" }))).toMatchObject({
      kind: "code", text: "new", note: "写入内容（历史记录未保存修改前内容）",
    });
  });

  it("never serializes failed SDK objects, including errors restored from JSON", () => {
    for (const output of [new Error("failure"), {}, { message: "failure", diagnostic: "not a result" }]) {
      expect(toolResult(part("writeFile", { state: "error", error: "failure", output })))
        .toEqual({ kind: "text", text: "failure" });
    }
    expect(toolResult(part("runTerminal", {
      state: "cancelled", error: "用户取消", output: { ok: false, exitCode: 1, output: "partial output" },
    }))).toMatchObject({ text: "partial output", error: "用户取消" });
  });

  it("uses actual generic results and keeps errors visible", () => {
    expect(toolResult(part("listDir", { args: { path: "src" }, output: "d components\n- main.ts" })))
      .toEqual({ kind: "text", text: "d components\n- main.ts" });
    expect(toolResult(part("mcp.test", { output: { matches: 2 } })))
      .toEqual({ kind: "text", text: '{\n  "matches": 2\n}' });
    expect(toolResult(part("readFile", { state: "error", error: "ENOENT" })))
      .toEqual({ kind: "text", text: "ENOENT" });
    expect(toolResult(part("writeFile", { state: "error", summary: "写入失败", output: new Error("写入失败") })))
      .toEqual({ kind: "text", text: "写入失败" });
    expect(toolResult(part("runTerminal", {
      state: "error", summary: "完整…", output: { ok: false, exitCode: 1, output: "完整终端错误" },
    }))).toEqual({ kind: "terminal", text: "完整终端错误", exitCode: 1, error: undefined });
  });
});

describe("toolFileDiff", () => {
  it("shows changed lines with true line positions and nearby context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}\n`).join("");
    const after = before.replace("line 10", "updated 10").replace("line 18", "updated 18");
    const result = toolFileDiff(before, after);
    expect(result).toMatchObject({ added: 2, removed: 2 });
    expect(result.patch).toContain("@@ -8,5 +8,5 @@");
    expect(result.patch).toContain("-line 10\n+updated 10");
    expect(result.patch).toContain("@@ -16,5 +16,5 @@");
  });

  it("handles new, cleared, unchanged and unterminated files", () => {
    expect(toolFileDiff("", "a\nb\n")).toEqual({ patch: "@@ -0,0 +1,2 @@\n+a\n+b", added: 2, removed: 0 });
    expect(toolFileDiff("a\nb\n", "")).toEqual({ patch: "@@ -1,2 +0,0 @@\n-a\n-b", added: 0, removed: 2 });
    expect(toolFileDiff("a", "a")).toEqual({ patch: "", added: 0, removed: 0 });
    expect(toolFileDiff("a\nb", "a\nB")).toMatchObject({ added: 1, removed: 1 });
    expect(toolFileDiff("a\nb\nc", "a\nB\nC")).toMatchObject({ added: 2, removed: 2 });
    expect(toolFileDiff("a\nb\nc", "a\nb\nC").patch).toContain("-c\n\\ No newline at end of file\n+C");
    expect(toolFileDiff("a\r\nb\r\n", "a\r\nB\r\n").patch).toContain("-b\n+B");
  });

  it("keeps every unterminated line when creating or clearing a file", () => {
    expect(toolFileDiff("", "a\nb")).toEqual({
      patch: "@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file", added: 2, removed: 0,
    });
    expect(toolFileDiff("a\nb", "")).toEqual({
      patch: "@@ -1,2 +0,0 @@\n-a\n-b\n\\ No newline at end of file", added: 0, removed: 2,
    });
    expect(toolFileDiff("a", "a\n").patch).toBe("@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+a");
    expect(toolFileDiff("a\n", "a").patch).toBe("@@ -1,1 +1,1 @@\n-a\n+a\n\\ No newline at end of file");
  });

  it("keeps insertion and deletion line positions", () => {
    expect(toolFileDiff("a\nb\n", "a\nx\nb\n")).toEqual({
      patch: "@@ -1,2 +1,3 @@\n a\n+x\n b", added: 1, removed: 0,
    });
    expect(toolFileDiff("a\nx\nb\n", "a\nb\n")).toEqual({
      patch: "@@ -1,3 +1,2 @@\n a\n-x\n b", added: 0, removed: 1,
    });
  });

  it("merges overlapping context without repeating unchanged lines", () => {
    const result = toolFileDiff("a\nb\nc\nd\ne\nf\n", "a\nB\nc\nd\nE\nf\n");
    expect(result.patch.match(/^@@/gm)).toHaveLength(1);
    expect(result.patch).toContain(" c\n d");
    expect(result.added).toBe(2);
    expect(result.removed).toBe(2);
  });
});
