import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-api", () => ({
  completeOnce: vi.fn(),
  lowestReasoningEffort: (efforts?: string[]) => {
    const tiers = ["minimal", "low", "medium", "high", "xhigh", "max"];
    const available = (efforts ?? []).filter((item) => tiers.includes(item));
    return available.length
      ? available.sort((a, b) => tiers.indexOf(a) - tiers.indexOf(b))[0]
      : undefined;
  },
}));
vi.mock("./git-exec", () => ({
  git: vi.fn(async (_workdir: string, args: string[]) => {
    if (args[0] === "status" && args[1] === "--porcelain") {
      return " M src/app.ts\n?? docs/guide.md\n";
    }
    if (args[0] === "diff" && args[1] === "HEAD" && args[2] === "--numstat") {
      return "3\t1\tsrc/app.ts\n";
    }
    return "";
  }),
}));

import { completeOnce } from "./model-api";
import { git } from "./git-exec";
import { planBatches } from "./git-commit-ai";

const completeOnceMock = vi.mocked(completeOnce);
const gitMock = vi.mocked(git);

const CANDIDATES = ["src/app.ts", "docs/guide.md"];

function reset() {
  completeOnceMock.mockReset();
  gitMock.mockClear();
}

beforeEach(reset);

describe("planBatches", () => {
  it("AI 规划成功：返回模型批次，遗留文件补收尾批次", async () => {
    completeOnceMock.mockResolvedValue(
      JSON.stringify([
        { message: "feat(app): 调整主流程", files: ["src/app.ts"] },
      ]),
    );
    const result = await planBatches("/repo", CANDIDATES, new Set(CANDIDATES));
    expect(result.note).toBeUndefined();
    expect(result.batches).toHaveLength(2);
    expect(result.batches[0]).toEqual({ message: "feat(app): 调整主流程", files: ["src/app.ts"] });
    // 模型遗漏的 docs/guide.md 补成收尾批次，不丢文件
    expect(result.batches[1]?.files).toEqual(["docs/guide.md"]);
  });

  it("瘦身 prompt：不携带 diff 正文（推理模型带 diff 会超时/截断）", async () => {
    completeOnceMock.mockResolvedValue(
      JSON.stringify([{ message: "chore: x", files: CANDIDATES }]),
    );
    await planBatches("/repo", CANDIDATES, new Set(CANDIDATES));
    const args = gitMock.mock.calls.map((call) => call[1]?.join(" "));
    // 只允许 status/numstat，不允许再取 diff 正文
    expect(args.some((cmd) => cmd?.includes("--no-color"))).toBe(false);
    const prompt = completeOnceMock.mock.calls[0]?.[0] ?? "";
    expect(prompt).not.toContain("diff --git");
    expect(prompt).toContain("M src/app.ts (+3 -1)");
    expect(prompt).toContain("?? docs/guide.md (新文件)");
  });

  it("补全参数：大预算 + 放宽超时 + 最低推理档", async () => {
    completeOnceMock.mockResolvedValue(
      JSON.stringify([{ message: "chore: x", files: CANDIDATES }]),
    );
    await planBatches("/repo", CANDIDATES, new Set(CANDIDATES), {
      providerId: "p",
      modelId: "m",
    });
    expect(completeOnceMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxTokens: 8192,
        timeoutMs: 180_000,
        reasoningEffort: "lowest",
        providerId: "p",
        modelId: "m",
      }),
    );
  });

  it("模型调用失败：按目录兜底分组并带出失败原因", async () => {
    completeOnceMock.mockRejectedValue(new Error("请求超时（180 秒）"));
    const result = await planBatches("/repo", CANDIDATES, new Set(CANDIDATES));
    expect(result.note).toBe("请求超时（180 秒）");
    expect(result.batches).toEqual([
      { message: "chore: update src files (1)", files: ["src/app.ts"] },
      { message: "chore: update docs files (1)", files: ["docs/guide.md"] },
    ]);
  });

  it("模型输出无可解析批次：兜底分组并注明原因", async () => {
    completeOnceMock.mockResolvedValue("抱歉，我无法完成这个任务。");
    const result = await planBatches("/repo", CANDIDATES, new Set(CANDIDATES));
    expect(result.note).toBeTruthy();
    expect(result.batches.length).toBeGreaterThan(0);
  });

  it("解析容错：markdown 围栏与模型编造的路径被剔除，遗留文件不丢", async () => {
    completeOnceMock.mockResolvedValue(
      "```json\n" +
        JSON.stringify([
          { message: "feat(a): 命中", files: ["src/app.ts"] },
          { message: "feat(b): 编造路径", files: ["not/in/repo.ts"] },
        ]) +
        "\n```",
    );
    const result = await planBatches("/repo", CANDIDATES, new Set(CANDIDATES));
    expect(result.batches).toEqual([
      { message: "feat(a): 命中", files: ["src/app.ts"] },
      { message: "chore: 其余 1 个变更文件", files: ["docs/guide.md"] },
    ]);
  });
});
