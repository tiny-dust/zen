import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));

vi.mock("./zen-dir", () => ({ zenMemoryDir: () => state.dir }));
vi.mock("./model-api", () => ({ completeOnce: vi.fn() }));

import { groupMemoryNotes, inferCategory, renderMemoryContext } from "./memory";

import type { DeviceMemory, MemoryNote } from "@zen/shared";

/**
 * 设备备注索引化：分类推断 → 分类索引（数量 + 摘要）→ 提示词只注入索引，
 * 正文由 readMemory 按需读取（避免整份记忆进上下文）。
 */

beforeAll(() => {
  state.dir = mkdtempSync(join(tmpdir(), "zen-memory-index-"));
});

afterAll(() => {
  rmSync(state.dir, { recursive: true, force: true });
});

function note(text: string, createdAt = 1): MemoryNote {
  return { id: `n-${createdAt}`, text, createdAt, category: inferCategory(text) };
}

function deviceMemory(notes: MemoryNote[]): DeviceMemory {
  return {
    collectedAt: 111,
    platform: "darwin",
    arch: "arm64",
    home: "/Users/t",
    shell: "/bin/zsh",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    tools: { node: "/usr/bin/node" },
    notes,
  };
}

describe("inferCategory", () => {
  it("按关键词归类到 项目 / 硬件 / 环境变量 / 工具链", () => {
    expect(inferCategory("ATS 调度项目在 ~/Company/tars，后端端口 8892")).toBe("project");
    expect(inferCategory("这台机器是 MacBook Pro M3，内存 36G")).toBe("hardware");
    expect(inferCategory("HTTPS_PROXY 环境变量指向公司代理")).toBe("env");
    expect(inferCategory("全局依赖统一用 pnpm 安装")).toBe("tool");
  });

  it("关键词都不命中归 other", () => {
    expect(inferCategory("周五下午别安排会议")).toBe("other");
  });
});

describe("groupMemoryNotes", () => {
  it("按固定分类顺序分组，给出条数与摘要", () => {
    const groups = groupMemoryNotes([
      note("全局依赖用 pnpm", 1),
      note("项目 ATS 后端在 8892", 2),
      note("项目 x-console 前端 8786", 3),
      note("MacBook Pro M3 36G 内存", 4),
    ]);

    expect(groups.map((group) => [group.category, group.count])).toEqual([
      ["project", 2],
      ["hardware", 1],
      ["tool", 1],
    ]);
    expect(groups[0]?.previews[0]).toContain("ATS");
    expect(groups[0]?.chars).toBeGreaterThan(0);
    // 空分类不产出分组
    expect(groups.some((group) => group.category === "env")).toBe(false);
  });
});

describe("renderMemoryContext 设备备注只注入索引", () => {
  it("提示词包含分类索引与摘要，不含备注全文", () => {
    const longNote =
      "ATS 调度项目 ~/Company/tars：前端 80、后端 8892，Nacos test 命名空间配置在 ats-conductor-server.yml";
    const context = renderMemoryContext({
      device: deviceMemory([note(longNote, 1), note("MacBook Pro M3", 2)]),
      user: { notes: [] },
    });

    expect(context).toBeTruthy();
    expect(context).toContain("设备备注索引");
    expect(context).toContain("项目（1 条）");
    expect(context).toContain("硬件（1 条）");
    // 只有 40 字摘要，不整段注入
    expect(context).not.toContain(longNote);
    // 提示 Agent 需要细节时按需读取
    expect(context).toContain("readMemory");
  });

  it("用户习惯仍整段注入（数量少且总是相关）", () => {
    const context = renderMemoryContext({
      device: null,
      user: { notes: [{ id: "u1", text: "回复用中文", createdAt: 1 }] },
    });
    expect(context).toContain("用户习惯记忆");
    expect(context).toContain("回复用中文");
  });
});
