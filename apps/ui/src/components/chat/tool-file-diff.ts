import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";

import { codeLines } from "./tool-result";

interface ChangedLines {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

interface DiffHunk extends ChangedLines {
  changes: ChangedLines[];
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function chunkSideLines(
  doc: Text,
  contentLineCount: number,
  from: number,
  to: number,
  end: number,
): { from: number; to: number } {
  const first = Math.min(doc.lineAt(Math.min(from, doc.length)).number - 1, contentLineCount);
  if (from === to) return { from: first, to: first };
  const last = Math.min(doc.lineAt(Math.min(end, doc.length)).number, contentLineCount);
  return { from: first, to: Math.max(first, last) };
}

function changedLines(docA: Text, docB: Text, countA: number, countB: number, chunk: Chunk): ChangedLines {
  const a = chunkSideLines(docA, countA, chunk.fromA, chunk.toA, chunk.endA);
  const b = chunkSideLines(docB, countB, chunk.fromB, chunk.toB, chunk.endB);
  return { fromA: a.from, toA: a.to, fromB: b.from, toB: b.to };
}

function appendContext(target: string[], lines: string[], from: number, to: number): void {
  for (let index = from; index < to; index += 1) {
    target.push(` ${lines[index] ?? ""}`);
  }
}

function appendChange(
  target: string[],
  lines: string[],
  from: number,
  to: number,
  prefix: "+" | "-",
  sourceEndsWithNewline: boolean,
): void {
  for (let index = from; index < to; index += 1) {
    target.push(`${prefix}${lines[index] ?? ""}`);
    if (index === lines.length - 1 && !sourceEndsWithNewline) {
      target.push("\\ No newline at end of file");
    }
  }
}

/** Build a compact unified diff from execution-time file snapshots. */
export function toolFileDiff(before: string, after: string) {
  const sourceA = normalize(before);
  const sourceB = normalize(after);
  const linesA = codeLines(sourceA);
  const linesB = codeLines(sourceB);
  const docA = Text.of(sourceA.split("\n"));
  const docB = Text.of(sourceB.split("\n"));
  const hunks: DiffHunk[] = [];

  for (const chunk of Chunk.build(docA, docB, { scanLimit: 500, timeout: 100 })) {
    const change = changedLines(docA, docB, linesA.length, linesB.length, chunk);
    const contextBefore = Math.min(2, change.fromA, change.fromB);
    const contextAfter = Math.min(2, linesA.length - change.toA, linesB.length - change.toB);
    const hunk: DiffHunk = {
      fromA: change.fromA - contextBefore,
      toA: change.toA + contextAfter,
      fromB: change.fromB - contextBefore,
      toB: change.toB + contextAfter,
      changes: [change],
    };
    const previous = hunks.at(-1);
    if (previous && hunk.fromA <= previous.toA && hunk.fromB <= previous.toB) {
      previous.toA = hunk.toA;
      previous.toB = hunk.toB;
      previous.changes.push(change);
    } else {
      hunks.push(hunk);
    }
  }

  const patch: string[] = [];
  for (const hunk of hunks) {
    const countA = hunk.toA - hunk.fromA;
    const countB = hunk.toB - hunk.fromB;
    const startA = hunk.fromA + (countA ? 1 : 0);
    const startB = hunk.fromB + (countB ? 1 : 0);
    patch.push(`@@ -${startA},${countA} +${startB},${countB} @@`);
    let cursorA = hunk.fromA;
    for (const change of hunk.changes) {
      appendContext(patch, linesA, cursorA, change.fromA);
      appendChange(patch, linesA, change.fromA, change.toA, "-", sourceA.endsWith("\n"));
      appendChange(patch, linesB, change.fromB, change.toB, "+", sourceB.endsWith("\n"));
      cursorA = change.toA;
    }
    appendContext(patch, linesA, cursorA, hunk.toA);
  }

  return {
    patch: patch.join("\n"),
    added: hunks.reduce((total, hunk) => total + hunk.changes.reduce((sum, change) => sum + change.toB - change.fromB, 0), 0),
    removed: hunks.reduce((total, hunk) => total + hunk.changes.reduce((sum, change) => sum + change.toA - change.fromA, 0), 0),
  };
}
