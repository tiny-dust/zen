import { describe, it } from "vitest";
import { highlightLines, langFromPath } from "./shiki-highlight";

const md = [
  "## 排版",
  "",
  "- 正文 `13px`",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
].join("\n");

describe("hl", () => {
  it("markdown", async () => {
    console.log("lang", langFromPath("DESIGN.md"));
    const lines = await highlightLines(md, "markdown" as never);
    console.log("lines", lines ? lines.length : null);
    if (lines) console.log("L0", lines[0]?.slice(0, 200));
  });
});
