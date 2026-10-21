import { describe, expect, it } from "vitest";

import { withAttachmentManifest } from "./agent-attachments";

import type { AttachmentRef } from "@zen/shared";

describe("withAttachmentManifest 模型侧附件清单", () => {
  it("无附件时原样返回", () => {
    expect(withAttachmentManifest("你好", undefined)).toBe("你好");
    expect(withAttachmentManifest("你好", [])).toBe("你好");
  });

  it("注入 $名称 → 绝对路径清单，Agent 可按路径读取", () => {
    const out = withAttachmentManifest("帮我看看这个 $notes.txt", [
      { name: "notes.txt", path: "/tmp/zen-attach-test/notes.txt" },
    ]);
    expect(out.startsWith("帮我看看这个 $notes.txt")).toBe(true);
    expect(out).toContain("<attachments>");
    expect(out).toContain("- $notes.txt → /tmp/zen-attach-test/notes.txt");
    expect(out).toContain("</attachments>");
  });

  it("无路径附件明确标注未落盘", () => {
    const out = withAttachmentManifest("看 $blob.bin", [
      { name: "blob.bin", path: "" },
    ]);
    expect(out).toContain("- $blob.bin →（该文件未落盘，无法按路径读取）");
  });

  it("多个附件逐行列出", () => {
    const refs: AttachmentRef[] = [
      { name: "a.png", path: "/u/a.png" },
      { name: "b.md", path: "/u/b.md" },
    ];
    const out = withAttachmentManifest("处理这些", refs);
    const lines = out.split("\n").filter((line) => line.startsWith("- $"));
    expect(lines).toEqual(["- $a.png → /u/a.png", "- $b.md → /u/b.md"]);
  });
});
