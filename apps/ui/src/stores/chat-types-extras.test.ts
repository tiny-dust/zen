import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatTurn } from "@zen/shared";

import {
  buildHistory,
  collectTouchedFiles,
  collectUploads,
  compressHistory,
  pathFromToolArgs,
} from "@/stores/chat-types";

function msg(partial: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `m${Math.random()}`,
    content: "",
    createdAt: 0,
    ...partial,
  };
}

const baseOpts = {
  tasks: [],
  touchedFiles: [],
  uploads: [],
  force: true,
  overThreshold: false,
};

describe("buildHistory", () => {
  it("只保留 user / assistant，去掉系统与工具消息", () => {
    const messages = [
      msg({ role: "system", content: "sys" }),
      msg({ role: "user", content: "u1" }),
      msg({ role: "tool", content: "t1" }),
      msg({ role: "assistant", content: "a1" }),
    ];
    expect(buildHistory(messages)).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ]);
  });
});

describe("pathFromToolArgs", () => {
  it("仅读写文件类工具取 path / file_path", () => {
    expect(pathFromToolArgs("readFile", { path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(pathFromToolArgs("editFile", { path: "  /trim.ts  " })).toBe("/trim.ts");
    expect(pathFromToolArgs("writeFile", { file_path: "/w/x.ts" })).toBe("/w/x.ts");
    expect(pathFromToolArgs("readFile", { path: "", file_path: "/fb.ts" })).toBe("/fb.ts");
  });

  it("非文件工具 / 入参不合法 / 无路径返回空", () => {
    expect(pathFromToolArgs("runTerminal", { path: "/x" })).toBe("");
    expect(pathFromToolArgs("readFile", null)).toBe("");
    expect(pathFromToolArgs("readFile", "str")).toBe("");
    expect(pathFromToolArgs("readFile", { path: "   " })).toBe("");
    expect(pathFromToolArgs("readFile", { other: 1 })).toBe("");
  });
});

describe("collectTouchedFiles / collectUploads", () => {
  it("流式 parts 与旧 tool 消息都收集并去重", () => {
    const messages = [
      msg({
        role: "assistant",
        parts: [
          { type: "text", text: "hi" } as never,
          { type: "tool", toolName: "readFile", args: { path: "/a.ts" } } as never,
          { type: "tool", toolName: "editFile", args: { file_path: "/b.ts" } } as never,
          { type: "tool", toolName: "runTerminal", args: { path: "/ignored" } } as never,
        ],
      }),
      msg({
        role: "tool",
        meta: { toolName: "writeFile", args: { path: "/a.ts" } },
      }),
      msg({
        role: "tool",
        meta: { toolName: "readFile", args: { path: "/c.ts" } },
      }),
    ];
    expect(collectTouchedFiles(messages)).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
  });

  it("只收集用户消息的附件名并去重", () => {
    const messages = [
      msg({ role: "user", meta: { attachments: [{ name: "spec.md" }, { name: "spec.md" }, { name: "" }] } }),
      msg({ role: "assistant", meta: { attachments: [{ name: "no.md" }] } }),
      msg({ role: "user", meta: { attachments: [{ name: "img.png" }] } }),
      msg({ role: "user" }),
    ];
    expect(collectUploads(messages)).toEqual(["spec.md", "img.png"]);
  });
});

describe("compressHistory 摘要分支", () => {
  it("更早轮次无用户消息时不写「目标」段", () => {
    const history: ChatTurn[] = Array.from({ length: 10 }, () => ({
      role: "assistant",
      content: "结论摘录内容",
    }));
    const result = compressHistory(history, baseOpts);
    expect(result.compressed).toBe(true);
    expect(result.summary).not.toContain("目标：");
    expect(result.summary).not.toContain("用户此前的要求：");
    expect(result.summary).toContain("此前结论摘录：");
  });

  it("更早轮次只有一个用户消息时不写「用户此前的要求」段", () => {
    const history: ChatTurn[] = [
      { role: "user", content: "最初的问题" },
      ...Array.from({ length: 9 }, (_, i) => ({
        role: "assistant" as const,
        content: `回答 ${i}`,
      })),
    ];
    const result = compressHistory(history, baseOpts);
    expect(result.summary).toContain("目标：");
    expect(result.summary).toContain("最初的问题");
    expect(result.summary).not.toContain("用户此前的要求：");
    expect(result.summary).toContain("此前结论摘录：");
  });

  it("更早轮次无助手消息时不写「此前结论摘录」段", () => {
    const history: ChatTurn[] = Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      content: `要求 ${i}`,
    }));
    const result = compressHistory(history, baseOpts);
    expect(result.summary).toContain("用户此前的要求：");
    expect(result.summary).not.toContain("此前结论摘录：");
  });

  it("摘要条目截断并折叠空白，读写文件最多列 16 条", () => {
    const long = "很长的内容 ".repeat(60);
    const history: ChatTurn[] = [
      { role: "user", content: long },
      ...Array.from({ length: 9 }, (_, i) => ({
        role: "user" as const,
        content: `${long}# ${i}`,
      })),
    ];
    const files = Array.from({ length: 20 }, (_, i) => `/f${i}.ts`);
    const result = compressHistory(history, {
      ...baseOpts,
      touchedFiles: files,
    });
    // 截断标记
    expect(result.summary).toContain("…");
    // 目标截断到 280 字符 + 省略号
    const goalLine = result.summary.split("目标：\n")[1]?.split("\n")[0] ?? "";
    expect(goalLine.length).toBe(281);
    // 20 个文件只列 16
    for (let i = 0; i < 16; i += 1) {
      expect(result.summary).toContain(`/f${i}.ts`);
    }
    expect(result.summary).not.toContain("/f16.ts");
    // 多余的空白被折叠成单空格
    expect(result.summary).not.toMatch(/ {2,}/);
  });
});
