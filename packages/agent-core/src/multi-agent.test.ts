import { describe, expect, it } from "vitest";

import { MultiAgentOrchestrator, ResourceLock } from "./multi-agent";

/**
 * 子 Agent 超时回归：挂死的子任务在超时后中断本轮，按重试策略重新排队，
 * 重试耗尽标记失败（error），不影响编排器继续调度其它任务。
 */

describe("MultiAgentOrchestrator 子任务超时", () => {
  it("超时后按重试策略重试，耗尽后标记失败", async () => {
    let calls = 0;
    const orchestrator = new MultiAgentOrchestrator({
      parentSessionId: "sess-timeout-test",
      emit: () => {},
      resourceLock: new ResourceLock(),
      subAgentTimeoutMs: 50,
      runChild: () => {
        calls += 1;
        // 模拟子会话挂死：永不返回
        return new Promise(() => {});
      },
    });

    const spawned = orchestrator.spawn({
      name: "慢任务",
      task: "永远跑不完的任务",
      maxAttempts: 2,
    });

    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(calls).toBe(2);
    expect(node?.status).toBe("error");
    expect(node?.error).toContain("超时");
    expect(node?.log.some((line) => line.text.includes("将重试"))).toBe(true);
  });

  it("超时中断会触发子会话取消信号", async () => {
    const signals: AbortSignal[] = [];
    const orchestrator = new MultiAgentOrchestrator({
      parentSessionId: "sess-timeout-abort",
      emit: () => {},
      resourceLock: new ResourceLock(),
      subAgentTimeoutMs: 40,
      runChild: (spec) => {
        signals.push(spec.signal);
        return new Promise(() => {});
      },
    });

    const spawned = orchestrator.spawn({ name: "挂死任务", task: "x" });
    await orchestrator.waitForAgents([spawned.id]);

    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0]?.aborted).toBe(true);
  });
});
