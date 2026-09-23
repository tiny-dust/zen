import { describe, expect, it } from "vitest";

import {
  isAbsolutePathLike,
  isHtmlRefPath,
  pathToFileUrl,
  resolveFileRefPath,
  splitLineAnchor,
  toPosixPath,
  toWorkspaceRelativePath,
} from "./file-ref";

describe("toPosixPath", () => {
  it.each([
    ["src\\ui\\a.ts", "src/ui/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    [".\\src\\a.ts", "src/a.ts"],
    ["  src/a.ts  ", "src/a.ts"],
    ["src/a.ts", "src/a.ts"],
  ])("%s → %s", (input, expected) => {
    expect(toPosixPath(input)).toBe(expected);
  });
});

describe("isAbsolutePathLike", () => {
  it.each([
    ["/tmp/a.ts", true],
    ["C:\\ws\\a.ts", true],
    ["c:/ws/a.ts", true],
    ["src/a.ts", false],
    ["./src/a.ts", false],
  ])("%s → %s", (input, expected) => {
    expect(isAbsolutePathLike(input)).toBe(expected);
  });
});

describe("splitLineAnchor", () => {
  it.each([
    ["src/a.ts", { file: "src/a.ts" }],
    ["src/a.ts:12", { file: "src/a.ts", line: 12 }],
    ["src/a.ts#L30", { file: "src/a.ts", line: 30 }],
    ["/tmp/a.ts#L12", { file: "/tmp/a.ts", line: 12 }],
    ["C:\\ws\\a.ts", { file: "C:\\ws\\a.ts" }],
  ])("%s → %s", (input, expected) => {
    expect(splitLineAnchor(input)).toEqual(expected);
  });
});

describe("resolveFileRefPath", () => {
  it("joins workspace-relative refs onto the root", () => {
    expect(resolveFileRefPath("src/a.ts", "/ws")).toBe("/ws/src/a.ts");
    expect(resolveFileRefPath("./src\\a.ts", "/ws/")).toBe("/ws/src/a.ts");
  });

  it("strips line anchors before resolving", () => {
    expect(resolveFileRefPath("src/a.ts#L12", "/ws")).toBe("/ws/src/a.ts");
    expect(resolveFileRefPath("/tmp/a.ts:20", "/ws")).toBe("/tmp/a.ts");
  });

  it("keeps absolute refs untouched and tolerates a missing root", () => {
    expect(resolveFileRefPath("/tmp/a.ts", "/ws")).toBe("/tmp/a.ts");
    expect(resolveFileRefPath("C:\\ws\\a.ts", "C:\\ws")).toBe("C:/ws/a.ts");
    expect(resolveFileRefPath("src/a.ts")).toBe("src/a.ts");
  });
});

describe("toWorkspaceRelativePath", () => {
  it("relativizes paths inside the workspace and rejects outside ones", () => {
    expect(toWorkspaceRelativePath("/ws/src/a.ts", "/ws")).toBe("src/a.ts");
    expect(toWorkspaceRelativePath("/ws", "/ws")).toBe("");
    expect(toWorkspaceRelativePath("/other/a.ts", "/ws")).toBeNull();
    expect(toWorkspaceRelativePath("src/a.ts", "/ws")).toBeNull();
    expect(toWorkspaceRelativePath("/ws/a.ts")).toBeNull();
  });

  it("is case-insensitive for Windows drive paths", () => {
    expect(toWorkspaceRelativePath("C:\\WS\\src\\a.ts", "c:\\ws")).toBe("src/a.ts");
    expect(toWorkspaceRelativePath("/WS/src/a.ts", "/ws")).toBeNull();
  });
});

describe("isHtmlRefPath", () => {
  it.each([
    ["index.html", true],
    ["docs/page.htm", true],
    ["/ws/报告.HTML", true],
    ["demo.html:12", true],
    ["index.ts", false],
    ["style.css", false],
    ["folder.htmlx", false],
  ])("%s → %s", (input, expected) => {
    expect(isHtmlRefPath(input)).toBe(expected);
  });
});

describe("pathToFileUrl", () => {
  it("converts unix absolute paths with per-segment encoding", () => {
    expect(pathToFileUrl("/ws/index.html")).toBe("file:///ws/index.html");
    expect(pathToFileUrl("/ws/my docs/页面 demo.html")).toBe(
      "file:///ws/my%20docs/%E9%A1%B5%E9%9D%A2%20demo.html",
    );
    // # ? 是 URL 保留字，必须编码，否则会被当成 fragment/query
    expect(pathToFileUrl("/ws/a#b.html")).toBe("file:///ws/a%23b.html");
  });

  it("converts windows drive paths to file:///C:/ form", () => {
    expect(pathToFileUrl("C:\\ws\\index.html")).toBe("file:///C:/ws/index.html");
    expect(pathToFileUrl("C:/my docs/a b.html")).toBe("file:///C:/my%20docs/a%20b.html");
  });

  it("returns empty for relative paths without a mountable root", () => {
    expect(pathToFileUrl("src/index.html")).toBe("");
    expect(pathToFileUrl("./index.html")).toBe("");
  });
});
